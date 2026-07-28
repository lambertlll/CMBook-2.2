/**
 * 阿里云百炼 Fun-ASR 录音文件识别
 * 异步模式：提交任务 → 轮询结果
 * 支持 12 小时 / 2GB 音频，无需分段
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export interface AliyunASRConfig {
  apiKey: string
  workspaceId: string // 百炼业务空间 ID
  model?: string // 默认 fun-asr
  enableDiarization?: boolean // 说话人分离
  languageHints?: string[] // 语言提示，如 ['zh', 'en']
  hotwords?: string[] // 自定义热词（提交任务前同步为 vocabulary_id）
}

export interface AliyunTranscribeResult {
  text: string
  duration?: number
}

interface TaskSubmitResponse {
  output: {
    task_id: string
    task_status: string
  }
  request_id: string
}

interface TaskQueryResponse {
  output: {
    task_id: string
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    results?: Array<{
      transcription_url: string
      subtask_status: string
    }>
    message?: string
  }
  request_id: string
}

interface TranscriptionJSON {
  transcripts: Array<{
    text: string
    sentences?: Array<{
      text: string
      begin_time: number
      end_time: number
      speaker_id?: number // 开启说话人分离时返回，从 0 开始
    }>
  }>
}

// 词表缓存：同一份热词内容复用 vocabulary_id，避免每次转写都重建词表
let cachedVocabularyId: string | null = null
let cachedVocabularyKey: string | null = null

interface CustomizationResponse {
  output?: {
    vocabulary_id?: string
    vocabulary_list?: Array<{ vocabulary_id: string; status?: string }>
  }
  request_id?: string
}

/**
 * 确保热词词表在服务端存在且内容最新，返回 vocabulary_id
 * 依据文档：
 * - 词表管理 HTTP API：https://help.aliyun.com/zh/model-studio/vocabulary-http-api
 *   POST {baseUrl}/services/audio/asr/customization，model 固定为 speech-biasing，
 *   action 取 create_vocabulary / list_vocabulary / update_vocabulary
 * - 转写时通过 parameters.vocabulary_id 引用词表：
 *   https://help.aliyun.com/zh/model-studio/funauidio-asr-recorded-speech-recognition-restful-api
 * 任何一步失败都返回 null（降级为不带热词转写），不阻断转写主流程
 */
async function ensureVocabularyId(
  baseUrl: string,
  apiKey: string,
  model: string,
  hotwords: string[]
): Promise<string | null> {
  try {
    // 去重去空；文档限制含非 ASCII 字符的热词不超过 15 个字符，超限丢弃
    const words = [...new Set(hotwords.map((w) => w.trim()))].filter((w) => {
      if (!w) return false
      if (w.length > 15) {
        console.warn('[Aliyun ASR] 热词超长被忽略:', w)
        return false
      }
      return true
    })
    if (words.length === 0) return null

    const key = `${apiKey.slice(-8)}|${model}|${words.join(',')}`
    if (cachedVocabularyId && cachedVocabularyKey === key) return cachedVocabularyId
    // API Key 变更后旧缓存的词表 ID 属于别的账号，必须丢弃
    if (cachedVocabularyKey && cachedVocabularyKey.split('|')[0] !== key.split('|')[0]) {
      cachedVocabularyId = null
    }

    const callCustomization = async (
      input: Record<string, unknown>
    ): Promise<CustomizationResponse> => {
      const res = await tauriFetch(`${baseUrl}/services/audio/asr/customization`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'speech-biasing', input }),
      })
      if (!res.ok) {
        throw new Error(`热词词表接口调用失败 (${res.status}): ${await res.text()}`)
      }
      return (await res.json()) as CustomizationResponse
    }

    // 权重常用值 4（文档推荐）；不指定 lang，由模型自动识别语种
    const vocabulary = words.map((text) => ({ text, weight: 4 }))

    let vocabularyId = cachedVocabularyId
    if (!vocabularyId) {
      // 按固定前缀查找本应用已创建的词表，避免重复创建
      const list = await callCustomization({
        action: 'list_vocabulary',
        prefix: 'notegen',
        page_index: 0,
        page_size: 10,
      })
      vocabularyId =
        list.output?.vocabulary_list?.find((v) => v.status === 'OK')?.vocabulary_id ||
        list.output?.vocabulary_list?.[0]?.vocabulary_id ||
        null
    }

    if (vocabularyId) {
      // 全量替换词表内容，保持与用户配置一致
      await callCustomization({
        action: 'update_vocabulary',
        vocabulary_id: vocabularyId,
        vocabulary,
      })
    } else {
      const created = await callCustomization({
        action: 'create_vocabulary',
        target_model: model,
        prefix: 'notegen',
        vocabulary,
      })
      vocabularyId = created.output?.vocabulary_id || null
    }

    cachedVocabularyId = vocabularyId
    cachedVocabularyKey = key
    return vocabularyId
  } catch (err) {
    console.warn('[Aliyun ASR] 热词词表准备失败，降级为不带热词转写:', err)
    return null
  }
}

/**
 * 使用阿里云百炼 ASR 转写音频
 * @param audioBase64 音频的 base64 编码（不含 data: 前缀）
 * @param mimeType 音频 MIME 类型
 * @param config 阿里云配置
 * @param onProgress 进度回调 (0-100)
 */
export async function transcribeWithAliyun(
  audioBase64: string,
  mimeType: string,
  config: AliyunASRConfig,
  onProgress?: (progress: number) => void
): Promise<AliyunTranscribeResult> {
  const baseUrl = `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`
  const model = config.model || 'fun-asr'

  onProgress?.(5)
  console.log('[Aliyun ASR] 提交转写任务, 模型:', model)

  // 1. 提交任务（使用 file_urls 传入 Data URI）
  const dataUri = `data:${mimeType};base64,${audioBase64}`

  const submitBody: Record<string, unknown> = {
    model,
    input: {
      file_urls: [dataUri],
    },
    parameters: {
      channel_id: [0],
    },
  }

  if (config.languageHints && config.languageHints.length > 0) {
    ;(submitBody.parameters as Record<string, unknown>).language_hints =
      config.languageHints
  }

  if (config.enableDiarization) {
    ;(submitBody.parameters as Record<string, unknown>).diarization_enabled = true
  }

  // 热词：先确保服务端词表存在且最新，再以 vocabulary_id 引用；
  // 词表准备失败时 ensureVocabularyId 返回 null，降级为不带热词正常转写
  if (config.hotwords && config.hotwords.length > 0) {
    const vocabularyId = await ensureVocabularyId(
      baseUrl,
      config.apiKey,
      model,
      config.hotwords
    )
    if (vocabularyId) {
      ;(submitBody.parameters as Record<string, unknown>).vocabulary_id =
        vocabularyId
    }
  }

  // 提交任务
  const submitRes = await tauriFetch(
    `${baseUrl}/services/audio/asr/transcription`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(submitBody),
    }
  )

  if (!submitRes.ok) {
    const errText = await submitRes.text()
    throw new Error(`阿里云 ASR 提交失败 (${submitRes.status}): ${errText}`)
  }

  const submitData = (await submitRes.json()) as TaskSubmitResponse
  const taskId = submitData.output?.task_id
  if (!taskId) {
    throw new Error('阿里云 ASR 提交任务失败：未返回 task_id')
  }

  console.log('[Aliyun ASR] 任务已提交, task_id:', taskId)
  onProgress?.(15)

  // 2. 轮询任务状态（指数退避：3s 起，封顶 10s）
  const maxWaitMs = 10 * 60 * 1000
  let pollIntervalMs = 3000
  const maxPollIntervalMs = 10000
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollIntervalMs)
    pollIntervalMs = Math.min(pollIntervalMs * 2, maxPollIntervalMs)

    const statusRes = await tauriFetch(`${baseUrl}/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    })

    if (!statusRes.ok) {
      // 4xx 属于配置/权限问题，继续轮询只会空转，立即抛出
      if (statusRes.status >= 400 && statusRes.status < 500) {
        const errText = await statusRes.text()
        throw new Error(
          `阿里云 ASR 查询任务失败 (${statusRes.status}): ${errText || '请检查 API Key 和业务空间 ID 配置'}`
        )
      }
      console.warn('[Aliyun ASR] 查询失败:', statusRes.status)
      continue
    }

    const statusData = (await statusRes.json()) as TaskQueryResponse
    const status = statusData.output?.task_status
    console.log('[Aliyun ASR] 任务状态:', status)

    if (status === 'SUCCEEDED') {
      onProgress?.(85)
      const results = statusData.output?.results
      if (!results || results.length === 0) {
        throw new Error('阿里云 ASR 任务完成但无结果')
      }

      const transcriptionUrl = results[0].transcription_url
      const text = await fetchTranscriptionText(transcriptionUrl)
      onProgress?.(100)
      return { text }
    }

    if (status === 'FAILED') {
      const msg = statusData.output?.message || '未知错误'
      throw new Error(`阿里云 ASR 转写失败: ${msg}`)
    }

    // 更新进度
    const elapsed = Date.now() - startTime
    const progress = Math.min(80, 15 + Math.round((elapsed / maxWaitMs) * 65))
    onProgress?.(progress)
  }

  throw new Error('阿里云 ASR 转写超时（超过 10 分钟），音频可能较长导致处理缓慢，请稍后重试或改用其他识别引擎')
}

/**
 * 从 transcription_url 获取转录文本
 */
async function fetchTranscriptionText(url: string): Promise<string> {
  const res = await tauriFetch(url)
  if (!res.ok) {
    throw new Error(`获取转录结果失败: ${res.status}`)
  }

  const data = (await res.json()) as TranscriptionJSON

  if (data.transcripts && data.transcripts.length > 0) {
    return data.transcripts
      .map((t) => {
        // 如果有句子级别结果，用句子拼接（更准确）
        if (t.sentences && t.sentences.length > 0) {
          // 开启说话人分离后句子带 speaker_id，按说话人标注拼接，
          // 便于纪要区分"客户说的 vs 客户经理说的"；同一说话人的连续句子合并为一行
          const hasSpeaker = t.sentences.some(
            (s) => s.speaker_id !== undefined && s.speaker_id !== null
          )
          if (hasSpeaker) {
            const lines: string[] = []
            for (const s of t.sentences) {
              const text = s.text.trim()
              if (!text) continue
              const label = `说话人${Number(s.speaker_id ?? 0) + 1}：`
              const last = lines.length - 1
              if (last >= 0 && lines[last].startsWith(label)) {
                lines[last] += text
              } else {
                lines.push(label + text)
              }
            }
            return lines.join('\n')
          }
          return t.sentences.map((s) => s.text.trim()).join('')
        }
        return t.text?.trim() || ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
