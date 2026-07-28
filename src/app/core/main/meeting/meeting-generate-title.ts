import { createOpenAIClient } from '@/lib/ai/utils'
import { resolveModelConfig } from './meeting-model-config'

/**
 * 使用 AI 从转录文本生成简短会议标题（10字以内）
 */
export async function generateMeetingTitle(
  transcript: string,
  modelId?: string,
  signal?: AbortSignal
): Promise<string> {
  const aiConfig = resolveModelConfig(modelId)
  if (!aiConfig || !aiConfig.baseURL || !aiConfig.apiKey) {
    throw new Error('AI 模型未配置')
  }

  const openai = await createOpenAIClient(aiConfig)

  // 只取前200字节省 token
  const truncatedTranscript = transcript.slice(0, 200)

  // 调用方未传 signal 时给默认 60 秒超时（部分供应商响应较慢，30 秒容易误杀）
  const timeoutSignal = signal ?? AbortSignal.timeout(60 * 1000)

  const response = await openai.chat.completions.create({
    model: aiConfig.model || '',
    messages: [
      {
        role: 'system',
        content: '请用不超过10个字概括以下会议内容的主题，只输出标题文本，不加标点引号',
      },
      {
        role: 'user',
        content: truncatedTranscript,
      },
    ],
    temperature: 0.3,
    stream: false,
  }, { signal: timeoutSignal })

  const title = (response as any).choices?.[0]?.message?.content?.trim() || ''
  if (!title) {
    throw new Error('AI 返回空标题')
  }

  return title
}
