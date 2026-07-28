import { createOpenAIClient } from '@/lib/ai/utils'
import { resolveModelConfig } from '@/app/core/main/meeting/meeting-model-config'

/**
 * 会议纪要自动识别客户：
 * 取会议标题 + 转写开头（无转写时用纪要开头）+ 客户名单，让模型判断会议归属，
 * 输出严格 JSON（{"customerId":"..."} / {"newCustomerName":"..."} / {"none":true}）。
 * 任何异常（模型未配置/调用失败/解析失败/返回名单外 ID）都返回 null，绝不抛错，
 * 由调用方静默回退到手动归类流程。
 */

// 送入模型的证据长度：转写开头约 2000 字通常已包含寒暄与主体称谓，足够判断客户归属
const TRANSCRIPT_HEAD_CHARS = 2000
// 无转写时改用纪要开头作为判断依据
const SUMMARY_HEAD_CHARS = 2000
// 识别是轻量 JSON 判断，1 分钟超时足够
const IDENTIFY_TIMEOUT_MS = 60 * 1000
// 新客户名长度兜底截断（防止模型输出异常长串直接建档）
const NEW_CUSTOMER_NAME_MAX = 50

export interface IdentifyCustomerCandidate {
  id: string
  name: string
  type: string // enterprise | individual
  industry: string // 空串表示未填写
}

export type IdentifyMeetingCustomerResult =
  | { customerId: string } // 命中已有客户
  | { newCustomerName: string } // 提到明确客户名但名单没有
  | null // 无法判断或识别失败（含 none）

const IDENTIFY_SYSTEM_PROMPT = `你是银行客户经理助理，判断会议对应的客户。只输出 JSON：{"customerId":"..."} 或 {"newCustomerName":"..."} 或 {"none":true}。仅当证据明确时才匹配已有客户；提到明确客户名但名单没有时给 newCustomerName；无法判断给 none。只输出 JSON 本身，不要输出解释、前后缀或思考过程。`

/**
 * 识别会议对应客户（非流式、低温度，用会议已选模型，回退 primaryModel）
 */
export async function identifyMeetingCustomer(input: {
  title: string
  transcriptHead: string // 会议转写（函数内截取开头；空则用纪要开头）
  summary: string
  customers: IdentifyCustomerCandidate[]
  modelId?: string // 会议级已选模型 ID，空则回退 primaryModel
}): Promise<IdentifyMeetingCustomerResult> {
  try {
    // 模型解析与会议模块一致（resolveModelConfig 内部已回退 primaryModel）；
    // 未配置模型时返回 null，走手动归类
    const aiConfig = resolveModelConfig(input.modelId)
    if (!aiConfig || !aiConfig.baseURL || !aiConfig.apiKey) {
      return null
    }

    // 证据文本：优先转写开头，无转写用纪要开头
    const transcript = (input.transcriptHead || '').trim()
    const evidence = transcript
      ? transcript.slice(0, TRANSCRIPT_HEAD_CHARS)
      : (input.summary || '').trim().slice(0, SUMMARY_HEAD_CHARS)
    // 标题与证据都为空时没有判断依据，直接放弃（避免无意义调用）
    if (!input.title.trim() && !evidence) {
      return null
    }

    const customerLines = input.customers.length
      ? input.customers
          .map(
            (c) =>
              `- id=${c.id} 名称=${c.name} 类型=${
                c.type === 'individual' ? '个人' : '企业'
              }${c.industry ? ` 行业=${c.industry}` : ''}`
          )
          .join('\n')
      : '（客户名单为空）'

    const userMessage = [
      input.title.trim() ? `会议标题：${input.title.trim()}` : '',
      `## 客户名单\n${customerLines}`,
      `## 会议内容（开头）\n${evidence || '（无）'}`,
      '请判断该会议对应的客户，只输出 JSON。',
    ]
      .filter(Boolean)
      .join('\n\n')

    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create(
      {
        model: aiConfig.model || '',
        messages: [
          { role: 'system', content: IDENTIFY_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        top_p: aiConfig.topP ?? 1,
        stream: false,
      },
      { signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS) }
    )

    const raw = completion.choices[0]?.message?.content ?? ''
    if (!raw.trim()) return null
    return parseIdentifyResult(raw, input.customers)
  } catch (err) {
    console.warn('[IdentifyCustomer] 自动识别客户失败:', err)
    return null
  }
}

/**
 * 解析模型输出：剥离代码围栏后 JSON.parse；
 * customerId 必须确实在名单中才采信（防模型幻觉 ID），否则按 none 处理；
 * 结构不符/解析失败返回 null
 */
function parseIdentifyResult(
  raw: string,
  customers: IdentifyCustomerCandidate[]
): IdentifyMeetingCustomerResult {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
    const data: unknown = JSON.parse(cleaned)
    if (!data || typeof data !== 'object') return null
    const obj = data as Record<string, unknown>

    if (typeof obj.customerId === 'string' && obj.customerId) {
      return customers.some((c) => c.id === obj.customerId)
        ? { customerId: obj.customerId }
        : null
    }
    if (typeof obj.newCustomerName === 'string' && obj.newCustomerName.trim()) {
      return {
        newCustomerName: obj.newCustomerName.trim().slice(0, NEW_CUSTOMER_NAME_MAX),
      }
    }
    // {"none":true} 或任何其他结构都视为无法判断
    return null
  } catch (err) {
    console.warn('[IdentifyCustomer] 识别结果解析失败:', err)
    return null
  }
}
