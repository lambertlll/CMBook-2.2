import type OpenAI from 'openai'
import { createOpenAIClient, getAISettings, getChatTokenLimitParams, getSystemPromptContent, handleAIError, validateAIService, withFastAiRequestOptions } from '@/lib/ai/utils'
import { estimateTokens } from '@/lib/ai/token-counter'
import { AgentContextManager } from './context-manager'
import { agentEventBus } from './event-bus'
import { AgentPermissionEngine, hasAuthoringIntent, hasEffectiveWriteIntent } from './permission-engine'
import { AgentPromptAssembler, hasInlineCurrentEditorState } from './prompt-assembler'
import { AgentRecoveryManager } from './recovery-manager'
import { createAgentId, AgentTraceRecorder } from './trace-recorder'
import { agentToolRegistry, buildEditorApprovalPreview } from './tool-registry'
import { agentDebugLog, previewText } from './debug-log'
import type {
  AgentChange,
  AgentContextSnapshot,
  AgentRuntimeCallbacks,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentSteeringPayload,
  AgentStep,
  AgentTool,
  AgentToolResult,
  ToolCall,
  ToolResult,
} from './types'

const DEFAULT_MAX_ITERATIONS = 15
const MAX_MISSING_WRITE_TOOL_REPAIRS = 2
const MAX_INVALID_QUOTED_WRITE_REPAIRS = 2
const MAX_IDENTICAL_READ_RESULT_REPEATS = 2
const MUTATING_TOOL_RISKS = new Set(['editor-write', 'file-create', 'file-update', 'delete', 'medium'])

export function isRequestAbortError(error: unknown) {
  if (typeof error === 'string') {
    return /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(error)
  }

  if (!error || typeof error !== 'object') {
    return false
  }

  const errorWithCode = error as { name?: string; code?: string; message?: string }
  return errorWithCode.name === 'AbortError'
    || errorWithCode.code === 'ABORT_ERR'
    || /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(errorWithCode.message || '')
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments || !rawArguments.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawArguments)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch (error) {
    throw new Error(`Invalid tool arguments JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function toolResultToLegacy(result: AgentToolResult): ToolResult {
  return {
    success: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
  }
}

function stringifyToolResult(result: AgentToolResult) {
  const payload = {
    ok: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
    changes: result.changes,
  }

  return JSON.stringify(payload)
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  if (content === null || content === undefined) {
    return ''
  }

  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function normalizeBaseMessage(message: OpenAI.Chat.ChatCompletionMessageParam): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role !== 'system') {
    return message
  }

  return {
    role: 'user',
    content: `## App Context\n${stringifyMessageContent(message.content)}`,
  }
}

interface StreamingToolCallAccumulator {
  id?: string
  index: number
  type?: 'function'
  function: {
    name: string
    arguments: string
  }
}

function toToolCallList(
  toolCalls: Map<number, StreamingToolCallAccumulator>
): OpenAI.Chat.ChatCompletionMessageToolCall[] {
  return [...toolCalls.values()]
    .sort((a, b) => a.index - b.index)
    .filter((toolCall) => toolCall.function.name)
    .map((toolCall) => ({
      id: toolCall.id || createAgentId('tool-call'),
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    }))
}

function summarizeMessage(message: OpenAI.Chat.ChatCompletionMessageParam, index: number) {
  const content = 'content' in message ? message.content : undefined
  const text = stringifyMessageContent(content)

  return {
    index,
    role: message.role,
    contentLength: text.length,
    preview: previewText(text),
  }
}

function getForcedWriteTool(context: AgentContextSnapshot): string | undefined {
  if (!hasEffectiveWriteIntent(context)) {
    return undefined
  }

  const quote = context.currentQuote
  if (!quote) {
    return undefined
  }

  if (quote.from >= 0 && quote.to >= quote.from) {
    return 'editor_replace_range'
  }

  if (quote.startLine > 0 && quote.endLine >= quote.startLine) {
    return 'editor_replace_lines'
  }

  return undefined
}

function hasDocumentWideBatchEditorIntent(context: AgentContextSnapshot) {
  if (context.currentQuote || !isCurrentEditorWriteIntent(context)) {
    return false
  }

  const hasBatchScope = /(全文|整篇|整个(?:文档|文件|笔记|文章)|全部|全都|所有|每一处|各处|多处|都)/i.test(context.userInput)
  const hasBatchAction = /(翻译|译成|替换|修改|改写|重写|润色|统一|转换|删除|移除|translate|replace|rewrite|edit|remove)/i.test(context.userInput)

  return hasBatchScope && hasBatchAction
}

function forceToolChoice(toolName: string): OpenAI.Chat.ChatCompletionToolChoiceOption {
  return {
    type: 'function',
    function: {
      name: toolName,
    },
  }
}

function requiresSelectedContext(userInput: string) {
  return /(这段|这句话|这行|选中|所选|引用|这部分|当前选区|selected|selection|this text|this paragraph|this line)/i.test(userInput)
}

function hasExplicitCursorInsertIntent(userInput: string) {
  return /(光标|当前位置|当前光标|cursor|caret)/i.test(userInput)
}

function hasExplicitMcpIntent(userInput: string) {
  const mcpToken = '(?:\\bMCP\\b|Model\\s+Context\\s+Protocol)'
  const negatedMcpPattern = new RegExp(`(不要|不使用|无需|禁止|别)[^\\n。；;，,]{0,12}${mcpToken}|without[^\\n。；;，,]{0,12}${mcpToken}`, 'i')
  const explicitMcpPattern = new RegExp(`(使用|用|通过(?!的)|调用|借助)[^\\n。；;，,]{0,12}${mcpToken}|\\b(use|using|call|invoke|via|with)\\b[^\\n。；;，,]{0,12}${mcpToken}`, 'i')

  if (negatedMcpPattern.test(userInput)) {
    return false
  }

  return explicitMcpPattern.test(userInput)
}

function requiresDocumentPositioning(userInput: string) {
  return /(在.{0,30}(上面|下面|前面|后面|之前|之后)|放到|移动到|插入到|追加到|补充到|结论|标题|段落|章节|小节|列表|第\s*\d+\s*行|line\s*\d+)/i.test(userInput)
}

function normalizeFilePathForCompare(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function getExplicitTargetFilePath(userInput: string) {
  const match = userInput.match(/(?:^|[\s"'`：:，,（(])((?:[\w.-]+\/)+[\w.-]+\.md|[\w.-]+\.md)(?=$|[\s"'`。；;，,）)])/i)
  return match?.[1] ? normalizeFilePathForCompare(match[1]) : undefined
}

function hasCreateOnlyFileIntent(userInput: string) {
  if (/(新建|创建).{0,20}(文件夹|目录)|create.{0,20}(folder|directory)|mkdir/i.test(userInput)) {
    return false
  }

  return /(新建|创建|create)\s+[\w./-]+\.md|(?:新建|创建).{0,20}文件|create.{0,20}file/i.test(userInput) &&
    !/(更新|覆盖|替换|改写|改成|改为|如果.{0,8}存在|若.{0,8}存在|不存在.{0,8}则|update|overwrite|replace|upsert)/i.test(userInput)
}

function getRequestedFileCount(userInput: string) {
  const numericMatch = userInput.match(/(?:^|[^第\d])([2-9]\d*)\s*(?:篇|个|份|则)/) ||
    userInput.match(/\b([2-9]\d*)\s+(?:articles?|notes?|documents?|files?)\b/i)
  if (numericMatch?.[1]) {
    return Number(numericMatch[1])
  }

  const chineseMatch = userInput.match(/(?:^|[^第])([两二三四五六七八九十])\s*(?:篇|个|份|则)/)
  if (!chineseMatch?.[1]) {
    return undefined
  }

  const chineseNumbers: Record<string, number> = {
    '两': 2,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
  }

  return chineseNumbers[chineseMatch[1]]
}

function hasMultipleFileCreationIntent(userInput: string) {
  const hasCreationAction = /(创建|新建|生成|撰写|起草|编写|创作|(?:^|帮我|请|给我|为我|替我|再)写|\b(?:create|generate|write|draft)\b)/i.test(userInput)
  const hasMultipleQuantity = getRequestedFileCount(userInput) !== undefined ||
    /(多篇|几篇|若干篇|多份|多个|分别|各自)/i.test(userInput)

  return hasCreationAction && hasMultipleQuantity
}

function hasMultipleFileUpdateIntent(userInput: string) {
  const hasUpdateAction = /(改成|改为|更新|翻译|转换|润色|重写|改写|替换|编辑|英文版|中文版|\b(?:update|translate|convert|rewrite|replace|edit)\b)/i.test(userInput)
  const hasMultipleReference = getRequestedFileCount(userInput) !== undefined ||
    /(多篇|几篇|逐篇|每篇)/i.test(userInput) ||
    /(?:这些|上述|全部|全都|所有).{0,8}(?:笔记|文件|文档|文章|Markdown|md)|(?:笔记|文件|文档|文章).{0,8}(?:这些|上述|分别)/i.test(userInput)

  return hasUpdateAction && hasMultipleReference
}

function isSameTargetFile(targetFilePath: string, activeFilePath: string) {
  const target = normalizeFilePathForCompare(targetFilePath)
  const active = normalizeFilePathForCompare(activeFilePath)

  return target === active || (!target.includes('/') && active.endsWith(`/${target}`))
}

function getDifferentExplicitTargetFile(context: AgentContextSnapshot) {
  const targetFilePath = getExplicitTargetFilePath(context.userInput)
  const activeFilePath = context.activeFilePath

  if (!targetFilePath || !activeFilePath || isSameTargetFile(targetFilePath, activeFilePath)) {
    return null
  }

  return {
    targetFilePath,
    activeFilePath,
  }
}

function getCreateOnlyExistingActiveFile(context: AgentContextSnapshot) {
  if (!hasCreateOnlyFileIntent(context.userInput)) {
    return null
  }

  const targetFilePath = getExplicitTargetFilePath(context.userInput)
  const activeFilePath = context.activeFilePath
  if (!targetFilePath || !activeFilePath || !isSameTargetFile(targetFilePath, activeFilePath)) {
    return null
  }

  return activeFilePath
}

function getStringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function getNumberArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function normalizeForNoOpCheck(text: string) {
  return text.replace(/\r\n/g, '\n').trim()
}

function validateQuotedEditorWrite(
  context: AgentContextSnapshot,
  toolName: string,
  args: Record<string, unknown>
): AgentToolResult | null {
  const quote = context.currentQuote
  if (!quote) {
    return null
  }

  if (toolName === 'editor_replace_range' && quote.from >= 0 && quote.to >= quote.from) {
    const from = getNumberArg(args, 'from')
    const to = getNumberArg(args, 'to')
    const content = getStringArg(args, 'content')
    const selectedText = quote.fullContent || ''
    const selectedIsSingleLine = quote.startLine === quote.endLine

    if (from !== quote.from || to !== quote.to) {
      return {
        ok: false,
        message: `工具参数越界：当前请求只能替换用户选区 from=${quote.from}, to=${quote.to}，请用这个精确范围重试。`,
        error: 'INVALID_QUOTED_RANGE',
      }
    }

    if (!content.trim()) {
      return {
        ok: false,
        message: '工具参数无效：content 不能为空，请只传入改写后的选中文本。',
        error: 'EMPTY_REPLACEMENT_CONTENT',
      }
    }

    const effectiveReplacement = selectedIsSingleLine && content.includes('\n')
      ? extractSingleLineReplacement(content) || content
      : content
    if (
      normalizeForNoOpCheck(effectiveReplacement) &&
      normalizeForNoOpCheck(effectiveReplacement) === normalizeForNoOpCheck(selectedText)
    ) {
      return {
        ok: false,
        message: '工具参数无效：改写结果与选中文本完全相同。请根据用户要求给出真正改写后的选中文本，不要返回原文、标题或相邻段落。',
        error: 'NO_OP_REPLACEMENT_CONTENT',
      }
    }

    if (selectedIsSingleLine && content.includes('\n')) {
      return {
        ok: false,
        message: '工具参数越界：用户只选中了一行内的文本，content 只能是替换这段选中文本的单行内容，不能包含标题、段落或换行。',
        error: 'REPLACEMENT_EXPANDS_SELECTION',
      }
    }

    if (!/^#{1,6}\s/m.test(selectedText) && /^#{1,6}\s/m.test(content)) {
      return {
        ok: false,
        message: '工具参数越界：用户没有选中 Markdown 标题，content 不能包含标题。请只返回选中文本本身的正式改写。',
        error: 'REPLACEMENT_INCLUDES_UNSELECTED_HEADING',
      }
    }
  }

  return null
}

function validateCursorInsertTool(
  context: AgentContextSnapshot,
  toolName: string
): AgentToolResult | null {
  if (toolName !== 'editor_insert_at_cursor') {
    return null
  }

  const userInput = context.userInput
  if (!requiresDocumentPositioning(userInput) || hasExplicitCursorInsertIntent(userInput)) {
    return null
  }

  return {
    ok: false,
    message: '工具选择不安全：用户指定了文档位置，但没有要求在当前光标处插入。请先用 editor_get_state 获取行号，然后用 editor_replace_lines 或 editor_apply_transaction 精确修改目标位置。',
    error: 'CURSOR_INSERT_WITH_POSITIONAL_REQUEST',
  }
}

function validateEditorTargetFile(
  context: AgentContextSnapshot,
  tool: AgentTool
): AgentToolResult | null {
  if (tool.category !== 'editor') {
    return null
  }

  const target = getDifferentExplicitTargetFile(context)
  if (!target) {
    return null
  }

  return {
    ok: false,
    message: `工具选择不安全：用户指定的目标文件是 ${target.targetFilePath}，但当前编辑器文件是 ${target.activeFilePath}。请不要使用 editor_* 工具，改用 note_read_file 和 note_update_file 针对目标文件操作。`,
    error: 'EDITOR_TOOL_WRONG_TARGET_FILE',
  }
}

function validateExplicitMcpTool(
  context: AgentContextSnapshot,
  tool: AgentTool
): AgentToolResult | null {
  if (!hasExplicitMcpIntent(context.userInput) || tool.category === 'mcp') {
    return null
  }

  return {
    ok: false,
    message: '工具选择不符合用户要求：用户明确要求使用 MCP，请使用 mcp_list_tools 或 mcp_call_tool，不要改用笔记/编辑器工具。',
    error: 'EXPLICIT_MCP_REQUEST_REQUIRES_MCP_TOOL',
  }
}

function validateCreateOnlyTool(
  context: AgentContextSnapshot,
  tool: AgentTool
): AgentToolResult | null {
  if (!hasCreateOnlyFileIntent(context.userInput)) {
    return null
  }

  if (tool.name === 'note_create_file' || tool.risk === 'read') {
    return null
  }

  if (!isMutatingTool(tool) && tool.category !== 'editor') {
    return null
  }

  return {
    ok: false,
    message: '工具选择不安全：用户要求新建 Markdown 文件，只能使用 note_create_file。若文件已存在，请直接说明已存在，不能改用更新、替换或编辑器工具覆盖已有内容。',
    error: 'CREATE_ONLY_REQUEST_CANNOT_UPDATE_EXISTING_FILE',
  }
}

function extractSingleLineReplacement(content: string) {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^---+$/.test(line))

  if (lines.length !== 1) {
    return ''
  }

  return lines[0]
}

function repairQuotedEditorWriteArgs(
  context: AgentContextSnapshot,
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> | null {
  const quote = context.currentQuote
  if (!quote || toolName !== 'editor_replace_range') {
    return null
  }

  if (quote.startLine !== quote.endLine) {
    return null
  }

  const from = getNumberArg(args, 'from')
  const to = getNumberArg(args, 'to')
  const content = getStringArg(args, 'content')
  if (from !== quote.from || to !== quote.to || !content.includes('\n')) {
    return null
  }

  const repairedContent = extractSingleLineReplacement(content)
  if (!repairedContent || repairedContent === content) {
    return null
  }

  const repairedArgs = {
    ...args,
    content: repairedContent,
  }

  if (validateQuotedEditorWrite(context, toolName, repairedArgs)) {
    return null
  }

  return repairedArgs
}

function buildToolChoice(context: AgentContextSnapshot): OpenAI.Chat.ChatCompletionToolChoiceOption {
  const forcedTool = getForcedActionTool(context)
  if (!forcedTool) {
    return 'auto'
  }

  return forceToolChoice(forcedTool)
}

function getForcedActionTool(context: AgentContextSnapshot) {
  if (hasExplicitMcpIntent(context.userInput)) {
    return undefined
  }

  const forcedWriteTool = getForcedWriteTool(context)
  if (forcedWriteTool) {
    return forcedWriteTool
  }

  if (hasMultipleFileCreationIntent(context.userInput)) {
    return undefined
  }

  if (hasCreateOnlyFileIntent(context.userInput)) {
    return 'note_create_file'
  }

  if (!context.activeFilePath && hasAuthoringIntent(context.userInput)) {
    return 'note_create_file'
  }

  return undefined
}

function isCurrentEditorWriteIntent(context: AgentContextSnapshot) {
  if (
    !context.activeFilePath ||
    !hasEffectiveWriteIntent(context) ||
    hasCreateOnlyFileIntent(context.userInput) ||
    hasMultipleFileCreationIntent(context.userInput) ||
    hasMultipleFileUpdateIntent(context.userInput) ||
    getExplicitTargetFilePath(context.userInput)
  ) {
    return false
  }

  return !/(标签|tag\b|记录|mark\b|记忆|记住|memory\b|文件夹|目录|folder\b|skill\b|技能|脚本|script\b|mcp\b|删除.{0,8}(文件|笔记)|重命名|移动.{0,8}(文件|笔记)|复制.{0,8}(文件|笔记))/i.test(context.userInput)
}

function selectToolsForContext(context: AgentContextSnapshot, tools: AgentTool[]) {
  let selectedTools = tools

  if (hasExplicitMcpIntent(context.userInput)) {
    return selectedTools.filter((tool) => tool.category === 'mcp')
  }

  if (hasMultipleFileUpdateIntent(context.userInput)) {
    const batchUpdateToolNames = new Set([
      'note_list_files',
      'note_search_files',
      'note_read_file',
      'note_read_files_batch',
      'note_update_file',
    ])
    return tools.filter((tool) => batchUpdateToolNames.has(tool.name))
  }

  const forcedTool = getForcedActionTool(context)
  if (forcedTool) {
    return tools.filter((tool) => tool.name === forcedTool)
  }

  if (hasMultipleFileCreationIntent(context.userInput)) {
    return tools.filter((tool) => tool.name === 'note_create_file')
  }

  if (isCurrentEditorWriteIntent(context)) {
    return selectedTools.filter((tool) =>
      tool.category === 'editor' ||
      tool.category === 'skill'
    )
  }

  if (hasCreateOnlyFileIntent(context.userInput)) {
    selectedTools = selectedTools.filter((tool) =>
      tool.name === 'note_create_file' ||
      tool.risk === 'read'
    )
  }

  if (getDifferentExplicitTargetFile(context)) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'editor')
  }

  if (requiresDocumentPositioning(context.userInput) && !hasExplicitCursorInsertIntent(context.userInput)) {
    selectedTools = selectedTools.filter((tool) => tool.name !== 'editor_insert_at_cursor')
  }

  if (!context.activeFilePath) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'editor')
  }

  if (!hasEffectiveWriteIntent(context)) {
    selectedTools = selectedTools.filter((tool) => !isMutatingTool(tool))
  }

  return selectedTools
}

function indicatesWriteCompletedClaim(content: string) {
  return /(已|已经|完成|成功).{0,12}(修改|更新|删除|添加|插入|写入|创建)|done|completed|updated|modified|deleted|inserted|added/i.test(content)
}

function buildMissingWriteToolReminder(context: AgentContextSnapshot, assistantContent: string) {
  const quote = context.currentQuote
  const replacementHint = previewText(assistantContent, 800)
  const completionClaim = indicatesWriteCompletedClaim(assistantContent)
  const targetHint = quote
    ? quote.from >= 0 && quote.to >= quote.from
      ? `Call editor_replace_range with from=${quote.from}, to=${quote.to}, and content set to ONLY the rewritten selected text.`
      : `Call editor_replace_lines with startLine=${quote.startLine}, endLine=${quote.endLine}, and replaceContent set to ONLY the rewritten selected text.`
    : 'Call the appropriate write tool for the requested change.'

  return [
    completionClaim
      ? 'You claimed the requested change was completed, but you did not call any write tool.'
      : 'The user explicitly asked you to modify content, but your previous response did not call a write tool.',
    'Do not return rewritten text as the final answer.',
    targetHint,
    replacementHint ? `Your previous proposed text was:\n---\n${replacementHint}\n---` : '',
  ].filter(Boolean).join('\n\n')
}

function indicatesNoChangeNeeded(content: string) {
  return /(已经存在|已存在|无需(重复)?(添加|修改|写入|更新)|不需要(重复)?(添加|修改|写入|更新)|无需重复|不要重复|already exists|no need to|nothing to change|no changes? needed)/i.test(content)
}

function buildStep(tool: AgentTool, input: Record<string, unknown>, result: AgentToolResult, duration: number): AgentStep {
  return {
    thought: `${tool.title}`,
    action: {
      tool: tool.name,
      params: input,
    },
    observation: result.message,
    duration,
  }
}

function isMutatingTool(tool: AgentTool) {
  return MUTATING_TOOL_RISKS.has(tool.risk)
}

function getReadToolCallSignature(tool: AgentTool, args: Record<string, unknown>) {
  if (tool.risk !== 'read') {
    return undefined
  }

  return `${tool.name}:${JSON.stringify(args)}`
}

function getOpenAITools(tools: AgentTool[], editorStateReadLocked: boolean) {
  const availableTools = editorStateReadLocked
    ? tools.filter((tool) => tool.name !== 'editor_get_state')
    : tools

  return agentToolRegistry.toOpenAITools(availableTools)
}

function isEditorStateStaleResult(tool: AgentTool, result: AgentToolResult) {
  if (result.ok || !isMutatingTool(tool)) {
    return false
  }

  return /content has changed|editor content.*changed|内容已变化|版本.*(?:变化|不匹配)/i.test(
    `${result.error || ''}\n${result.message || ''}`
  )
}

export class AgentRuntime {
  private readonly contextManager = new AgentContextManager()
  private readonly promptAssembler = new AgentPromptAssembler()
  private readonly permissionEngine = new AgentPermissionEngine()
  private readonly recoveryManager = new AgentRecoveryManager()
  private abortController: AbortController | null = null
  private stopped = false
  private steeringRequested = false
  private steeringQueue: AgentSteeringPayload[] = []
  private steeringReadyResolver: (() => void) | null = null

  stop() {
    this.stopped = true
    this.steeringQueue = []
    this.steeringRequested = false
    this.steeringReadyResolver?.()
    this.steeringReadyResolver = null
    this.abortController?.abort()
  }

  beginSteering() {
    if (!this.stopped) {
      this.steeringRequested = true
    }
  }

  steer(payload: AgentSteeringPayload) {
    if (this.stopped) return
    this.steeringRequested = true
    this.steeringQueue.push(payload)
    this.steeringQueue.sort((a, b) => a.sequence - b.sequence)
    this.steeringReadyResolver?.()
    this.steeringReadyResolver = null
  }

  async run(input: AgentRuntimeInput, callbacks: AgentRuntimeCallbacks = {}): Promise<AgentRuntimeResult> {
    this.stopped = false
    this.abortController = new AbortController()

    const recorder = new AgentTraceRecorder()
    const runId = recorder.getRunId()
    const steps: AgentStep[] = []
    const toolCalls: ToolCall[] = []
    const changes: AgentChange[] = []

    const multipleFileCreation = hasMultipleFileCreationIntent(input.userInput)
    const multipleFileUpdate = hasMultipleFileUpdateIntent(input.userInput)
    const requestedFileCount = getRequestedFileCount(input.userInput)
    const context: AgentContextSnapshot = {
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath,
      currentEditorState: input.currentEditorState,
      userInput: input.userInput,
      currentQuote: input.currentQuote,
      availableSkills: input.availableSkills,
      multipleFileCreation,
      multipleFileUpdate,
      requestedFileCount,
    }

    agentDebugLog('run_start', {
      runId,
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath || null,
      userInput: input.userInput,
      imageCount: input.imageUrls?.length || 0,
      hasQuote: Boolean(input.currentQuote),
      hasEditorState: Boolean(input.currentEditorState),
      availableSkillCount: input.availableSkills?.length || 0,
    })

    if (
      !this.steeringRequested &&
      hasEffectiveWriteIntent(context) &&
      requiresSelectedContext(input.userInput) &&
      !input.currentQuote
    ) {
      const content = '没有检测到当前选区。请先在编辑器中选中要修改的文本，再发送这条指令。'
      agentDebugLog('missing_selection_for_write', {
        runId,
        userInput: input.userInput,
      })
      callbacks.onStatus?.('completed')
      callbacks.onFinalAnswerRender?.(content)
      const finalTrace = recorder.add({
        type: 'final',
        title: '缺少选区',
        status: 'error',
        message: content,
      })
      callbacks.onTrace?.(finalTrace)

      return {
        runId,
        content,
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    }

    const existingActiveCreateTarget = this.steeringRequested
      ? undefined
      : getCreateOnlyExistingActiveFile(context)
    if (existingActiveCreateTarget) {
      const content = `文件 \`${existingActiveCreateTarget}\` 已经存在，已取消新建操作，未修改现有内容。`
      agentDebugLog('create_target_already_active_final', {
        runId,
        targetFilePath: existingActiveCreateTarget,
        userInput: input.userInput,
      })
      callbacks.onStatus?.('completed')
      callbacks.onFinalAnswerRender?.(content)
      const finalTrace = recorder.add({
        type: 'final',
        title: '文件已存在',
        status: 'success',
        message: content,
      })
      callbacks.onTrace?.(finalTrace)

      return {
        runId,
        content,
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    }

    const allTools = agentToolRegistry.listTools()
    let tools = selectToolsForContext(context, allTools)
    const customSystemPrompt = await getSystemPromptContent()
    let systemPrompt = this.promptAssembler.assemble(
      context,
      tools,
      customSystemPrompt
    )
    const baseMessages = this.contextManager.prepareMessages(input.messages || [])
      .map(normalizeBaseMessage)

    const currentUserMessage = await this.contextManager.buildCurrentUserMessage(
      input.userInput,
      input.imageUrls
    )

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...baseMessages,
      currentUserMessage,
    ]

    agentDebugLog('context_prepared', {
      runId,
      systemPromptLength: systemPrompt.length,
      toolCount: tools.length,
      rawMessageCount: input.messages?.length || 0,
      preparedMessageCount: messages.length,
      appContextMessageCount: baseMessages.filter((message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('## App Context')
      ).length,
      messages: messages.map(summarizeMessage),
    })
    callbacks.onStatus?.('preparing_context')

    const aiConfig = await getAISettings()
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (validatedBaseURL === null) {
      agentDebugLog('ai_service_invalid', { runId })
      return {
        runId,
        content: '',
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    }

    const client = await createOpenAIClient(aiConfig)
    let editorStateReadLocked = hasInlineCurrentEditorState(context)
    let openAITools = getOpenAITools(tools, editorStateReadLocked)
    let baseToolChoice = buildToolChoice(context)
    let documentWideBatchEditorIntent = hasDocumentWideBatchEditorIntent(context)
    let documentWideSnapshotRead = editorStateReadLocked
    let finalContent = ''
    let missingWriteToolRepairCount = 0
    let invalidQuotedWriteRepairCount = 0
    let writeActionCompleted = false
    let multiCreateAttemptCount = 0
    let multiCreateSuccessCount = 0
    const multiCreateMessages: string[] = []
    let multiUpdateAttemptCount = 0
    let multiUpdateSuccessCount = 0
    const multiUpdateMessages: string[] = []
    const readToolResultHistory = new Map<string, {
      result: string
      repeatCount: number
    }>()
    let latestEditorStateResult: AgentToolResult | undefined
    let activeModelTraceId: string | undefined
    let activeModelStartedAt = 0
    let activeModelReasoning = ''
    let activeModelContent = ''
    let activeModelStreamedTokenCount = 0

    const drainSteering = async () => {
      if (!this.steeringRequested) return false
      if (this.steeringQueue.length === 0 && !this.stopped) {
        await new Promise<void>((resolve) => {
          this.steeringReadyResolver = resolve
        })
      }
      if (this.stopped) return false

      const payloads = this.steeringQueue.splice(0)
      if (payloads.length === 0) return false
      this.steeringRequested = false
      callbacks.onStatus?.('steering')

      for (const payload of payloads) {
        const text = payload.additionalContext
          ? `## App Context\n${payload.additionalContext}\n\n## User steering message\n${payload.text}`
          : payload.text
        messages.push(await this.contextManager.buildCurrentUserMessage(text, payload.imageUrls))
      }

      const latest = payloads[payloads.length - 1]
      context.userInput = latest.text
      context.currentQuote = latest.currentQuote
      context.currentEditorState = undefined
      context.multipleFileCreation = hasMultipleFileCreationIntent(latest.text)
      context.multipleFileUpdate = hasMultipleFileUpdateIntent(latest.text)
      context.requestedFileCount = getRequestedFileCount(latest.text)
      tools = selectToolsForContext(context, allTools)
      editorStateReadLocked = false
      openAITools = getOpenAITools(tools, editorStateReadLocked)
      baseToolChoice = buildToolChoice(context)
      documentWideBatchEditorIntent = hasDocumentWideBatchEditorIntent(context)
      documentWideSnapshotRead = false
      missingWriteToolRepairCount = 0
      invalidQuotedWriteRepairCount = 0
      systemPrompt = this.promptAssembler.assemble(context, tools, customSystemPrompt)
      messages[0] = { role: 'system', content: systemPrompt }

      const steeringTrace = recorder.add({
        type: 'steering',
        title: '已应用追加信息',
        status: 'success',
        message: payloads.map((payload) => payload.text).join('\n'),
      })
      callbacks.onTrace?.(steeringTrace)
      return true
    }

    const finalizeInterruptedModelTrace = (status: 'success' | 'error', title: string) => {
      if (!activeModelTraceId) {
        return
      }

      const interruptedTrace = recorder.update(activeModelTraceId, {
        type: 'model_response',
        title,
        status,
        duration: Date.now() - activeModelStartedAt,
        output: activeModelContent || undefined,
        reasoning: activeModelReasoning || undefined,
        streamedTokenCount: activeModelStreamedTokenCount,
      })
      if (interruptedTrace) callbacks.onTrace?.(interruptedTrace)

      activeModelTraceId = undefined
      activeModelStartedAt = 0
      activeModelReasoning = ''
      activeModelContent = ''
      activeModelStreamedTokenCount = 0
    }

    try {
      for (let iteration = 1; iteration <= DEFAULT_MAX_ITERATIONS; iteration += 1) {
        if (this.stopped) {
          callbacks.onStatus?.('stopped')
          if (finalContent) {
            callbacks.onFinalAnswerRender?.(finalContent)
          }
          return {
            runId,
            content: finalContent,
            stopped: true,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        await drainSteering()

        callbacks.onStatus?.('thinking')
        await agentEventBus.emit('before-model-call', { runId })
        agentDebugLog('model_call_start', {
          runId,
          iteration,
          model: aiConfig?.model || '',
          messageCount: messages.length,
          toolCount: tools.length,
        })
        const modelTrace = recorder.add({
          type: 'model_call',
          title: '模型思考',
          status: 'running',
          message: `第 ${iteration} 轮`,
          streamedTokenCount: 0,
        })
        activeModelTraceId = modelTrace.id
        activeModelStartedAt = modelTrace.timestamp
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        callbacks.onTrace?.(modelTrace)

        const toolChoice = documentWideBatchEditorIntent
          ? forceToolChoice(documentWideSnapshotRead ? 'editor_apply_transaction' : 'editor_get_state')
          : baseToolChoice
        const stream = await this.recoveryManager.withRetry(() =>
          client.chat.completions.create(withFastAiRequestOptions({
            model: aiConfig?.model || '',
            messages,
            temperature: aiConfig?.temperature,
            top_p: aiConfig?.topP,
            tools: openAITools,
            tool_choice: toolChoice,
            stream: true,
            ...getChatTokenLimitParams(aiConfig),
          }, aiConfig), {
            signal: this.abortController?.signal,
          })
        )
        let assistantContent = ''
        let finishReason: string | null | undefined
        let toolCallsStarted = false
        let candidateAnswerRendered = false
        let assistantReasoning = ''
        let streamedText = ''
        let streamedTokenCount = 0
        let lastModelProgressTraceAt = 0
        let steeringInterrupted = false
        const streamedToolCalls = new Map<number, StreamingToolCallAccumulator>()

        for await (const chunk of stream) {
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          if (this.steeringRequested) {
            steeringInterrupted = true
            break
          }

          const choice = chunk.choices[0]
          if (!choice) {
            continue
          }

          finishReason = choice.finish_reason ?? finishReason
          const delta = choice.delta
          const extendedDelta = delta as typeof delta & {
            reasoning?: string
            reasoning_content?: string
          }
          const reasoningDelta = extendedDelta.reasoning_content || extendedDelta.reasoning
          if (typeof reasoningDelta === 'string') {
            assistantReasoning += reasoningDelta
            streamedText += reasoningDelta
            activeModelReasoning = assistantReasoning
          }
          if (typeof delta.content === 'string' && delta.content) {
            assistantContent += delta.content
            streamedText += delta.content
            activeModelContent = assistantContent
            if (!toolCallsStarted && assistantContent.trim()) {
              candidateAnswerRendered = true
              callbacks.onCandidateAnswerRender?.(assistantContent)
            }
          }

          for (const toolCallDelta of delta.tool_calls || []) {
            if (!toolCallsStarted) {
              toolCallsStarted = true
            }

            const index = toolCallDelta.index
            const current = streamedToolCalls.get(index) || {
              index,
              id: toolCallDelta.id,
              type: 'function' as const,
              function: {
                name: '',
                arguments: '',
              },
            }

            if (toolCallDelta.id) {
              current.id = toolCallDelta.id
            }
            if (toolCallDelta.type === 'function') {
              current.type = toolCallDelta.type
            }
            if (toolCallDelta.function?.name) {
              current.function.name += toolCallDelta.function.name
              streamedText += toolCallDelta.function.name
            }
            if (toolCallDelta.function?.arguments) {
              current.function.arguments += toolCallDelta.function.arguments
              streamedText += toolCallDelta.function.arguments
            }

            streamedToolCalls.set(index, current)
          }

          const now = Date.now()
          if (streamedText && now - lastModelProgressTraceAt >= 100) {
            streamedTokenCount = estimateTokens(streamedText)
            activeModelStreamedTokenCount = streamedTokenCount
            lastModelProgressTraceAt = now
            const progressTrace = recorder.update(modelTrace.id, {
              output: assistantContent || undefined,
              reasoning: assistantReasoning || undefined,
              streamedTokenCount,
            })
            if (progressTrace) callbacks.onTrace?.(progressTrace)
          }
        }
        streamedTokenCount = estimateTokens(streamedText)
        activeModelStreamedTokenCount = streamedTokenCount
        assistantContent = assistantContent.trim() ? assistantContent : ''
        const toolUses = toToolCallList(streamedToolCalls)
        if (steeringInterrupted) {
          finalizeInterruptedModelTrace('success', '模型响应已被追加信息引导')
          if (assistantContent) {
            messages.push({ role: 'assistant', content: assistantContent })
          }
          await drainSteering()
          iteration -= 1
          continue
        }
        finalContent = assistantContent || finalContent
        if (!assistantContent && toolUses.length === 0) {
          throw new Error('AI response did not include a message')
        }
        agentDebugLog('model_call_end', {
          runId,
          iteration,
          finishReason,
          assistantContentLength: assistantContent.length,
          assistantPreview: previewText(assistantContent),
          toolCalls: toolUses.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsPreview: previewText(toolCall.function.arguments || ''),
          })),
        })
        const modelTraceOutput = assistantContent || (
          toolUses.length > 0
            ? {
              finishReason,
              toolCalls: toolUses.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                argumentsPreview: previewText(toolCall.function.arguments || '', 500),
              })),
            }
            : undefined
        )
        const responseTrace = recorder.update(modelTrace.id, {
          type: 'model_response',
          title: assistantContent ? '模型响应' : toolUses.length > 0 ? '模型选择工具' : '模型思考',
          status: 'success',
          duration: Date.now() - modelTrace.timestamp,
          output: modelTraceOutput,
          reasoning: assistantReasoning || undefined,
          streamedTokenCount,
        })
        if (responseTrace) callbacks.onTrace?.(responseTrace)
        activeModelTraceId = undefined
        activeModelStartedAt = 0
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        if (toolCallsStarted && candidateAnswerRendered) {
          callbacks.onCandidateAnswerClear?.()
        }
        await agentEventBus.emit('after-model-call', { runId, content: assistantContent })

        if (toolUses.length === 0) {
          if (hasEffectiveWriteIntent(context) && indicatesNoChangeNeeded(assistantContent)) {
            agentDebugLog('no_change_needed_final', {
              runId,
              iteration,
              assistantPreview: previewText(assistantContent),
            })
            callbacks.onStatus?.('completed')
            callbacks.onFinalAnswerRender?.(assistantContent)
            const finalTrace = recorder.add({
              type: 'final',
              title: '无需修改',
              status: 'success',
              message: assistantContent,
            })
            callbacks.onTrace?.(finalTrace)

            return {
              runId,
              content: assistantContent,
              stopped: false,
              steps,
              toolCalls,
              changes,
              trace: recorder.all(),
            }
          }

          if (
            !writeActionCompleted &&
            hasEffectiveWriteIntent(context) &&
            missingWriteToolRepairCount < MAX_MISSING_WRITE_TOOL_REPAIRS
          ) {
            missingWriteToolRepairCount += 1
            callbacks.onCandidateAnswerClear?.()
            const reminder = buildMissingWriteToolReminder(context, assistantContent)
            messages.push({
              role: 'assistant',
              content: assistantContent || null,
            })
            messages.push({
              role: 'user',
              content: reminder,
            })
            agentDebugLog('missing_write_tool_repair', {
              runId,
              iteration,
              repairCount: missingWriteToolRepairCount,
              forcedTool: getForcedWriteTool(context),
              completionClaim: indicatesWriteCompletedClaim(assistantContent),
              assistantPreview: previewText(assistantContent),
              reminder: previewText(reminder, 500),
            })
            continue
          }

          agentDebugLog('final_answer', {
            runId,
            contentLength: assistantContent.length,
            preview: previewText(assistantContent),
          })
          callbacks.onStatus?.('completed')
          callbacks.onFinalAnswerRender?.(assistantContent)
          const finalTrace = recorder.add({
            type: 'final',
            title: '完成',
            status: 'success',
            message: assistantContent,
          })
          callbacks.onTrace?.(finalTrace)

          return {
            runId,
            content: assistantContent,
            stopped: false,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        messages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolUses,
        })

        for (const toolUse of toolUses) {
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          if (this.steeringRequested) {
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult({
                ok: false,
                message: '用户追加了新的引导信息，本次尚未开始的工具调用已取消。',
                error: 'SUPERSEDED_BY_STEERING',
              }),
            })
            continue
          }

          const toolName = toolUse.function.name
          const tool = agentToolRegistry.getTool(toolName)
          let args: Record<string, unknown>
          try {
            args = parseToolArguments(toolUse.function.arguments)
          } catch (error) {
            const parseErrorResult: AgentToolResult = {
              ok: false,
              message: `工具参数 JSON 无效：${error instanceof Error ? error.message : String(error)}。请重新发起同一个工具调用，并返回合法 JSON 参数。`,
              error: 'INVALID_TOOL_ARGUMENTS_JSON',
            }
            const toolCall: ToolCall = {
              id: toolUse.id || createAgentId('tool-call'),
              toolName,
              params: {},
              status: 'error',
              result: toolResultToLegacy(parseErrorResult),
              timestamp: Date.now(),
            }
            toolCalls.push(toolCall)
            callbacks.onToolCall?.(toolCall)
            agentDebugLog('tool_args_parse_error', {
              runId,
              toolCallId: toolUse.id,
              toolName,
              rawArguments: toolUse.function.arguments || '',
              error: parseErrorResult.message,
            })
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(parseErrorResult),
            })
            continue
          }

          agentDebugLog('tool_call_received', {
            runId,
            toolCallId: toolUse.id,
            toolName,
            args,
          })

          if (!tool) {
            const missingResult: AgentToolResult = {
              ok: false,
              message: `工具不存在：${toolName}`,
              error: `Unknown tool ${toolName}`,
            }
            agentDebugLog('tool_missing', {
              runId,
              toolName,
            })
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(missingResult),
            })
            continue
          }

          callbacks.onStatus?.('calling_tool')
          const toolCall: ToolCall = {
            id: toolUse.id || createAgentId('tool-call'),
            toolName,
            params: args,
            status: 'pending',
            timestamp: Date.now(),
          }
          toolCalls.push(toolCall)
          callbacks.onToolCall?.(toolCall)

          const invalidMcpTool = validateExplicitMcpTool(context, tool)
          if (invalidMcpTool) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidMcpTool.message,
              error: invalidMcpTool.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidMcpTool)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(invalidMcpTool),
            })
            continue
          }

          const invalidCreateOnlyTool = validateCreateOnlyTool(context, tool)
          if (invalidCreateOnlyTool) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidCreateOnlyTool.message,
              error: invalidCreateOnlyTool.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidCreateOnlyTool)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(invalidCreateOnlyTool),
            })
            continue
          }

          const invalidEditorTarget = validateEditorTargetFile(context, tool)
          if (invalidEditorTarget) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidEditorTarget.message,
              error: invalidEditorTarget.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidEditorTarget)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(invalidEditorTarget),
            })
            continue
          }

          const invalidCursorInsert = validateCursorInsertTool(context, toolName)
          if (invalidCursorInsert) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidCursorInsert.message,
              error: invalidCursorInsert.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidCursorInsert)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(invalidCursorInsert),
            })
            continue
          }

          const invalidQuotedWrite = validateQuotedEditorWrite(context, toolName, args)
          if (invalidQuotedWrite) {
            const repairedArgs = repairQuotedEditorWriteArgs(context, toolName, args)
            if (repairedArgs) {
              agentDebugLog('tool_args_auto_repaired', {
                runId,
                toolName,
                originalArgs: args,
                repairedArgs,
                reason: invalidQuotedWrite.message,
                error: invalidQuotedWrite.error,
              })
              args = repairedArgs
              toolCall.params = args
              callbacks.onToolCall?.(toolCall)
            } else {
              invalidQuotedWriteRepairCount += 1
              agentDebugLog('tool_args_rejected', {
                runId,
                toolName,
                args,
                reason: invalidQuotedWrite.message,
                error: invalidQuotedWrite.error,
                retryCount: invalidQuotedWriteRepairCount,
              })
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(invalidQuotedWrite)
              callbacks.onToolCall?.(toolCall)
              messages.push({
                role: 'tool',
                tool_call_id: toolUse.id,
                content: stringifyToolResult(invalidQuotedWrite),
              })

              if (invalidQuotedWriteRepairCount >= MAX_INVALID_QUOTED_WRITE_REPAIRS) {
                finalContent = '模型连续返回了超出选区范围的替换内容，已停止执行，未修改笔记。'
                agentDebugLog('invalid_tool_args_final', {
                  runId,
                  toolName,
                  retryCount: invalidQuotedWriteRepairCount,
                  content: finalContent,
                })
                callbacks.onStatus?.('completed')
                callbacks.onFinalAnswerRender?.(finalContent)
                const finalTrace = recorder.add({
                  type: 'final',
                  title: '停止执行',
                  status: 'error',
                  message: finalContent,
                })
                callbacks.onTrace?.(finalTrace)

                return {
                  runId,
                  content: finalContent,
                  stopped: false,
                  steps,
                  toolCalls,
                  changes,
                  trace: recorder.all(),
                }
              }

              continue
            }
          }

          const blockedByHook = await agentEventBus.emit('pre-tool-use', {
            runId,
            tool,
            input: args,
          })

          if (blockedByHook) {
            const blockedResult: AgentToolResult = {
              ok: false,
              message: blockedByHook,
              error: 'BLOCKED_BY_HOOK',
            }
            agentDebugLog('tool_blocked_by_hook', {
              runId,
              toolName,
              reason: blockedByHook,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(blockedResult)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(blockedResult),
            })
            continue
          }

          const permission = this.permissionEngine.evaluate(tool, args, context)
          agentDebugLog('permission_decision', {
            runId,
            toolName,
            risk: tool.risk,
            allowed: permission.allowed,
            requiresApproval: permission.requiresApproval,
            reason: permission.reason,
            canApproveForSession: permission.canApproveForSession,
            sessionApprovalType: permission.sessionApprovalType,
            sessionApprovalSkillId: permission.sessionApprovalSkillId,
          })
          if (!permission.allowed) {
            const deniedResult: AgentToolResult = {
              ok: false,
              message: permission.reason || '工具调用被权限策略阻止。',
              error: 'BLOCKED_BY_PERMISSION',
            }
            agentDebugLog('tool_blocked_by_permission', {
              runId,
              toolName,
              reason: deniedResult.message,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(deniedResult)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(deniedResult),
            })
            continue
          }

          if (permission.requiresApproval) {
            callbacks.onStatus?.('waiting_approval')
            agentDebugLog('approval_request', {
              runId,
              toolName,
              args,
            })
            const approvalTrace = recorder.add({
              type: 'approval',
              title: '等待用户确认',
              status: 'running',
              toolName,
              input: args,
            })
            callbacks.onTrace?.(approvalTrace)

            const approvalPreview = await buildEditorApprovalPreview(tool.name, args)
            const approvalDecision = await callbacks.requestConfirmation?.(
              tool.name,
              args,
              approvalPreview ?? { previewParams: args }
            )

            agentDebugLog('approval_result', {
              runId,
              toolName,
              approved: approvalDecision === 'approved',
              decision: approvalDecision,
            })

            if (approvalDecision === 'steered') {
              const supersededResult: AgentToolResult = {
                ok: false,
                message: '用户追加了新的引导信息，本次待确认操作已取消。',
                error: 'SUPERSEDED_BY_STEERING',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(supersededResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: supersededResult.message,
                output: supersededResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              messages.push({
                role: 'tool',
                tool_call_id: toolUse.id,
                content: stringifyToolResult(supersededResult),
              })
              continue
            }

            if (approvalDecision !== 'approved') {
              const deniedResult: AgentToolResult = {
                ok: false,
                message: '用户拒绝了这个操作。请不要重复调用同一高风险工具，改用只读回答或询问用户新的处理方式。',
                error: 'USER_DENIED_TOOL',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(deniedResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: deniedResult.message,
                output: deniedResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              messages.push({
                role: 'tool',
                tool_call_id: toolUse.id,
                content: stringifyToolResult(deniedResult),
              })
              finalContent = '已取消本次操作，未修改笔记。'
              agentDebugLog('approval_denied_final', {
                runId,
                toolName,
                content: finalContent,
              })
              callbacks.onStatus?.('completed')
              callbacks.onFinalAnswerRender?.(finalContent)
              const finalTrace = recorder.add({
                type: 'final',
                title: '已取消',
                status: 'success',
                message: finalContent,
              })
              callbacks.onTrace?.(finalTrace)

              return {
                runId,
                content: finalContent,
                stopped: false,
                steps,
                toolCalls,
                changes,
                trace: recorder.all(),
              }
            }

            const updatedApprovalTrace = recorder.update(approvalTrace.id, {
              status: 'success',
              message: '用户已确认操作。',
            })
            if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
          }

          callbacks.onStatus?.(
            ['editor-write', 'file-create', 'file-update', 'delete', 'medium'].includes(tool.risk)
              ? 'applying_change'
              : 'calling_tool'
          )

          const trace = recorder.add({
            type: 'tool_call',
            title: tool.title,
            status: 'running',
            toolName,
            input: args,
          })
          callbacks.onTrace?.(trace)
          toolCall.status = 'running'
          callbacks.onToolCall?.(toolCall)

          const startedAt = Date.now()
          const reusableEditorStateResult = toolName === 'editor_get_state' && editorStateReadLocked
            ? latestEditorStateResult
            : undefined
          const reusedLockedEditorState = reusableEditorStateResult !== undefined
          agentDebugLog('tool_execute_start', {
            runId,
            iteration,
            toolName,
            args,
            reusedLockedEditorState,
          })
          const result: AgentToolResult = reusableEditorStateResult
            ? {
                ...reusableEditorStateResult,
                message: [
                  reusableEditorStateResult.message,
                  '本轮已经读取过相同的编辑器状态，请直接使用此前返回的内容，不要再次读取。',
                ].join('\n\n'),
              }
            : await tool.execute(args, {
                runId,
                signal: this.abortController?.signal,
                context,
              })
          const duration = Date.now() - startedAt
          agentDebugLog('tool_execute_end', {
            runId,
            iteration,
            toolName,
            ok: result.ok,
            duration,
            message: result.message,
            error: result.error,
            changeCount: result.changes?.length || 0,
          })

          if (result.changes) {
            for (const change of result.changes) {
              changes.push(change)
              callbacks.onChange?.(change)
              const changeTrace = recorder.add({
                type: 'change',
                title: change.summary || '记录改动',
                status: 'success',
                toolName,
                output: change,
                message: change.target,
              })
              callbacks.onTrace?.(changeTrace)
            }
          }

          toolCall.status = result.ok ? 'success' : 'error'
          toolCall.result = toolResultToLegacy(result)
          callbacks.onToolCall?.(toolCall)

          const step = buildStep(tool, args, result, duration)
          steps.push(step)
          callbacks.onStep?.(step)

          const updatedTrace = recorder.update(trace.id, {
            status: result.ok ? 'success' : 'error',
            duration,
            output: result,
            message: result.message,
          })
          if (updatedTrace) callbacks.onTrace?.(updatedTrace)

          await agentEventBus.emit('post-tool-use', {
            runId,
            tool,
            input: args,
            result,
          })

          let modelFacingResult = result
          let identicalReadResultRepeatCount = 0
          const readToolCallSignature = reusedLockedEditorState
            ? undefined
            : getReadToolCallSignature(tool, args)
          if (result.ok && readToolCallSignature) {
            const serializedResult = stringifyToolResult(result)
            const previousRead = readToolResultHistory.get(readToolCallSignature)

            if (previousRead?.result === serializedResult) {
              identicalReadResultRepeatCount = previousRead.repeatCount + 1
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: identicalReadResultRepeatCount,
              })
              modelFacingResult = {
                ...result,
                message: [
                  result.message,
                  '这次读取与上次完全相同，上次结果仍在上下文中。不要再次读取；请使用已有结果执行下一步写入，或直接完成回答。',
                ].join('\n\n'),
              }
            } else {
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: 0,
              })
            }
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolUse.id,
            content: stringifyToolResult(modelFacingResult),
          })

          if (identicalReadResultRepeatCount >= MAX_IDENTICAL_READ_RESULT_REPEATS) {
            callbacks.onCandidateAnswerClear?.()
            finalContent = [
              `模型连续重复调用 ${toolName}，且读取结果始终未变，已停止执行以避免循环。`,
              writeActionCompleted ? '已保留此前完成的修改。' : '本次修改尚未完成。',
            ].join('\n')
            callbacks.onStatus?.('completed')
            callbacks.onFinalAnswerRender?.(finalContent)
            const finalTrace = recorder.add({
              type: 'final',
              title: '停止重复执行',
              status: 'error',
              message: finalContent,
            })
            callbacks.onTrace?.(finalTrace)

            return {
              runId,
              content: finalContent,
              stopped: false,
              steps,
              toolCalls,
              changes,
              trace: recorder.all(),
            }
          }

          if (result.ok && isMutatingTool(tool)) {
            writeActionCompleted = true
            readToolResultHistory.clear()
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            openAITools = getOpenAITools(tools, editorStateReadLocked)
          } else if (isEditorStateStaleResult(tool, result)) {
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            documentWideSnapshotRead = false
            openAITools = getOpenAITools(tools, editorStateReadLocked)
          }

          if (result.ok && tool.name === 'editor_get_state') {
            if (!reusedLockedEditorState) {
              latestEditorStateResult = result
            }
            editorStateReadLocked = true
            openAITools = getOpenAITools(tools, editorStateReadLocked)
            if (documentWideBatchEditorIntent) {
              documentWideSnapshotRead = true
            }
          }

          if (result.ok && documentWideBatchEditorIntent && tool.name === 'editor_apply_transaction') {
            finalContent = '已在一次批量操作中完成当前文档的全部修改。'
            agentDebugLog('document_wide_batch_write_completed', {
              runId,
              operationCount: Array.isArray(args.operations) ? args.operations.length : 0,
            })
            callbacks.onStatus?.('completed')
            callbacks.onFinalAnswerRender?.(finalContent)
            const finalTrace = recorder.add({
              type: 'final',
              title: '完成批量修改',
              status: 'success',
              message: finalContent,
            })
            callbacks.onTrace?.(finalTrace)

            return {
              runId,
              content: finalContent,
              stopped: false,
              steps,
              toolCalls,
              changes,
              trace: recorder.all(),
            }
          }

          if (context.multipleFileCreation && tool.name === 'note_create_file') {
            multiCreateAttemptCount += 1
            if (result.ok) {
              multiCreateSuccessCount += 1
            }
            multiCreateMessages.push(result.message)

            if (context.requestedFileCount && multiCreateAttemptCount >= context.requestedFileCount) {
              finalContent = [
                `已完成 ${multiCreateAttemptCount} 次文件创建尝试，成功 ${multiCreateSuccessCount} 个。`,
                ...multiCreateMessages.map((message) => `- ${message}`),
              ].join('\n')
              callbacks.onStatus?.('completed')
              callbacks.onFinalAnswerRender?.(finalContent)
              const finalTrace = recorder.add({
                type: 'final',
                title: multiCreateSuccessCount > 0 ? '完成' : '创建失败',
                status: multiCreateSuccessCount > 0 ? 'success' : 'error',
                message: finalContent,
              })
              callbacks.onTrace?.(finalTrace)

              return {
                runId,
                content: finalContent,
                stopped: false,
                steps,
                toolCalls,
                changes,
                trace: recorder.all(),
              }
            }
          }

          if (context.multipleFileUpdate && tool.name === 'note_update_file') {
            multiUpdateAttemptCount += 1
            if (result.ok) {
              multiUpdateSuccessCount += 1
            }
            multiUpdateMessages.push(result.message)

            if (context.requestedFileCount && multiUpdateAttemptCount >= context.requestedFileCount) {
              finalContent = [
                `已完成 ${multiUpdateAttemptCount} 次文件更新尝试，成功 ${multiUpdateSuccessCount} 个。`,
                ...multiUpdateMessages.map((message) => `- ${message}`),
              ].join('\n')
              callbacks.onStatus?.('completed')
              callbacks.onFinalAnswerRender?.(finalContent)
              const finalTrace = recorder.add({
                type: 'final',
                title: multiUpdateSuccessCount > 0 ? '完成' : '更新失败',
                status: multiUpdateSuccessCount > 0 ? 'success' : 'error',
                message: finalContent,
              })
              callbacks.onTrace?.(finalTrace)

              return {
                runId,
                content: finalContent,
                stopped: false,
                steps,
                toolCalls,
                changes,
                trace: recorder.all(),
              }
            }
          }

          const forcedActionTool = getForcedActionTool(context)
          if (forcedActionTool === 'note_create_file' && tool.name === forcedActionTool) {
            finalContent = result.message || (
              result.ok
                ? '已按要求创建笔记文件。'
                : '未能创建笔记文件。'
            )
            callbacks.onStatus?.('completed')
            callbacks.onFinalAnswerRender?.(finalContent)
            const finalTrace = recorder.add({
              type: 'final',
              title: result.ok ? '完成' : '创建失败',
              status: result.ok ? 'success' : 'error',
              message: finalContent,
            })
            callbacks.onTrace?.(finalTrace)
            return {
              runId,
              content: finalContent,
              stopped: false,
              steps,
              toolCalls,
              changes,
              trace: recorder.all(),
            }
          }

          const forcedWriteTool = getForcedWriteTool(context)
          if (result.ok && forcedWriteTool && tool.name === forcedWriteTool) {
            writeActionCompleted = true
            finalContent = '已按要求修改选中内容。'
            agentDebugLog('forced_write_completed_final', {
              runId,
              toolName,
              content: finalContent,
            })
            callbacks.onStatus?.('completed')
            callbacks.onFinalAnswerRender?.(finalContent)
            const finalTrace = recorder.add({
              type: 'final',
              title: '完成',
              status: 'success',
              message: finalContent,
            })
            callbacks.onTrace?.(finalTrace)

            return {
              runId,
              content: finalContent,
              stopped: false,
              steps,
              toolCalls,
              changes,
              trace: recorder.all(),
            }
          }
        }

      }

      finalContent = finalContent || '已达到最大执行轮数，任务可能未完全完成。'
      callbacks.onFinalAnswerRender?.(finalContent)
      return {
        runId,
        content: finalContent,
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    } catch (error) {
      if (
        this.stopped
        || (error instanceof Error && error.message === 'USER_STOPPED')
        || isRequestAbortError(error)
      ) {
        // AbortController may surface an AbortError before the stream loop can throw
        // USER_STOPPED. Treat both paths as a normal stop and preserve what the
        // current model has already streamed to the user.
        finalContent = activeModelContent || finalContent
        finalizeInterruptedModelTrace('success', '模型响应已停止')
        callbacks.onStatus?.('stopped')
        if (finalContent) {
          callbacks.onFinalAnswerRender?.(finalContent)
        }
        return {
          runId,
          content: finalContent,
          stopped: true,
          steps,
          toolCalls,
          changes,
          trace: recorder.all(),
        }
      }

      callbacks.onStatus?.('failed')
      finalizeInterruptedModelTrace('error', '模型响应失败')
      const message = handleAIError(error, false) || (error instanceof Error ? error.message : String(error))
      const errorTrace = recorder.add({
        type: 'error',
        title: '执行失败',
        status: 'error',
        message,
      })
      callbacks.onTrace?.(errorTrace)
      throw new Error(message)
    }
  }
}
