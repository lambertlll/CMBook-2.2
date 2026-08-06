import { createOpenAIClient } from '@/lib/ai/utils'
import type { AiConfig } from '@/app/core/setting/config'
import { resolveTemplate } from './meeting-templates'
import { resolveModelConfig } from './meeting-model-config'
import useSettingStore from '@/stores/setting'
import { useNetworkStore } from '@/stores/network'

interface GenerateSummaryOptions {
  transcript: string
  manualNotes: string
  templateId: string
  title?: string
  duration?: number // 会议时长（秒）
  customerName?: string // 关联客户名称（客户拜访模板 {客户名称} 占位符来源）
  createdAt?: number // 会议创建时间戳（客户拜访模板 {日期时间} 占位符来源）
  modelId?: string // 指定模型 ID，空则用 primaryModel
  signal?: AbortSignal // 中止信号，未传时默认 5 分钟超时
  onStream?: (chunk: string) => void // 流式输出回调
}

// 长转写分段阈值：超过则走 map-reduce 分段提取要点（此时跳过笔记校正，避免校正调用超 context）
const CHUNK_TRANSCRIPT_THRESHOLD = 30000
// 分段目标大小（按段落边界切分，块间保留少量重叠上下文）
const TRANSCRIPT_CHUNK_SIZE = 13000
const TRANSCRIPT_CHUNK_OVERLAP = 300
// 分段要点提取的并发数
const CHUNK_EXTRACT_CONCURRENCY = 3
// 分段提取失败的块降级为原文片段时的最大保留字符数
const CHUNK_FALLBACK_CHARS = 3000

// 笔记反向校正转写：手动笔记是客户经理核对过的权威术语表，据此修正转写错误
const TRANSCRIPT_CORRECTION_SYSTEM_PROMPT = `你是语音转写校对助手。用户会提供一场会议的"手动笔记"和"录音转写文本"。
手动笔记由参会人亲自记录，其中的人名、公司名、产品名、术语和数字是经过核对的权威信息。
你的任务：以手动笔记为参照，修正转写文本中的同音错字、术语错误和明显误识别。

要求：
- 只修正识别错误，不改变内容结构，不总结、不增删任何信息
- 逐段输出校正后的转写全文，保持原有分段
- 笔记中没有依据的改动不要做，不确定的地方保持原文
- 只输出校正后的转写全文，不要输出解释、前后缀或思考过程`

// 长转写分段要点提取（map 阶段）
const CHUNK_EXTRACT_SYSTEM_PROMPT = `你是会议内容整理助手。用户会提供长会议转写文本的一个片段，以及会议标题和手动笔记作为背景。
你的任务：提取该片段中的关键信息，压缩为要点列表。

要求：
- 提取事实、客户需求、承诺、数字、人名、待办线索等关键信息
- 保留具体数字、金额、日期和专有名词，不要泛泛概括
- 结合手动笔记判断哪些内容是重点，笔记中的术语可作为修正转写错误的依据
- 只输出要点列表（每行一条），不要输出解释或思考过程`

// 覆盖度自检：对照手动笔记补漏，只补不改写
const COVERAGE_CHECK_SYSTEM_PROMPT = `你是会议纪要审校助手。用户会提供一份已生成的会议纪要和参会人的手动笔记。
你的任务：检查纪要是否遗漏了手动笔记中的要点。

要求：
- 若有遗漏：只输出需要补充的内容，以"## 补充（根据手动笔记）"开头，用 Markdown 列出遗漏的要点
- 只补漏，不改写、不评价已生成的纪要内容
- 若无遗漏：只输出"无遗漏"三个字，不要输出任何其他内容`

/**
 * 调用 AI 模型生成会议纪要
 * 管线：笔记校正转写（可选）→ 长转写分段提取要点（超阈值时）→ 模板流式生成 → 覆盖度自检（可选）
 * 使用 settings store 中的 primaryModel 配置，支持流式输出
 */
export async function generateMeetingSummary(
  options: GenerateSummaryOptions
): Promise<string> {
  const { transcript, manualNotes, templateId, title, duration, customerName, createdAt, modelId, onStream } = options

  // 解析模板（内置 + 自定义；自定义模板被删除等未命中场景回退默认模板，不报错）
  const template = resolveTemplate(templateId)
  // 模板占位符注入：客户拜访模板中的 {客户名称}/{日期时间} 来自会议关联客户与会议时间，
  // 无值来源时替换为"未填写"中性文案，禁止字面输出 {客户名称}
  const systemPrompt = applyTemplateContext(template.prompt, { customerName, createdAt })

  // 获取 AI 模型配置
  const aiConfig = resolveModelConfig(modelId)
  if (!aiConfig) {
    throw new Error('未配置 AI 模型，请在设置中配置主模型')
  }

  if (!aiConfig.baseURL || !aiConfig.apiKey) {
    throw new Error('AI 模型配置不完整，请检查 Base URL 和 API Key')
  }

  const { meetingTranscriptCorrection, meetingCoverageCheck } = useSettingStore.getState()
  const plainNotes = manualNotes ? htmlToPlainText(manualNotes) : ''

  // 笔记反向校正转写：仅用于纪要生成（不写回 meetings.transcript），失败静默回退原始转写。
  // 转写超过分段阈值时跳过校正，直接进入分段流程，避免校正调用超 context。
  let effectiveTranscript = transcript
  if (
    meetingTranscriptCorrection &&
    transcript &&
    plainNotes &&
    transcript.length <= CHUNK_TRANSCRIPT_THRESHOLD
  ) {
    const corrected = await correctTranscriptWithNotes(aiConfig, transcript, plainNotes, title)
    if (corrected) effectiveTranscript = corrected
  }

  // 构建 user message：长会议走 map-reduce 分段要点，短会议保持原有单段流程
  let userMessage: string
  if (effectiveTranscript.length > CHUNK_TRANSCRIPT_THRESHOLD) {
    const chunkPoints = await extractLongTranscriptPoints(aiConfig, effectiveTranscript, plainNotes, title)
    userMessage = buildChunkedUserMessage(title, chunkPoints, plainNotes, duration)
  } else {
    userMessage = buildUserMessage(title, effectiveTranscript, manualNotes, duration)
  }

  // 创建 OpenAI 客户端并调用流式接口
  const openai = await createOpenAIClient(aiConfig)
  // 调用方未传 signal 时给默认 5 分钟超时（从正式生成开始计时，前置校正/分段不占额度）
  const signal = options.signal ?? AbortSignal.timeout(5 * 60 * 1000)

  const stream = (await openai.chat.completions.create({
    model: aiConfig.model || '',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: aiConfig.temperature ?? 0.3,
    top_p: aiConfig.topP ?? 1,
    stream: true,
  }, { signal })) as unknown as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>

  let fullContent = ''

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullContent += content
      onStream?.(fullContent)
    }
  }

  // 覆盖度自检（默认关闭）：对照手动笔记检查遗漏要点，遗漏内容流式追加到纪要末尾
  if (meetingCoverageCheck && plainNotes && fullContent) {
    fullContent = await appendCoverageSupplement(aiConfig, fullContent, plainNotes, title, onStream, options.signal)
  }

  // AI 请求成功完成 → 复位离线标记（P2-1：纪要生成成功证明网络可用，
  // 任何一条真实请求成功都能让误标离线的状态自愈）
  useNetworkStore.getState().markOnline()

  return fullContent
}

/**
 * 模板占位符注入：把模板 prompt 中的 {客户名称}/{日期时间} 替换为真实值；
 * 未关联客户或无时间来源时替换为"未填写"中性文案，禁止字面输出 {客户名称}。
 * 其余占位符（如 {会议标题}/{议题名称}）是输出格式示例，交由模型按内容填充，不在此替换。
 */
function applyTemplateContext(
  prompt: string,
  ctx: { customerName?: string; createdAt?: number }
): string {
  const customerName = ctx.customerName?.trim() || '未填写'
  const dateTime = ctx.createdAt
    ? formatDateTime(new Date(ctx.createdAt))
    : '未填写'
  return prompt
    .replaceAll('{客户名称}', customerName)
    .replaceAll('{日期时间}', dateTime)
}

/** 本地日期时间 YYYY-MM-DD HH:mm（模板 {日期时间} 占位符注入用，与导出文件头部格式一致） */
function formatDateTime(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

/**
 * 笔记反向校正转写（非流式，低温度，单独 2 分钟超时）
 * 返回校正后的转写全文；失败或结果异常时返回 null（调用方回退原始转写）
 */
async function correctTranscriptWithNotes(
  aiConfig: AiConfig,
  transcript: string,
  plainNotes: string,
  title?: string
): Promise<string | null> {
  try {
    const userMessage = [
      title ? `会议标题：${title}` : '',
      `## 手动笔记（权威参照）\n${plainNotes}`,
      `## 录音转写文本（待校正）\n${transcript}`,
      '请输出校正后的转写全文。',
    ].filter(Boolean).join('\n\n')

    const corrected = await callNonStreaming(aiConfig, TRANSCRIPT_CORRECTION_SYSTEM_PROMPT, userMessage, 0.1, 2 * 60 * 1000)

    // sanity check：长度与原文偏差过大视为异常（模型可能做了总结/扩写），回退原文
    if (!corrected || corrected.length < transcript.length * 0.5 || corrected.length > transcript.length * 1.5) {
      console.warn('转写校正结果异常，回退原始转写')
      return null
    }
    return corrected
  } catch (err) {
    console.warn('转写校正失败，使用原始转写:', err)
    return null
  }
}

/**
 * 长转写 map-reduce 的 map 阶段：分段提取要点（并发执行，单块失败降级为原文截断片段）
 */
async function extractLongTranscriptPoints(
  aiConfig: AiConfig,
  transcript: string,
  plainNotes: string,
  title?: string
): Promise<string> {
  const chunks = splitTranscriptIntoChunks(transcript)
  const total = chunks.length

  const pointsList = await mapWithConcurrency(chunks, CHUNK_EXTRACT_CONCURRENCY, async (chunk, i) => {
    try {
      const userMessage = [
        title ? `会议标题：${title}` : '',
        plainNotes ? `## 手动笔记（背景参照）\n${plainNotes}` : '',
        `## 转写片段（第 ${i + 1}/${total} 段）\n${chunk}`,
        '请提取该片段的关键信息要点。',
      ].filter(Boolean).join('\n\n')

      const points = await callNonStreaming(aiConfig, CHUNK_EXTRACT_SYSTEM_PROMPT, userMessage, 0.2, 2 * 60 * 1000)
      if (!points) throw new Error('要点提取返回空')
      return `### 第 ${i + 1}/${total} 段要点\n${points}`
    } catch (err) {
      // 单块失败不整体失败：降级为该块原文截断片段拼入
      console.warn(`第 ${i + 1} 段要点提取失败，降级为原文片段:`, err)
      return `### 第 ${i + 1}/${total} 段原文片段（要点提取失败，保留原文）\n${truncateChunkFallback(chunk)}`
    }
  })

  return pointsList.join('\n\n')
}

/**
 * 按段落边界把长转写切成约 TRANSCRIPT_CHUNK_SIZE 字符的块，块间保留少量重叠上下文
 */
function splitTranscriptIntoChunks(transcript: string): string[] {
  const paragraphs = transcript.split('\n')
  const chunks: string[] = []
  let current = ''
  for (const para of paragraphs) {
    if (current.length > 0 && current.length + para.length + 1 > TRANSCRIPT_CHUNK_SIZE) {
      chunks.push(current)
      // 重叠上下文：带上前一块末尾内容，帮助模型理解衔接
      current = `${current.slice(-TRANSCRIPT_CHUNK_OVERLAP)}\n${para}`
    } else {
      current = current ? `${current}\n${para}` : para
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * 分段提取失败时的降级片段：保留块的头尾，省略中间
 */
function truncateChunkFallback(chunk: string): string {
  if (chunk.length <= CHUNK_FALLBACK_CHARS) return chunk
  const head = Math.floor(CHUNK_FALLBACK_CHARS * 0.6)
  const tail = CHUNK_FALLBACK_CHARS - head
  return `${chunk.slice(0, head)}\n……[中间内容省略]……\n${chunk.slice(-tail)}`
}

/**
 * 简单并发池：最多 limit 路并发执行 fn，结果顺序与输入一致
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 覆盖度自检（可选，默认关闭）：对照手动笔记检查纪要遗漏的要点，
 * 遗漏内容流式追加到纪要末尾（只补不改写）；失败或无遗漏时返回原纪要
 */
async function appendCoverageSupplement(
  aiConfig: AiConfig,
  summary: string,
  plainNotes: string,
  title: string | undefined,
  onStream?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  try {
    const openai = await createOpenAIClient(aiConfig)
    const userMessage = [
      title ? `会议标题：${title}` : '',
      `## 手动笔记\n${plainNotes}`,
      `## 已生成纪要\n${summary}`,
    ].filter(Boolean).join('\n\n')

    const stream = (await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages: [
        { role: 'system', content: COVERAGE_CHECK_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      top_p: aiConfig.topP ?? 1,
      stream: true,
    }, { signal: signal ?? AbortSignal.timeout(2 * 60 * 1000) })) as unknown as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>

    let supplement = ''
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        supplement += content
        // 开头疑似"无遗漏"判定时先不透出，避免先显示又撤回
        if (!supplement.trimStart().startsWith('无遗漏')) {
          onStream?.(`${summary}\n\n${supplement}`)
        }
      }
    }

    const cleaned = supplement.trim()
    // 模型判定无遗漏（约定输出"无遗漏"）时丢弃本次输出，保持原纪要
    if (!cleaned || (cleaned.startsWith('无遗漏') && cleaned.length <= 10)) {
      onStream?.(summary)
      return summary
    }
    const finalSummary = `${summary}\n\n${cleaned}`
    onStream?.(finalSummary)
    return finalSummary
  } catch (err) {
    console.warn('覆盖度自检失败，保留原纪要:', err)
    onStream?.(summary)
    return summary
  }
}

/**
 * 非流式 AI 调用（校正/分段提取共用）：同一模型配置，独立超时
 */
async function callNonStreaming(
  aiConfig: AiConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  timeoutMs: number
): Promise<string> {
  const openai = await createOpenAIClient(aiConfig)
  const completion = await openai.chat.completions.create({
    model: aiConfig.model || '',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    top_p: aiConfig.topP ?? 1,
    stream: false,
  }, { signal: AbortSignal.timeout(timeoutMs) })

  return completion.choices[0]?.message?.content?.trim() || ''
}

/**
 * 构建发送给 AI 的用户消息（转写未超分段阈值时的单段流程）
 */
function buildUserMessage(
  title: string | undefined,
  transcript: string,
  manualNotes: string,
  duration?: number
): string {
  const parts: string[] = []

  parts.push(buildMeetingMeta(title, duration))

  if (transcript) {
    parts.push(`## 录音转写文本\n${transcript}`)
  }

  if (manualNotes) {
    // 去除 HTML 标签并解码实体，保留纯文本
    const plainNotes = htmlToPlainText(manualNotes)
    if (plainNotes) {
      parts.push(`## 手动笔记（重点标注，优先参考）\n${plainNotes}`)
    }
  }

  parts.push('\n---\n请根据以上内容，严格按照系统提示要求的格式生成会议纪要。')

  return parts.join('\n\n')
}

/**
 * 构建长会议的用户消息：会议信息 + 手动笔记（优先）+ 各块要点汇总（不再塞原始长转写）
 */
function buildChunkedUserMessage(
  title: string | undefined,
  chunkPoints: string,
  plainNotes: string,
  duration?: number
): string {
  const parts: string[] = []

  parts.push(buildMeetingMeta(title, duration))

  if (plainNotes) {
    parts.push(`## 手动笔记（重点标注，优先参考）\n${plainNotes}`)
  }

  parts.push(`## 分段要点汇总（转写文本较长，以下为按顺序分段提取的要点）\n${chunkPoints}`)

  parts.push('\n---\n请根据以上内容，严格按照系统提示要求的格式生成会议纪要。')

  return parts.join('\n\n')
}

/**
 * 会议元信息（标题/日期/时长）
 */
function buildMeetingMeta(title: string | undefined, duration?: number): string {
  const metaLines: string[] = []
  if (title) {
    metaLines.push(`- **会议标题**：${title}`)
  }
  metaLines.push(`- **会议日期**：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`)
  if (duration && duration > 0) {
    const h = Math.floor(duration / 3600)
    const m = Math.floor((duration % 3600) / 60)
    const s = duration % 60
    const durationStr = h > 0 ? `${h}小时${m}分钟` : m > 0 ? `${m}分钟${s}秒` : `${s}秒`
    metaLines.push(`- **会议时长**：${durationStr}`)
  }
  return `## 会议信息\n${metaLines.join('\n')}`
}

interface RewriteSelectionOptions {
  selectedText: string // 纪要中被选中的文字
  instruction: string // 修改指令（预设操作或自定义）
  title?: string // 会议标题，作为上下文
  modelId?: string // 指定模型 ID，空则用 primaryModel
  signal?: AbortSignal // 中止信号，未传时默认 2 分钟超时
}

// 局部改写的输出约束：只要改写后的文字，禁止解释/原文/思考过程
const REWRITE_SELECTION_SYSTEM_PROMPT = `你是会议纪要编辑助手。用户会给你一段会议纪要中被选中的文字和一条修改指令。
要求：
- 严格按照指令改写选中文字，输出 Markdown 格式
- 只输出改写后的文字本身，不要输出解释、原文、引号包裹或任何额外内容
- 不要输出思考过程或 <think> 标签
- 保持与会议纪要整体一致的专业语气`

/**
 * 局部 AI 修改：按指令改写纪要中选中的文字（非流式，一次性返回）
 * 模型解析逻辑与生成纪要一致（resolveModelConfig）
 */
export async function rewriteSummarySelection(
  options: RewriteSelectionOptions
): Promise<string> {
  const { selectedText, instruction, title, modelId } = options
  // 局部改写体量小，2 分钟超时足够
  const signal = options.signal ?? AbortSignal.timeout(2 * 60 * 1000)

  // 获取 AI 模型配置（与生成纪要同一逻辑）
  const aiConfig = resolveModelConfig(modelId)
  if (!aiConfig) {
    throw new Error('未配置 AI 模型，请在设置中配置主模型')
  }
  if (!aiConfig.baseURL || !aiConfig.apiKey) {
    throw new Error('AI 模型配置不完整，请检查 Base URL 和 API Key')
  }

  const userMessage = `${title ? `会议纪要标题：${title}\n\n` : ''}选中文字：\n${selectedText}\n\n修改指令：${instruction}`

  const openai = await createOpenAIClient(aiConfig)

  const completion = await openai.chat.completions.create({
    model: aiConfig.model || '',
    messages: [
      { role: 'system', content: REWRITE_SELECTION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: aiConfig.temperature ?? 0.5,
    top_p: aiConfig.topP ?? 1,
    stream: false,
  }, { signal })

  return completion.choices[0]?.message?.content?.trim() || ''
}

/**
 * 将 HTML 转为纯文本（同时解码 &nbsp; &amp; 等实体）
 */
function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').trim()
}
