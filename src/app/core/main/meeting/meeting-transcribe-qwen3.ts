/**
 * 阿里云百炼 Qwen3-ASR-Flash 录音文件识别
 * 同步多模态接口：services/aigc/multimodal-generation/generation
 * 单音频限制 ≤10MB / ≤5 分钟，故按 4 分钟分段并发提交
 * 支持 system 文本做上下文增强（热词注入），不支持说话人分离、不支持 vocabulary_id
 * 文档：https://help.aliyun.com/zh/model-studio/qwen3-asr-flash
 */

import { invokeAiJson } from '@/lib/ai/tauri-client'
import { encodeAudioBufferToWav, isRetryableError } from './meeting-transcribe'

export interface Qwen3ASRConfig {
  apiKey: string
  workspaceId: string // 百炼业务空间 ID
  language?: string // 默认 'zh'
  hotwords?: string[] // 自定义热词（作为 system 上下文注入，提升术语识别）
  /** 同步接口模型名（默认 qwen3-asr-flash；可选 qwen-audio-3.0-asr-flash 等同步模型） */
  model?: string
}

export interface Qwen3TranscribeResult {
  text: string
  duration?: number
}

// 单段最大时长（秒）：3 分钟。
// 百炼同步多模态接口限制：单音频 ≤10MB / ≤5 分钟；但经 HTTP Base64 传输时官方要求原始文件 <7MB
// （16kHz 16bit 单声道 WAV 约 32KB/秒，3 分钟 ≈ 5.76MB，留足余量；此前 4 分钟段 7.68MB 超限，
// 长录音整段转写时会被网关以 400 InvalidParameter 拒绝）
const MAX_SEGMENT_DURATION = 3 * 60

interface MultimodalResponse {
  output?: {
    choices?: Array<{
      message?: {
        // 按官方返回结构为 [{ text: '...' }]，兼容字符串形式
        content?: Array<{ text?: string }> | string
      }
    }>
  }
}

/**
 * 使用 qwen3-asr-flash 转写音频
 * @param audioBlob 原始音频
 * @param config 阿里云配置
 * @param onProgress 进度回调 (0-100)
 */
export async function transcribeWithQwen3Asr(
  audioBlob: Blob,
  config: Qwen3ASRConfig,
  onProgress?: (progress: number) => void
): Promise<Qwen3TranscribeResult> {
  const baseUrl = `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`
  const language = config.language || 'zh'

  onProgress?.(2)
  console.log('[Qwen3 ASR] 原始音频格式:', audioBlob.type, '大小:', audioBlob.size)

  // 解码音频为 16kHz PCM
  onProgress?.(5)
  // 兼容 macOS WKWebView 的 webkit 前缀
  const AudioCtxCtor: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioCtxCtor({ sampleRate: 16000 })
  let audioBuffer: AudioBuffer
  try {
    const arrayBuffer = await audioBlob.arrayBuffer()
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  } catch (err) {
    console.error('[Qwen3 ASR] 音频解码失败:', err)
    throw new Error('音频解码失败，文件可能损坏或格式不支持')
  } finally {
    await audioContext.close()
  }

  const totalDuration = audioBuffer.duration
  console.log('[Qwen3 ASR] 音频时长:', totalDuration, '秒')

  // 按时长切分（单段不超过 4 分钟）
  const sampleRate = audioBuffer.sampleRate
  const totalSamples = audioBuffer.length
  const segmentSamples = MAX_SEGMENT_DURATION * sampleRate
  const segments: Array<{ start: number; end: number; index: number }> = []
  let offset = 0
  let index = 0
  while (offset < totalSamples) {
    const end = Math.min(offset + segmentSamples, totalSamples)
    segments.push({ start: offset, end, index })
    offset = end
    index++
  }

  const totalSegments = segments.length
  console.log(`[Qwen3 ASR] 分段转写: ${totalSegments} 段, 每段约 ${MAX_SEGMENT_DURATION / 60} 分钟`)

  onProgress?.(10)

  // 并行转写所有段（最多 3 个并发，避免被限流）
  // WAV 编码放在批处理循环内，转写完即释放，避免一次性编码全部段的内存峰值
  const results: Array<{ index: number; text: string }> = []
  const failedSegments: number[] = []
  const concurrency = 3
  let completedCount = 0

  const processSegment = async (seg: { start: number; end: number; index: number }) => {
    const wavBlob = encodeAudioBufferToWav(audioBuffer, seg.start, seg.end)
    const text = await transcribeSegmentWithRetry(
      wavBlob, baseUrl, config, language, seg.index
    )
    completedCount++
    const progress = 10 + Math.round((completedCount / totalSegments) * 85)
    onProgress?.(progress)
    return { index: seg.index, text }
  }

  // 分批并行执行，单段失败不中断其它段
  for (let i = 0; i < totalSegments; i += concurrency) {
    const batch = segments.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map((seg) => processSegment(seg))
    )
    batchResults.forEach((res, batchIndex) => {
      if (res.status === 'fulfilled') {
        results.push(res.value)
      } else {
        failedSegments.push(batch[batchIndex].index)
        console.error(
          `[Qwen3 ASR] 第 ${batch[batchIndex].index + 1} 段转写失败:`,
          res.reason
        )
      }
    })
  }

  // 有失败段时抛出带段号信息的错误
  if (failedSegments.length > 0) {
    throw new Error(
      `转写未完成：共 ${totalSegments} 段，第 ${failedSegments.map((n) => n + 1).join('、')} 段失败，请重试`
    )
  }

  // 按顺序合并结果
  results.sort((a, b) => a.index - b.index)
  const fullText = results
    .map((r) => r.text.trim())
    .filter(Boolean)
    .join('\n')

  onProgress?.(100)

  return {
    text: fullText,
    duration: totalDuration,
  }
}

/**
 * 转写单个 ≤5 分钟的 WAV 音频片段（对外复用：整段转写与实时转写预览共用）。
 * 单次请求不带重试，需要重试由调用方处理。
 */
export async function transcribeQwen3Segment(
  wavBlob: Blob,
  config: Qwen3ASRConfig,
  language = 'zh'
): Promise<string> {
  const baseUrl = `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`
  return transcribeSegment(wavBlob, baseUrl, config, language)
}

/**
 * 带重试的分段转写：对可重试错误做指数退避，最多 3 次
 */
async function transcribeSegmentWithRetry(
  wavBlob: Blob,
  baseUrl: string,
  config: Qwen3ASRConfig,
  language: string,
  segmentIndex: number
): Promise<string> {
  const maxAttempts = 3
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transcribeSegment(wavBlob, baseUrl, config, language)
    } catch (err) {
      lastError = err
      if (!isRetryableError(err) || attempt === maxAttempts) break
      const delayMs = 1000 * 2 ** (attempt - 1)
      console.warn(
        `[Qwen3 ASR] 第 ${segmentIndex + 1} 段转写失败，${delayMs / 1000}s 后重试 (${attempt}/${maxAttempts}):`,
        err
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

/**
 * 转写单个音频片段：WAV → base64 Data URI → 多模态接口
 */
async function transcribeSegment(
  wavBlob: Blob,
  baseUrl: string,
  config: Qwen3ASRConfig,
  language: string
): Promise<string> {
  console.log(`[Qwen3 ASR] 转写片段: ${(wavBlob.size / 1024 / 1024).toFixed(1)}MB`)

  const dataUri = await blobToBase64DataUri(wavBlob)

  // system 文本做上下文增强：有热词时注入术语表，无热词时给简短领域上下文
  const hotwords = config.hotwords || []
  const contextText = hotwords.length > 0
    ? `以下是银行金融领域的会议录音，请参考以下术语准确转写：${hotwords.join('、')}`
    : '以下是银行金融领域的会议录音，请准确转写为文字。'

  const body = {
    model: config.model || 'qwen3-asr-flash',
    input: {
      messages: [
        { role: 'system', content: [{ text: contextText }] },
        { role: 'user', content: [{ audio: dataUri }] },
      ],
    },
    parameters: {
      asr_options: {
        language,
        enable_itn: true, // 逆文本正则化：数字/标点转书面形式
      },
    },
  }

  // 超时保护：单段最多等 5 分钟
  const timeoutMs = 5 * 60 * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await invokeAiJson<MultimodalResponse>({
      config: {
        baseUrl,
        apiKey: config.apiKey,
      },
      path: '/services/aigc/multimodal-generation/generation',
      body,
    }, controller.signal)

    return extractText(result)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`转写超时（超过 ${timeoutMs / 1000} 秒），音频片段可能过大`)
    }
    const errMsg = String(err?.message || err)
    // 百炼 400 InvalidParameter：多为音频片段超出 Base64 传输限制（官方要求原始文件 <7MB）
    if (errMsg.includes('InvalidParameter') || errMsg.includes('<400>')) {
      console.error(
        `[Qwen3 ASR] 转写片段被服务端拒绝(400): ${errMsg}；片段大小 ${(wavBlob.size / 1024 / 1024).toFixed(1)}MB`
      )
      throw new Error(
        `音频片段被服务端拒绝（可能超出接口大小限制，片段 ${(wavBlob.size / 1024 / 1024).toFixed(1)}MB）`
      )
    }
    console.error('[Qwen3 ASR] 转写片段失败:', errMsg)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析多模态接口响应：output.choices[0].message.content 可能是数组或字符串
 */
function extractText(result: MultimodalResponse): string {
  const content = result.output?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

/**
 * Blob 转 base64 Data URI（分块编码，避免大文件卡死主线程）
 */
async function blobToBase64DataUri(blob: Blob): Promise<string> {
  const uint8Array = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK_SIZE = 0x8000
  for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      uint8Array.subarray(i, i + CHUNK_SIZE) as unknown as number[]
    )
  }
  return `data:${blob.type || 'audio/wav'};base64,${btoa(binary)}`
}
