import useSettingStore from '@/stores/setting'
import { useNetworkStore, isNetworkError } from '@/stores/network'
import { blobToBytes, invokeAiMultipart } from '@/lib/ai/tauri-client'
import { transcribeWithAliyun, type AliyunASRConfig } from './meeting-transcribe-aliyun'
import { transcribeWithQwen3Asr } from './meeting-transcribe-qwen3'

interface TranscribeOptions {
  audioBlob: Blob
  language?: string // 默认 'zh'
  onProgress?: (progress: number) => void // 0-100
}

interface TranscribeResult {
  text: string
  duration?: number
}

interface TranscriptionResponse {
  text: string
  duration?: number
}

// 单段最大时长（秒）：10 分钟
const MAX_SEGMENT_DURATION = 10 * 60

/**
 * 解析用户配置的热词文本：支持每行一个，或用逗号/顿号/分号（含全角）分隔
 */
export function parseHotwords(raw: string): string[] {
  if (!raw) return []
  return [...new Set(raw.split(/[\n,，、;；]+/).map((w) => w.trim()).filter(Boolean))]
}

/**
 * 将音频 Blob 编码为 base64。
 * 分块编码 + 每块让出事件循环（await nextTick），避免大文件（如 2h 录音数百 MB）
 * 的 base64 化同步阻塞主线程导致 UI 冻结（录音计时/笔记输入/按钮响应）。
 */
async function encodeBlobToBase64(audioBlob: Blob): Promise<string> {
  const arrayBuffer = await audioBlob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  // 预分配输出数组，避免字符串拼接的反复 realloc
  const chunks: string[] = []
  const CHUNK_SIZE = 0x8000
  const blockSize = 1024 * 1024 // 每处理 1MB 让出一次事件循环
  let processed = 0
  while (processed < uint8Array.length) {
    const blockEnd = Math.min(processed + blockSize, uint8Array.length)
    let binary = ''
    for (let i = processed; i < blockEnd; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        uint8Array.subarray(i, i + CHUNK_SIZE) as unknown as number[]
      )
    }
    chunks.push(btoa(binary))
    processed = blockEnd
    // 让出主线程：使 UI（计时/输入/按钮）在编码间隙可响应
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return chunks.join('')
}

/**
 * 转写音频
 * 根据用户选择的 STT 引擎分发到对应服务
 */
export async function transcribeAudio(options: TranscribeOptions): Promise<TranscribeResult> {
  const { audioBlob, language = 'zh', onProgress } = options
  const { sttEngine, aliyunAsrApiKey, aliyunAsrWorkspaceId, aliyunAsrHotwords, aliyunAsrDiarization, aliyunAsrModel } = useSettingStore.getState()

  // 阿里云百炼引擎
  if (sttEngine === 'aliyun') {
    if (!aliyunAsrApiKey || !aliyunAsrWorkspaceId) {
      throw new Error('阿里云 ASR 未配置，请在设置中填写 API Key 和业务空间 ID')
    }

    // Qwen3/Qwen-Audio 走同步多模态接口（单音频 ≤5 分钟，内部分段并发），失败不降级到 fun-asr
    // qwen3-asr-flash-realtime / qwen-audio-3.0-asr-flash-streaming 是 WebSocket 实时模型，
    // 仅服务录音中的实时预览；整段重转写时降级走 qwen3-asr-flash 同步分段通道
    if (
      aliyunAsrModel === 'qwen3-asr-flash' ||
      aliyunAsrModel === 'qwen3-asr-flash-realtime' ||
      aliyunAsrModel === 'qwen-audio-3.0-asr-flash' ||
      aliyunAsrModel === 'qwen-audio-3.0-asr-flash-streaming'
    ) {
      // 同步 qwen 系列模型直接传模型名；realtime/streaming（WebSocket 实时）整段重转写时
      // 降级走 qwen3-asr-flash 同步分段通道
      const syncModel =
        aliyunAsrModel === 'qwen-audio-3.0-asr-flash'
          ? aliyunAsrModel
          : 'qwen3-asr-flash'
      const result = await transcribeWithQwen3Asr(audioBlob, {
        apiKey: aliyunAsrApiKey,
        workspaceId: aliyunAsrWorkspaceId,
        language,
        hotwords: parseHotwords(aliyunAsrHotwords),
        model: syncModel,
      }, onProgress)
      return { text: result.text, duration: result.duration }
    }

    // fun-asr / paraformer-v2 走同一套异步任务通道，仅 model 名不同
    onProgress?.(2)
    const base64 = await encodeBlobToBase64(audioBlob)
    const mimeType = audioBlob.type || 'audio/wav'

    const config: AliyunASRConfig = {
      apiKey: aliyunAsrApiKey,
      workspaceId: aliyunAsrWorkspaceId,
      model: aliyunAsrModel || 'fun-asr',
      languageHints: [language, 'en'],
      enableDiarization: aliyunAsrDiarization,
      hotwords: parseHotwords(aliyunAsrHotwords),
    }
    const result = await transcribeWithAliyun(base64, mimeType, config, onProgress)
    return { text: result.text, duration: result.duration }
  }

  // OpenAI 兼容引擎（硅基流动 / Groq / 其他）
  const sttConfig = resolveSTTConfig()

  if (!sttConfig) {
    throw new Error('未配置语音识别模型，请在设置中配置 STT 模型')
  }

  onProgress?.(2)
  console.log('[Meeting] 原始音频格式:', audioBlob.type, '大小:', audioBlob.size)

  // 解码音频为 PCM
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
    console.error('[Meeting] 音频解码失败:', err)
    throw new Error('音频解码失败，文件可能损坏或格式不支持')
  } finally {
    await audioContext.close()
  }

  const totalDuration = audioBuffer.duration
  console.log('[Meeting] 音频时长:', totalDuration, '秒')

  // 判断是否需要分段
  if (totalDuration <= MAX_SEGMENT_DURATION) {
    // 不需要分段，直接转码为 WAV 后转写
    onProgress?.(10)
    const wavBlob = encodeAudioBufferToWav(audioBuffer, 0, audioBuffer.length)
    console.log('[Meeting] 单段 WAV 大小:', wavBlob.size)
    const result = await transcribeChunkWithRetry(wavBlob, language, sttConfig, 0)
    onProgress?.(100)
    return { text: result.text, duration: totalDuration }
  }

  // 需要分段：按 10 分钟切分
  return transcribeSegmented(audioBuffer, totalDuration, language, sttConfig, onProgress)
}

/**
 * 用 fun-asr + 说话人分离重转写音频（结束后自动补充说话人标注用）
 * qwen3-asr-flash-realtime 不支持说话人分离，这里直接调 fun-asr 异步任务通道，
 * 绕过 aliyunAsrModel 分发；热词等阿里云配置沿用用户设置
 */
export async function transcribeWithFunAsrDiarization(
  audioBlob: Blob,
  onProgress?: (progress: number) => void
): Promise<TranscribeResult> {
  const { aliyunAsrApiKey, aliyunAsrWorkspaceId, aliyunAsrHotwords } = useSettingStore.getState()
  if (!aliyunAsrApiKey || !aliyunAsrWorkspaceId) {
    throw new Error('阿里云 ASR 未配置，请在设置中填写 API Key 和业务空间 ID')
  }

  onProgress?.(2)
  const base64 = await encodeBlobToBase64(audioBlob)
  const mimeType = audioBlob.type || 'audio/wav'

  const config: AliyunASRConfig = {
    apiKey: aliyunAsrApiKey,
    workspaceId: aliyunAsrWorkspaceId,
    model: 'fun-asr',
    languageHints: ['zh', 'en'],
    enableDiarization: true,
    hotwords: parseHotwords(aliyunAsrHotwords),
  }
  const result = await transcribeWithAliyun(base64, mimeType, config, onProgress)
  return { text: result.text, duration: result.duration }
}

/**
 * 纠错降级转写：整段转写失败（如浏览器 decodeAudioData 无法解析 2h+ 大 webm）时，
 * 用已保存的音频文件走阿里云 fun-asr「异步任务」通道重转写——
 * 服务端解码（支持 12h / 2GB 音频，无浏览器解码限制），说话人分离按用户设置。
 * 音频经 base64 直传，不依赖浏览器 AudioContext。
 */
export async function transcribeWithAliyunFallback(
  audioBlob: Blob,
  onProgress?: (progress: number) => void
): Promise<TranscribeResult> {
  const {
    aliyunAsrApiKey,
    aliyunAsrWorkspaceId,
    aliyunAsrHotwords,
    aliyunAsrDiarization,
  } = useSettingStore.getState()
  if (!aliyunAsrApiKey || !aliyunAsrWorkspaceId) {
    throw new Error('阿里云 ASR 未配置，无法降级转写')
  }

  onProgress?.(2)
  const base64 = await encodeBlobToBase64(audioBlob)
  const mimeType = audioBlob.type || 'audio/wav'

  const config: AliyunASRConfig = {
    apiKey: aliyunAsrApiKey,
    workspaceId: aliyunAsrWorkspaceId,
    model: 'fun-asr',
    languageHints: ['zh', 'en'],
    enableDiarization: aliyunAsrDiarization,
    hotwords: parseHotwords(aliyunAsrHotwords),
  }
  const result = await transcribeWithAliyun(base64, mimeType, config, onProgress)
  if (!result.text || !result.text.trim()) {
    throw new Error('阿里云转写结果为空')
  }
  return { text: result.text, duration: result.duration }
}

/** 判断错误是否为浏览器解码类失败（2h+ 大 webm 超容器上限等） */
export function isDecodeFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('音频解码失败') ||
    msg.includes('解码') ||
    msg.includes('文件可能损坏') ||
    msg.includes('decode')
  )
}

/**
 * 统一转写入口（带全模型兜底）：优先按用户配置走主通道；
 * 失败时按模型类型自动降级——
 * - qwen 系列（浏览器 decodeAudioData 解码）→ 降级 fun-asr 服务端异步任务（12h/2GB）
 * - fun-asr / paraformer-v2（本身服务端异步任务）→ 自动重试一次（任务偶发失败/网络抖动）
 * - OpenAI 兼容引擎（硅基流动等，浏览器解码）→ 有阿里云配置则降级 fun-asr，无则抛原错
 * 返回 usedFallback 标记是否走了降级（调用方可用于提示用户/进度展示）。
 */
export interface TranscribeWithFallbackResult {
  text: string
  duration?: number
  usedFallback: boolean
}

export async function transcribeAudioWithFallback(
  audioBlob: Blob,
  options: Omit<TranscribeOptions, 'audioBlob'> = {}
): Promise<TranscribeWithFallbackResult> {
  const { language = 'zh', onProgress } = options
  const { sttEngine, aliyunAsrModel, aliyunAsrApiKey, aliyunAsrWorkspaceId } =
    useSettingStore.getState()
  const isAliyunAsyncModel =
    sttEngine === 'aliyun' &&
    (aliyunAsrModel === 'fun-asr' || aliyunAsrModel === 'paraformer-v2')

  try {
    // 主通道：按用户配置转写
    const result = await transcribeAudio({ audioBlob, language, onProgress })
    // HTTP 响应成功即证明网络可达：先复位离线标记（P2-2：判定网络可达性，
    // 不应被下方"空文本"业务校验挡住——请求成功但返回空文本时同样证明网络已恢复）
    useNetworkStore.getState().markOnline()
    // 空文本视为失败（服务端可能返回空，导致「转写成功但无内容」的假完成）
    if (!result.text || !result.text.trim()) {
      throw new Error('转写结果为空，请重试或检查语音识别模型配置')
    }
    return { text: result.text, duration: result.duration, usedFallback: false }
  } catch (primaryErr) {
    // 网络类错误（断网/超时/连接失败）→ 标记离线，联动离线模式（录音继续、跳过联网功能）
    if (isNetworkError(primaryErr)) {
      useNetworkStore.getState().markOffline()
    }
    const hasAliyun = !!(aliyunAsrApiKey && aliyunAsrWorkspaceId)

    // fun-asr/paraformer 本身是服务端异步任务（无浏览器解码问题）：
    // 失败多为任务偶发失败/网络抖动，自动重试一次（transcribeWithAliyunFallback 同为
    // fun-asr 异步任务，任务级失败重试通常可恢复；若仍失败会抛错走 catch 最终保险）
    if (isAliyunAsyncModel && hasAliyun) {
      console.warn('[Transcribe] 异步任务通道失败，自动重试一次:', primaryErr)
      try {
        const retry = await transcribeWithAliyunFallback(audioBlob, onProgress)
        // 重试成功证明网络可用：复位离线标记
        useNetworkStore.getState().markOnline()
        return { text: retry.text, duration: retry.duration, usedFallback: true }
      } catch (retryErr) {
        console.error('[Transcribe] fun-asr 重试仍失败:', retryErr)
        throw retryErr
      }
    }

    // 其余模型（qwen 浏览器解码 / OpenAI 兼容引擎）：有阿里云配置时降级 fun-asr 服务端。
    // 不限于解码失败——qwen 400 片段超限/网络错误等主通道失败都值得用服务端通道重试
    if (hasAliyun && !isAliyunAsyncModel) {
      console.warn('[Transcribe] 主通道失败，降级 fun-asr 服务端重转写:', primaryErr)
      try {
        const fallback = await transcribeWithAliyunFallback(audioBlob, onProgress)
        // 降级成功证明网络可用：复位离线标记
        useNetworkStore.getState().markOnline()
        return { text: fallback.text, duration: fallback.duration, usedFallback: true }
      } catch (fallbackErr) {
        console.error('[Transcribe] fun-asr 降级也失败:', fallbackErr)
      }
    }

    // 无法降级或降级失败：抛原错误
    throw primaryErr
  }
}

/**
 * 分段转写：按时长切分 PCM 数据，并行提交
 */
async function transcribeSegmented(
  audioBuffer: AudioBuffer,
  totalDuration: number,
  language: string,
  config: STTConfig,
  onProgress?: (progress: number) => void
): Promise<TranscribeResult> {
  const sampleRate = audioBuffer.sampleRate
  const totalSamples = audioBuffer.length
  const segmentSamples = MAX_SEGMENT_DURATION * sampleRate

  // 计算分段
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
  console.log(`[Meeting] 分段转写: ${totalSegments} 段, 每段约 ${MAX_SEGMENT_DURATION / 60} 分钟`)

  onProgress?.(10)

  // 并行转写所有段（最多 3 个并发，避免被限流）
  // WAV 编码放在批处理循环内，转写完即释放，避免一次性编码全部段的内存峰值
  const results: Array<{ index: number; text: string }> = []
  const failedSegments: number[] = []
  const concurrency = 3
  let completedCount = 0

  const processSegment = async (seg: { start: number; end: number; index: number }) => {
    const wavBlob = encodeAudioBufferToWav(audioBuffer, seg.start, seg.end)
    const result = await transcribeChunkWithRetry(wavBlob, language, config, seg.index)
    completedCount++
    const progress = 10 + Math.round((completedCount / totalSegments) * 85)
    onProgress?.(progress)
    return { index: seg.index, text: result.text }
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
          `[Meeting] 第 ${batch[batchIndex].index + 1} 段转写失败:`,
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
 * 将 AudioBuffer 的指定采样范围编码为 WAV Blob
 */
export function encodeAudioBufferToWav(
  audioBuffer: AudioBuffer,
  startSample: number,
  endSample: number
): Blob {
  const sampleRate = audioBuffer.sampleRate
  const channelData = audioBuffer.getChannelData(0) // 单声道
  const segmentData = channelData.slice(startSample, endSample)

  // 转换为 16-bit PCM
  const pcmData = new Int16Array(segmentData.length)
  for (let i = 0; i < segmentData.length; i++) {
    const sample = Math.max(-1, Math.min(1, segmentData[i]))
    pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  // 构建 WAV 文件
  const wavBuffer = encodeWav(pcmData, sampleRate, 1)
  return new Blob([wavBuffer], { type: 'audio/wav' })
}

/**
 * 解析 STT 模型配置
 */
function resolveSTTConfig(): STTConfig | null {
  const { aiModelList, sttModel } = useSettingStore.getState()

  // 1. 优先使用明确配置的 sttModel
  if (sttModel) {
    for (const config of aiModelList) {
      if (config.models && config.models.length > 0) {
        const targetModel = config.models.find(
          (model) =>
            model.modelType === 'stt' &&
            (model.id === sttModel || `${config.key}-${model.id}` === sttModel)
        )
        if (targetModel) {
          return {
            baseUrl: config.baseURL || '',
            apiKey: config.apiKey || '',
            model: targetModel.model,
            customHeaders: config.customHeaders,
          }
        }
      } else {
        if (config.key === sttModel && config.modelType === 'stt') {
          return {
            baseUrl: config.baseURL || '',
            apiKey: config.apiKey || '',
            model: config.model || '',
            customHeaders: config.customHeaders,
          }
        }
      }
    }
  }

  // 2. Fallback：找任何含有 stt 类型模型的 provider
  for (const config of aiModelList) {
    if (!config.baseURL || !config.apiKey) continue
    if (config.models && config.models.length > 0) {
      const sttModelEntry = config.models.find((m) => m.modelType === 'stt')
      if (sttModelEntry) {
        return {
          baseUrl: config.baseURL,
          apiKey: config.apiKey,
          model: sttModelEntry.model,
          customHeaders: config.customHeaders,
        }
      }
    }
  }

  // 3. 最终 fallback：找到任何可用的硅基流动 provider（siliconflow），用默认 SenseVoice
  for (const config of aiModelList) {
    if (!config.baseURL || !config.apiKey) continue
    if (config.baseURL.includes('siliconflow')) {
      return {
        baseUrl: config.baseURL,
        apiKey: config.apiKey,
        model: 'FunAudioLLM/SenseVoiceSmall',
        customHeaders: config.customHeaders,
      }
    }
  }

  return null
}

interface STTConfig {
  baseUrl: string
  apiKey: string
  model: string
  customHeaders?: Record<string, string>
}

/**
 * 判断错误是否可重试：429、5xx 或网络错误可重试，其它 4xx 及超时/中止不重试
 */
export function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') return false
  if (message.includes('转写超时')) return false
  // Rust 端错误格式：Request failed: {status} {body}；无状态码的为网络错误
  const statusMatch = message.match(/Request failed: (\d{3})\b/)
  if (statusMatch) {
    const status = Number(statusMatch[1])
    return status === 429 || status >= 500
  }
  return true
}

/**
 * 带重试的分段转写：对可重试错误做指数退避，最多 3 次
 */
async function transcribeChunkWithRetry(
  audioBlob: Blob,
  language: string,
  config: STTConfig,
  segmentIndex: number
): Promise<TranscribeResult> {
  const maxAttempts = 3
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transcribeChunk(audioBlob, language, config)
    } catch (err) {
      lastError = err
      if (!isRetryableError(err) || attempt === maxAttempts) break
      const delayMs = 1000 * 2 ** (attempt - 1)
      console.warn(
        `[Meeting] 第 ${segmentIndex + 1} 段转写失败，${delayMs / 1000}s 后重试 (${attempt}/${maxAttempts}):`,
        err
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

/**
 * 转写单个音频片段
 */
async function transcribeChunk(
  audioBlob: Blob,
  language: string,
  config: STTConfig
): Promise<TranscribeResult> {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('语音识别模型配置不完整，请检查 Base URL 和 API Key')
  }

  console.log(`[Meeting] 转写片段: ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`)

  // 超时保护：单段最多等 5 分钟
  const timeoutMs = 5 * 60 * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await invokeAiMultipart<TranscriptionResponse>({
      config: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        customHeaders: config.customHeaders,
      },
      path: '/audio/transcriptions',
      fileFieldName: 'file',
      fields: {
        model: config.model,
        language,
      },
      file: {
        bytes: await blobToBytes(audioBlob),
        fileName: 'audio.wav',
        contentType: 'audio/wav',
      },
    }, controller.signal)

    return {
      text: result.text,
      duration: result.duration,
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`转写超时（超过 ${timeoutMs / 1000} 秒），音频片段可能过大`)
    }
    console.error('[Meeting] 转写片段失败:', err.message || err)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 将 PCM 数据编码为 WAV 文件格式
 */
export function encodeWav(
  samples: Int16Array,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const bytesPerSample = 2
  const dataLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // PCM samples
  const offset = 44
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset + i * 2, samples[i], true)
  }

  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
