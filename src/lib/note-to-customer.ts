// 笔记 → 客户知识库 / 待办提取管线（2.3-C）：
// - saveNoteToCustomerKnowledge：把笔记以同名 .md 副本写入客户「资料」目录并尽力向量化，
//   落盘/索引思路复用 customer-knowledge.ts 的 finalizeMaterial 管线（同名 -2/-3 后缀、
//   embedding 未配置不阻断保存）；原笔记只读保留不动。
// - extractTodosFromNote：读笔记全文（超 8000 字截头尾）→ LLM 提取待办 →
//   createVisitTodo（confirmed=false 待确认），单条入库失败不中断其余。

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from './workspace'
import { CUSTOMER_SUBFOLDERS } from './customer-folders'
import { createVisitTodo } from '@/db/visit-todos'
import { parseDueDate } from './visit-todos'
import { fetchAi } from './ai/chat'
import { getAISettings } from './ai/utils'
import emitter from './emitter'
import { useVisitTodosStore } from '@/stores/visit-todos'

// 客户选择结果（归入知识库/提取待办共用），字段与 CustomerRecord 对齐
export interface NoteCustomerTarget {
  id: string
  name: string
  folderPath: string
}

export interface SaveNoteToCustomerResult {
  ok: boolean
  savedPath?: string // 实际写入的工作区相对路径（可能带 -2/-3 后缀）
  indexed?: boolean // 是否完成向量索引
  embeddingAvailable?: boolean // false 时文件已保存但未索引
}

export type ExtractNoteTodosStatus =
  | 'ok'
  | 'ai-not-configured' // 未配置默认 AI 模型
  | 'read-failed' // 笔记读取失败
  | 'ai-failed' // AI 请求失败（错误 toast 已由 handleAIError 弹出）

export interface ExtractNoteTodosResult {
  status: ExtractNoteTodosStatus
  extracted: number // 成功入库的待办数
  failed: number // 解析成功但写库失败的条数
}

// 待办提取的 system prompt：只输出 JSON 数组，无待办输出 []
const TODO_EXTRACT_SYSTEM_PROMPT =
  '你是待办提取助手，从笔记中提取需要后续跟进的事项。只输出 JSON 数组：[{"content":"...","owner":"...","dueDate":"YYYY-MM-DD 或空"}]，无待办输出 []'

// 笔记正文上限：超过 8000 字时截头尾（保留前 6000 + 后 2000），避免打满模型上下文
const MAX_NOTE_CHARS = 8000
const NOTE_HEAD_CHARS = 6000
const NOTE_TAIL_CHARS = 2000

/** 读取工作区相对路径的文本文件（自定义/默认工作区统一走 getFilePathOptions 解析） */
async function readWorkspaceTextFile(relativePath: string): Promise<string> {
  const options = await getFilePathOptions(relativePath)
  return readTextFile(
    options.path,
    options.baseDir ? { baseDir: options.baseDir } : undefined
  )
}

/** 写文本文件到工作区相对路径 */
async function writeWorkspaceTextFile(
  relativePath: string,
  content: string
): Promise<void> {
  const options = await getFilePathOptions(relativePath)
  await writeTextFile(
    options.path,
    content,
    options.baseDir ? { baseDir: options.baseDir } : undefined
  )
}

/**
 * 解决同名冲突：目标目录下已存在同名文件时，自动追加 -2、-3 后缀，
 * 返回可用的文件名（不含目录）。与 customer-knowledge.ts 的 resolveUniqueFileName 同思路。
 */
async function resolveUniqueFileName(
  dirRelative: string,
  fileName: string
): Promise<string> {
  const dotIdx = fileName.lastIndexOf('.')
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : ''

  let candidate = fileName
  let suffix = 2
  while (true) {
    const options = await getFilePathOptions(`${dirRelative}/${candidate}`)
    const found = await exists(
      options.path,
      options.baseDir ? { baseDir: options.baseDir } : undefined
    )
    if (!found) return candidate
    candidate = `${base}-${suffix}${ext}`
    suffix++
  }
}

/**
 * 把笔记归入客户知识库：以同名 .md 副本写入 `<客户文件夹>/资料/`，
 * 同名冲突自动加 -2/-3 后缀；落地成功后尽力向量化（embedding 未配置时不阻断保存，
 * 由调用方按 result.embeddingAvailable 提示"已保存，配置后可索引"）。
 * 原笔记只读，不做任何修改。失败（读取/写入）时抛错，由调用方提示。
 */
export async function saveNoteToCustomerKnowledge(
  notePath: string,
  noteName: string,
  customer: NoteCustomerTarget
): Promise<SaveNoteToCustomerResult> {
  // 读取笔记内容（原笔记保留不动，只读）
  const content = await readWorkspaceTextFile(notePath)

  // 幂等确保 资料/ 目录存在（客户文件夹可能被用户手动删除过）
  const materialDir = `${customer.folderPath}/${CUSTOMER_SUBFOLDERS[3]}`
  const dirOptions = await getFilePathOptions(materialDir)
  await mkdir(dirOptions.path, {
    baseDir: dirOptions.baseDir,
    recursive: true,
  })

  // 同名冲突加 -2/-3 后缀后写入副本
  const targetName = await resolveUniqueFileName(materialDir, noteName)
  const targetRelative = `${materialDir}/${targetName}`
  await writeWorkspaceTextFile(targetRelative, content)

  // 尽力向量化：embedding 模型未配置或失败时仅 console.warn，不影响保存结果
  let indexed = false
  let embeddingAvailable = true
  try {
    const { checkEmbeddingModelAvailable, processMarkdownFile } = await import(
      '@/lib/rag'
    )
    embeddingAvailable = await checkEmbeddingModelAvailable()
    if (embeddingAvailable) {
      indexed = await processMarkdownFile(targetRelative, content)
    }
  } catch (err) {
    console.warn('[NoteToCustomer] 向量化失败:', err)
  }

  // 通知客户知识库面板等监听方刷新（与会议纪要导出同一事件契约）
  emitter.emit('customer-meeting-exported', {
    customerId: customer.id,
    path: targetRelative,
  })

  return { ok: true, savedPath: targetRelative, indexed, embeddingAvailable }
}

/**
 * 从笔记中提取待办：读取全文（超 8000 字截头尾）→ fetchAi（primaryModel 槽位）→
 * 剥围栏 JSON.parse（失败按无待办）→ 逐条 createVisitTodo（confirmed=false 待确认，
 * 单条失败不中断其余）→ 刷新待办面板并累加新待办角标。
 * 本函数不弹 toast（AI 请求错误除外，由 handleAIError 统一弹出），状态由调用方提示。
 */
export async function extractTodosFromNote(input: {
  notePath: string
  customerId?: string
}): Promise<ExtractNoteTodosResult> {
  // 默认 AI 模型未配置时直接返回，避免 fetchAi 内部再弹一次"请先设置 AI 地址"
  const aiConfig = await getAISettings('primaryModel')
  if (!aiConfig?.baseURL || !aiConfig?.model) {
    return { status: 'ai-not-configured', extracted: 0, failed: 0 }
  }

  let content = ''
  try {
    content = await readWorkspaceTextFile(input.notePath)
  } catch (err) {
    console.error('[NoteToCustomer] 读取笔记失败:', err)
    return { status: 'read-failed', extracted: 0, failed: 0 }
  }

  const trimmed = content.trim()
  if (!trimmed) {
    return { status: 'ok', extracted: 0, failed: 0 }
  }

  // 超长截头尾：保留前 6000 字 + 后 2000 字
  const excerpt =
    trimmed.length > MAX_NOTE_CHARS
      ? `${trimmed.slice(0, NOTE_HEAD_CHARS)}\n\n……（中间内容省略）……\n\n${trimmed.slice(-NOTE_TAIL_CHARS)}`
      : trimmed

  const result = await fetchAi(excerpt, 'primaryModel', [
    { role: 'system', content: TODO_EXTRACT_SYSTEM_PROMPT },
    { role: 'user', content: excerpt },
  ])

  // fetchAi 失败时返回 '' 或 '请求失败: ...'（错误 toast 已由 handleAIError 弹出）
  if (!result || result.startsWith('请求失败:')) {
    return { status: 'ai-failed', extracted: 0, failed: 0 }
  }

  const todos = parseTodoJson(result)

  // 逐条入库，单条失败不中断其余
  let extracted = 0
  let failed = 0
  for (const todo of todos) {
    try {
      await createVisitTodo({
        content: todo.content,
        owner: todo.owner,
        dueDate: parseDueDate(todo.dueDate),
        customerId: input.customerId,
        confirmed: false, // AI 提取一律待确认，由用户在待办面板确认
      })
      extracted++
    } catch (err) {
      console.error('[NoteToCustomer] 待办入库失败:', err)
      failed++
    }
  }

  // 有新增待办时刷新面板并累加角标（与纪要提取收口一致；面板打开时 markTodosSeen 清零）
  if (extracted > 0) {
    const todosStore = useVisitTodosStore.getState()
    await todosStore.refreshTodos()
    todosStore.noteExtractedTodos(extracted)
  }

  return { status: 'ok', extracted, failed }
}

interface ParsedNoteTodo {
  content: string
  owner: string
  dueDate: string
}

/**
 * 解析模型输出为待办数组：剥掉 ```json / ``` 围栏后 JSON.parse，
 * 输出被解释性文字包裹时截取首个 [ 与末个 ] 之间的片段；解析失败按无待办返回 []。
 */
function parseTodoJson(raw: string): ParsedNoteTodo[] {
  let text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  if (!text.startsWith('[')) {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start >= 0 && end > start) {
      text = text.slice(start, end + 1)
    }
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    const todos: ParsedNoteTodo[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const content =
        typeof record.content === 'string' ? record.content.trim() : ''
      if (!content) continue
      todos.push({
        content,
        owner: typeof record.owner === 'string' ? record.owner.trim() : '',
        dueDate:
          typeof record.dueDate === 'string' ? record.dueDate.trim() : '',
      })
    }
    return todos
  } catch {
    // 解析失败按无待办处理
    return []
  }
}
