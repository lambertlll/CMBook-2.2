/**
 * 会议录音实时转写预览（模块级单例，与录音器同生命周期）。
 * 从录音管理器的 MediaStream 旁路采集 PCM（不接 destination，不影响录音）。
 * 两种模型通道：
 * - qwen3-asr-flash：每 30 秒切一块送同步接口转写，串行处理（一块完再送下一块）
 * - qwen3-asr-flash-realtime：Rust 侧 WebSocket 真流式（asr_dashscope_realtime.rs），
 *   PCM 重采样后直接按 ~100ms 帧持续发送（采集本身即实时速率），
 *   interim 更新"当前句"pending 片段，final 落为固定片段
 * 组件卸载不销毁；录音结束/新会议开始时由本模块自行清理 AudioContext 与 ASR 会话。
 * 仅在 STT 引擎为阿里云且模型支持、且设置开启时采集。
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import useSettingStore from '@/stores/setting'
import { getRecorder } from './meeting-recorder-manager'
import { encodeWav, parseHotwords } from './meeting-transcribe'
import { transcribeQwen3Segment, type Qwen3ASRConfig } from './meeting-transcribe-qwen3'

export interface LiveTranscriptSegment {
  id: number
  text: string
  startSec: number // 该块在录音中的起始秒数（不含暂停时间）
  status: 'pending' | 'ok' | 'failed'
}

interface LiveTranscriptState {
  meetingId: string | null // 当前采集归属的会议
  active: boolean // 是否正在采集（录音中）
  segments: LiveTranscriptSegment[]
  error: string | null // 实时通道错误信息（连接/发送/服务端错误），用于面板展示
}

export const useLiveTranscriptStore = create<LiveTranscriptState>(() => ({
  meetingId: null,
  active: false,
  segments: [],
  error: null,
}))

// 切块时长（秒）
const CHUNK_SECONDS = 30
// 目标采样率（qwen3-asr-flash / realtime 均使用 16kHz 单声道）
const TARGET_SAMPLE_RATE = 16000
// 尾块不足该时长（秒）直接丢弃，避免极短静音块浪费请求
const MIN_TAIL_SECONDS = 0.5
// realtime 发送帧：100ms（16kHz 16bit 单声道 = 3200 字节）
const DS_FRAME_BYTES = (TARGET_SAMPLE_RATE * 100 * 2) / 1000

// DashScope realtime 结果事件（Rust asr_dashscope_realtime.rs 推送）
interface DashscopeAsrResultEvent {
  sessionId: string
  type: 'interim' | 'final'
  itemId: string
  text: string
  emotion: string
  language: string
}

interface DashscopeAsrErrorEvent {
  sessionId: string
  itemId: string
  code: string
  message: string
}

// ---- 模块级运行状态（组件卸载不清理） ----
let audioContext: AudioContext | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let captureNode: AudioWorkletNode | ScriptProcessorNode | null = null
let streamPollTimer: ReturnType<typeof setInterval> | null = null
// 会话令牌：异步初始化完成前会话已切换时丢弃结果
let sessionToken = 0
// PCM 缓冲（AudioContext 原生采样率，Float32）
let pcmBuffers: Float32Array[] = []
let bufferedSamples = 0
// 已切块的音频秒数（用于计算下一块 startSec）
let processedSeconds = 0
let capturePaused = false
let capturing = false
let segmentIdSeq = 0
// 串行转写队列：一块完再送下一块，避免并发堆积
let queue: Promise<void> = Promise.resolve()

// ---- DashScope realtime 会话状态（dsMode 时生效） ----
let dsMode = false
let dsSessionId: string | null = null
// 不足一帧的 PCM 字节尾包（连接就绪前也暂存于此）
let dsPending = new Uint8Array(0)
// 当前 interim 句对应的 pending 片段 id 与所属 item（无 interim 时为 null）
let dsInterimId: number | null = null
let dsInterimItemId: string | null = null
// 已发送的音频秒数（服务端不返回时间戳，片段 startSec 用此本地估算）
let dsAudioSeconds = 0
// 会话级失败标记：置位后 getFullTranscript 返回 null，回退整段重转
let dsFailed = false
let dsUnlisteners: UnlistenFn[] = []
// 录音中会话断线的自动重连状态（限时限量，防无限重连）
let dsReconnecting = false
let dsReconnectAttempts = 0
let dsReconnectTimer: ReturnType<typeof setTimeout> | null = null
const DS_MAX_RECONNECTS = 3
// 串行发送队列：避免 fire-and-forget invoke 积压大量 Promise（每个 Promise 持有
// Array.from(bytes) 的 number[] 闭包，29 分钟可膨胀至数百 MB 导致 WebView2 崩溃）
let dsSendQueue: Promise<void> = Promise.resolve()

// AudioWorklet 内联代码：把输入 PCM 帧转发到主线程（Blob URL 加载，避免新增构建配置）
const WORKLET_CODE = `
class MeetingLivePcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0].slice(0))
    }
    return true
  }
}
registerProcessor('meeting-live-pcm', MeetingLivePcmProcessor)
`

/** 当前设置是否满足实时转写条件（仅阿里云 qwen3-asr-flash 系列支持） */
export function isLiveTranscriptEnabled(): boolean {
  const {
    meetingLiveTranscript,
    sttEngine,
    aliyunAsrModel,
    aliyunAsrApiKey,
    aliyunAsrWorkspaceId,
  } = useSettingStore.getState()
  return (
    meetingLiveTranscript &&
    sttEngine === 'aliyun' &&
    (aliyunAsrModel === 'qwen3-asr-flash' ||
      aliyunAsrModel === 'qwen3-asr-flash-realtime') &&
    !!aliyunAsrApiKey &&
    !!aliyunAsrWorkspaceId
  )
}

/**
 * 录音开始后调用：旁路采集 PCM 并开始切块转写。
 * 不满足条件或同会议已在采集时直接忽略。
 */
export function startLiveTranscript(meetingId: string): void {
  const state = useLiveTranscriptStore.getState()
  if (state.meetingId === meetingId && (state.active || capturing)) return
  if (!isLiveTranscriptEnabled()) return

  // 新录音会话：清理上一场残留并重置片段列表
  teardownCapture()
  teardownDs()
  sessionToken++
  pcmBuffers = []
  bufferedSamples = 0
  processedSeconds = 0
  capturePaused = false
  capturing = false
  segmentIdSeq = 0
  queue = Promise.resolve()
  dsMode =
    useSettingStore.getState().aliyunAsrModel === 'qwen3-asr-flash-realtime'
  dsPending = new Uint8Array(0)
  dsInterimId = null
  dsInterimItemId = null
  dsAudioSeconds = 0
  dsFailed = false
  dsSendQueue = Promise.resolve()
  // 新录音会话：重置断线重连状态
  dsReconnecting = false
  dsReconnectAttempts = 0
  if (dsReconnectTimer) {
    clearTimeout(dsReconnectTimer)
    dsReconnectTimer = null
  }
  useLiveTranscriptStore.setState({ meetingId, active: false, segments: [], error: null })

  // 录音器 start 是异步的，stream 可能尚未就绪，轮询等待（最多约 10 秒）
  const token = sessionToken
  let attempts = 0
  let setupStarted = false
  const stopPoll = () => {
    if (streamPollTimer) {
      clearInterval(streamPollTimer)
      streamPollTimer = null
    }
  }
  const trySetup = () => {
    if (token !== sessionToken || setupStarted) {
      stopPoll()
      return
    }
    const stream = getRecorder()?.getStream()
    if (stream && stream.active) {
      setupStarted = true
      stopPoll()
      void setupCapture(stream, token)
      return
    }
    if (++attempts >= 20) {
      console.warn('[LiveTranscript] 等待录音流超时，本次不采集')
      stopPoll()
    }
  }
  trySetup()
  if (!setupStarted) {
    streamPollTimer = setInterval(trySetup, 500)
  }
}

/** 暂停录音：停止切块累积（暂停期间流入的 PCM 直接丢弃） */
export function pauseLiveTranscript(): void {
  capturePaused = true
}

/** 继续录音：恢复切块累积 */
export function resumeLiveTranscript(): void {
  capturePaused = false
}

/**
 * 录音结束后调用：送出不足 30 秒的尾块，等待转写队列清空，释放采集资源。
 * 之后可用 getFullTranscript() 取结果。
 * 仅当当前采集归属该会议时生效，避免串用其他会议的残留会话。
 */
export async function finalizeLiveTranscript(meetingId: string): Promise<void> {
  if (useLiveTranscriptStore.getState().meetingId !== meetingId) return
  capturing = false
  if (dsMode) {
    // realtime：送出尾帧后发 session.finish 等 session.finished，事件监听保持到 finish 返回
    teardownCapture()
    const sessionId = dsSessionId
    if (dsFailed) {
      // 会话已失败（连接已断）：直接安静断开，不再尝试发送 finish（会产生噪音报错）
      if (sessionId) {
        invoke('dashscope_asr_disconnect', { sessionId }).catch(() => {})
      }
    } else if (sessionId) {
      try {
        if (dsPending.length > 0) {
          await invoke('dashscope_asr_send_pcm', {
            sessionId,
            bytes: Array.from(dsPending),
          })
          dsPending = new Uint8Array(0)
        }
        await invoke('dashscope_asr_finish', { sessionId })
      } catch (err) {
        console.warn('[LiveTranscript] DashScope realtime 结束会话异常:', err)
        dsFailed = true
        invoke('dashscope_asr_disconnect', { sessionId }).catch(() => {})
      }
    }
    // 未转为 final 的 interim 片段是未确认文本，不落入全文
    if (dsInterimId !== null) {
      removeSegment(dsInterimId)
      dsInterimId = null
      dsInterimItemId = null
    }
    teardownDs()
    useLiveTranscriptStore.setState({ active: false })
    return
  }
  cutChunk(true)
  teardownCapture()
  await queue
  useLiveTranscriptStore.setState({ active: false })
}

/** 清空片段并释放采集资源（会议切换/删除时调用） */
export function clearLiveTranscript(): void {
  sessionToken++
  capturing = false
  teardownCapture()
  teardownDs()
  pcmBuffers = []
  bufferedSamples = 0
  queue = Promise.resolve()
  useLiveTranscriptStore.setState({ meetingId: null, active: false, segments: [] })
}

/**
 * 指定会议的实时转写全部块成功时返回拼接文本；
 * 未采集/归属其他会议/有失败块/有块未完成/全文为空时返回 null。
 */
export function getFullTranscript(meetingId: string): string | null {
  const state = useLiveTranscriptStore.getState()
  if (state.meetingId !== meetingId || state.segments.length === 0) return null
  // realtime 会话失败（断连/服务端错误）时回退整段重转
  if (dsFailed) return null
  if (state.segments.some((s) => s.status !== 'ok')) return null
  const text = state.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n')
  return text || null
}

// ---- 内部实现 ----

async function setupCapture(stream: MediaStream, token: number): Promise<void> {
  try {
    const ctx = new AudioContext()
    if (token !== sessionToken) {
      await ctx.close().catch(() => {})
      return
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    audioContext = ctx
    sourceNode = ctx.createMediaStreamSource(stream)

    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: 'application/javascript' })
      )
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      if (token !== sessionToken || audioContext !== ctx) return
      const node = new AudioWorkletNode(ctx, 'meeting-live-pcm')
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onPcm(e.data)
      captureNode = node
      // 只采集分析，不接 destination，避免回放与干扰录音
      sourceNode.connect(node)
    } else {
      // ScriptProcessor 兜底：需接 destination 才触发回调，但不写输出缓冲（输出静音）
      const node = ctx.createScriptProcessor(4096, 1, 1)
      node.onaudioprocess = (e) => {
        onPcm(e.inputBuffer.getChannelData(0))
      }
      captureNode = node
      sourceNode.connect(node)
      node.connect(ctx.destination)
    }

    capturing = true
    useLiveTranscriptStore.setState({ active: true })
    console.log('[LiveTranscript] 开始采集, 采样率:', ctx.sampleRate)
    // realtime：采集就绪后建立 WebSocket 会话（异步，连接完成前的 PCM 先攒在尾包缓冲里）
    if (dsMode) {
      void connectDsSession(token)
    }
  } catch (err) {
    console.error('[LiveTranscript] 采集初始化失败:', err)
    teardownCapture()
  }
}

function onPcm(data: Float32Array): void {
  if (!capturing || capturePaused || !audioContext) return
  if (dsMode) {
    // realtime：重采样到 16kHz 后直接按 100ms 帧实时发送，不再切块
    appendDsPcm(data, audioContext.sampleRate)
    return
  }
  // 拷贝一份（ScriptProcessor 的缓冲会被复用）
  pcmBuffers.push(data.slice(0))
  bufferedSamples += data.length
  if (bufferedSamples >= CHUNK_SECONDS * audioContext.sampleRate) {
    cutChunk(false)
  }
}

/**
 * 把当前缓冲切出一块并送入串行转写队列。
 * @param isTail 是否为结束录音时的尾块（不足 30 秒；过短则丢弃）
 */
function cutChunk(isTail: boolean): void {
  if (bufferedSamples === 0 || !audioContext) return
  const sampleRate = audioContext.sampleRate

  // 拼接缓冲
  const merged = new Float32Array(bufferedSamples)
  let offset = 0
  for (const buf of pcmBuffers) {
    merged.set(buf, offset)
    offset += buf.length
  }
  pcmBuffers = []
  bufferedSamples = 0

  const durationSec = merged.length / sampleRate
  const startSec = processedSeconds
  processedSeconds += durationSec
  if (isTail && durationSec < MIN_TAIL_SECONDS) return

  // 线性重采样到 16kHz 单声道
  const samples16k = resampleLinear(merged, sampleRate, TARGET_SAMPLE_RATE)
  enqueueChunk(samples16k, Math.round(startSec))
}

/** 串行队列：追加一个待转写块，单块失败不阻断后续块 */
function enqueueChunk(samples: Float32Array, startSec: number): void {
  const id = ++segmentIdSeq
  useLiveTranscriptStore.setState((s) => ({
    segments: [...s.segments, { id, text: '', startSec, status: 'pending' }],
  }))

  const { aliyunAsrApiKey, aliyunAsrWorkspaceId, aliyunAsrHotwords } =
    useSettingStore.getState()
  const config: Qwen3ASRConfig = {
    apiKey: aliyunAsrApiKey,
    workspaceId: aliyunAsrWorkspaceId,
    language: 'zh',
    hotwords: parseHotwords(aliyunAsrHotwords),
  }

  queue = queue.then(async () => {
    try {
      const wavBlob = encodeFloat32ToWavBlob(samples)
      const text = await transcribeQwen3Segment(wavBlob, config, 'zh')
      updateSegment(id, { text, status: 'ok' })
    } catch (err) {
      console.error(`[LiveTranscript] 第 ${id} 块转写失败:`, err)
      updateSegment(id, { status: 'failed' })
    }
  })
}

function updateSegment(
  id: number,
  patch: Partial<LiveTranscriptSegment>
): void {
  useLiveTranscriptStore.setState((s) => ({
    segments: s.segments.map((seg) =>
      seg.id === id ? { ...seg, ...patch } : seg
    ),
  }))
}

/** 记录实时通道错误（面板可见），同时输出到控制台。
 *  去抖：相同错误 500ms 内只 setState 一次，避免断连后大量 invoke 快速
 *  失败导致高频 setState → React 重渲染 → 主线程阻塞 */
let lastLiveError = ''
let liveErrorTimer: ReturnType<typeof setTimeout> | null = null
function setLiveError(message: string): void {
  if (message === lastLiveError) return
  lastLiveError = message
  useLiveTranscriptStore.setState({ error: message })
  if (liveErrorTimer) clearTimeout(liveErrorTimer)
  liveErrorTimer = setTimeout(() => {
    liveErrorTimer = null
    // 允许后续相同错误再次触发（重连后可能再次遇到同一错误）
    lastLiveError = ''
  }, 500)
}

// ---- DashScope realtime（qwen3-asr-flash-realtime）流式通道 ----

/** 累积 PCM 字节，攒满一帧（100ms）且会话就绪后发送 */
function appendDsPcm(data: Float32Array, fromRate: number): void {
  if (dsFailed) return
  const samples16k = resampleLinear(data, fromRate, TARGET_SAMPLE_RATE)
  dsAudioSeconds += samples16k.length / TARGET_SAMPLE_RATE
  const frame = float32ToPcm16Bytes(samples16k)
  const merged = new Uint8Array(dsPending.length + frame.length)
  merged.set(dsPending, 0)
  merged.set(frame, dsPending.length)

  let offset = 0
  const sessionId = dsSessionId
  if (sessionId) {
    while (merged.length - offset >= DS_FRAME_BYTES) {
      const bytes = merged.slice(offset, offset + DS_FRAME_BYTES)
      const sid = sessionId
      // 串行化发送：前一个 invoke resolve/reject 后才发下一个，
      // 避免 Promise 积压与 Array.from(bytes) 的 number[] 闭包内存膨胀
      dsSendQueue = dsSendQueue.then(async () => {
        if (dsFailed) return
        try {
          await invoke('dashscope_asr_send_pcm', {
            sessionId: sid,
            bytes: Array.from(bytes),
          })
        } catch (err) {
          console.error('[LiveTranscript] DashScope realtime 发送失败:', err)
          dsFailed = true
          setLiveError(`音频发送失败: ${err}`)
          if (capturing) scheduleDsReconnect()
        }
      })
      offset += DS_FRAME_BYTES
    }
  }
  dsPending = merged.slice(offset)
}

/** 判断是否为网关参数类拒绝（热词 corpus 不兼容的典型报错） */
function isInvalidParameterError(err: unknown): boolean {
  const msg = String(err)
  return (
    msg.includes('InvalidParameter') ||
    msg.includes('messages') ||
    msg.includes('<400>')
  )
}

/** 建立 WebSocket 会话并订阅结果/错误事件；热词被网关拒绝时自动降级为无热词重连 */
async function connectDsSession(token: number): Promise<void> {
  const { aliyunAsrApiKey, aliyunAsrWorkspaceId, aliyunAsrHotwords } =
    useSettingStore.getState()
  // 热词/上下文偏置：session.update 的 input_audio_transcription.corpus.text（参考文本）
  const hotwords = parseHotwords(aliyunAsrHotwords)
  const buildConfig = (withCorpus: boolean) => ({
    apiKey: aliyunAsrApiKey,
    workspaceId: aliyunAsrWorkspaceId,
    language: 'zh',
    corpusText:
      withCorpus && hotwords.length > 0
        ? `银行金融领域会议录音，参考术语：${hotwords.join('、')}`
        : undefined,
  })
  // corpus（热词上下文）在 realtime 模式下默认不发送：
  // 百炼/金融云网关对 input_audio_transcription.corpus.text 支持不完整，
  // 长会话中会触发 InternalError.Algo.InvalidParameter: messages 缺 user 错误，
  // 导致实时转写中断。热词功能在非 realtime 模式（qwen3-asr-flash 同步切块）
  // 中通过 vocabulary_id 正常工作，不受影响。
  const wantCorpus = false

  // 会话建立成功的统一处理：注册会话与事件监听
  const onConnected = async (sessionId: string): Promise<boolean> => {
    // 等待连接期间会话已切换/清理：立即断开，避免泄漏
    if (token !== sessionToken || !dsMode) {
      invoke('dashscope_asr_disconnect', { sessionId }).catch(() => {})
      return false
    }
    dsSessionId = sessionId
    dsFailed = false
    useLiveTranscriptStore.setState({ error: null })
    dsUnlisteners = [
      await listen<DashscopeAsrResultEvent>('dashscope-asr-result', (event) => {
        if (event.payload.sessionId === sessionId) onDsResult(event.payload)
      }),
      await listen<DashscopeAsrErrorEvent>('dashscope-asr-error', (event) => {
        if (event.payload.sessionId === sessionId) onDsError(event.payload)
      }),
    ]
    console.log('[LiveTranscript] DashScope realtime 会话已建立:', sessionId)
    return true
  }

  try {
    const sessionId = await invoke<string>('dashscope_asr_connect', {
      config: buildConfig(wantCorpus),
    })
    await onConnected(sessionId)
  } catch (err) {
    // 专有云/金融云网关对 corpus.text 兼容性差：带热词连接被参数类错误拒绝时，降级为无热词重连一次
    if (wantCorpus && isInvalidParameterError(err)) {
      console.warn(
        '[LiveTranscript] 热词上下文被网关拒绝，降级为无热词重连:',
        err
      )
      setLiveError('热词上下文不被当前网关支持，已自动降级为无热词转写')
      try {
        const sessionId = await invoke<string>('dashscope_asr_connect', {
          config: buildConfig(false),
        })
        const ok = await onConnected(sessionId)
        if (ok) return
      } catch (retryErr) {
        console.error('[LiveTranscript] 无热词重连仍失败:', retryErr)
      }
    } else {
      console.error('[LiveTranscript] DashScope realtime 连接失败:', err)
    }
    dsFailed = true
    setLiveError(`实时转写连接失败: ${err}`)
    // 录音仍在进行：尝试自动重连（connectDsSession 被 scheduleDsReconnect 调用时，
    // dsReconnectAttempts 已递增，此处再调 scheduleDsReconnect 会继续下一次重连尝试）
    if (capturing) {
      scheduleDsReconnect()
    }
  }
}

/** realtime 结果事件：interim 更新"当前句"pending 片段，final 落为固定片段 */
function onDsResult(payload: DashscopeAsrResultEvent): void {
  const text = payload.text || ''
  // 服务端不返回时间戳：startSec 用本地已发送音频秒数估算
  const startSec = Math.floor(dsAudioSeconds)
  if (payload.type === 'interim') {
    if (dsInterimId === null || dsInterimItemId !== payload.itemId) {
      // 上一句的 pending interim 未收到 final 就切换了 item：属于未确认文本，直接移除
      if (dsInterimId !== null) removeSegment(dsInterimId)
      dsInterimId = ++segmentIdSeq
      dsInterimItemId = payload.itemId
      useLiveTranscriptStore.setState((s) => ({
        segments: [
          ...s.segments,
          { id: dsInterimId as number, text, startSec, status: 'pending' },
        ],
      }))
    } else {
      // 同一 item 的 interim 反复覆盖同一片段
      updateSegment(dsInterimId, { text })
    }
    return
  }
  // final：当前句定稿
  if (dsInterimId !== null && dsInterimItemId === payload.itemId) {
    updateSegment(dsInterimId, { text, status: 'ok' })
    dsInterimId = null
    dsInterimItemId = null
  } else {
    const id = ++segmentIdSeq
    useLiveTranscriptStore.setState((s) => ({
      segments: [...s.segments, { id, text, startSec, status: 'ok' }],
    }))
  }
}

/** realtime 错误事件：标记会话失败（结束后回退整段重转），当前 pending 句标记失败 */
function onDsError(payload: DashscopeAsrErrorEvent): void {
  console.error(
    `[LiveTranscript] DashScope realtime 错误 ${payload.code}: ${payload.message}（已发送音频 ${Math.floor(dsAudioSeconds)}s）`
  )
  dsFailed = true
  setLiveError(`服务端错误 ${payload.code}: ${payload.message}`)
  if (dsInterimId !== null) {
    updateSegment(dsInterimId, { status: 'failed' })
    dsInterimId = null
    dsInterimItemId = null
  }
  // 录音仍在进行： teardown 死会话并尝试自动重连（断点音频已在 dsPending 缓冲）
  if (capturing) {
    scheduleDsReconnect()
  }
}

/**
 * 录音中会话断线的自动重连：teardown 旧会话后延迟 1s 重建（同 token），
 * 最多 DS_MAX_RECONNECTS 次；重连成功后 dsFailed 复位、继续累积转写片段。
 */
function scheduleDsReconnect(): void {
  if (dsReconnecting || dsReconnectAttempts >= DS_MAX_RECONNECTS) return
  if (!dsMode || !capturing) return
  dsReconnecting = true
  dsReconnectAttempts++
  const token = sessionToken
  console.warn(
    `[LiveTranscript] ${DS_MAX_RECONNECTS - dsReconnectAttempts + 1} 次重连机会，1s 后尝试重建会话（第 ${dsReconnectAttempts} 次）`
  )
  setLiveError('实时转写连接中断，正在自动重连...')
  teardownDs()
  dsReconnectTimer = setTimeout(() => {
    dsReconnectTimer = null
    dsReconnecting = false
    if (token !== sessionToken || !dsMode || !capturing) return
    void connectDsSession(token)
  }, 1000)
}

/** 清理 realtime 会话与事件监听（不触碰采集管线） */
function teardownDs(): void {
  const sessionId = dsSessionId
  dsSessionId = null
  dsPending = new Uint8Array(0)
  if (sessionId) {
    invoke('dashscope_asr_disconnect', { sessionId }).catch(() => {})
  }
  for (const unlisten of dsUnlisteners) {
    unlisten()
  }
  dsUnlisteners = []
  // 清理待执行的重连定时器（会话生命周期结束时一并取消）
  if (dsReconnectTimer) {
    clearTimeout(dsReconnectTimer)
    dsReconnectTimer = null
  }
}

function removeSegment(id: number): void {
  useLiveTranscriptStore.setState((s) => ({
    segments: s.segments.filter((seg) => seg.id !== id),
  }))
}

/** Float32 采样转 16-bit PCM 小端字节 */
function float32ToPcm16Bytes(samples: Float32Array): Uint8Array {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return new Uint8Array(pcm.buffer)
}

/** 释放采集管线和轮询计时器（不触碰录音管理器与 MediaStream） */
function teardownCapture(): void {
  if (streamPollTimer) {
    clearInterval(streamPollTimer)
    streamPollTimer = null
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect()
    } catch {
      // ignore
    }
    sourceNode = null
  }
  if (captureNode) {
    try {
      captureNode.disconnect()
    } catch {
      // ignore
    }
    if (captureNode instanceof AudioWorkletNode) {
      captureNode.port.onmessage = null
    } else {
      captureNode.onaudioprocess = null
    }
    captureNode = null
  }
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }
}

/** 线性重采样 */
function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.round(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx]
    const b = input[Math.min(idx + 1, input.length - 1)]
    out[i] = a + (b - a) * frac
  }
  return out
}

/** 16kHz Float32 单声道 → 16-bit PCM WAV Blob */
function encodeFloat32ToWavBlob(samples: Float32Array): Blob {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return new Blob([encodeWav(pcm, TARGET_SAMPLE_RATE, 1)], {
    type: 'audio/wav',
  })
}
