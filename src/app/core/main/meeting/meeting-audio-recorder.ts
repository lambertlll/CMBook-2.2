/**
 * 会议录音器，封装浏览器 MediaRecorder API
 */
export class MeetingAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private stream: MediaStream | null = null

  /**
   * @param onChunk 每个录音分片（约每秒一块）产出时的旁路回调，
   * 供分片落盘等崩溃恢复机制使用；回调异步执行，不阻塞录音
   */
  constructor(private onChunk?: (chunk: Blob) => void) {}

  /**
   * 请求麦克风权限并开始录音
   */
  async start(): Promise<void> {
    // 释放之前的资源
    this.destroy()
    this.audioChunks = []

    // getUserMedia 在某些 macOS WKWebView 版本可能不支持 sampleRate 约束，
    // 先尝试带约束的请求，失败则回退到基础约束
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      // 回退：去掉 sampleRate 约束，让浏览器使用默认采样率
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.getSupportedMimeType(),
      })
    } catch (err) {
      // 构造失败时释放已获取的媒体流，避免麦克风占用泄漏
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
      throw err
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data)
        // 旁路通知（分片落盘），异常不影响录音主流程
        try {
          this.onChunk?.(event.data)
        } catch {
          // ignore
        }
      }
    }

    // 每秒收集一次数据，避免长录音丢失
    this.mediaRecorder.start(1000)
  }

  /**
   * 暂停录音
   */
  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause()
    }
  }

  /**
   * 继续录音
   */
  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume()
    }
  }

  /**
   * 停止录音并返回完整音频 Blob
   */
  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('录音器未初始化'))
        return
      }

      if (this.mediaRecorder.state === 'inactive') {
        // 已停止，直接返回已有数据
        const blob = new Blob(this.audioChunks, {
          type: this.mediaRecorder.mimeType || 'audio/webm',
        })
        resolve(blob)
        return
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm'
        const blob = new Blob(this.audioChunks, { type: mimeType })
        resolve(blob)
      }

      this.mediaRecorder.onerror = (event) => {
        reject(new Error(`录音错误: ${(event as ErrorEvent).message || '未知错误'}`))
      }

      this.mediaRecorder.stop()
    })
  }

  /**
   * 只读获取当前麦克风 MediaStream（录音中可用，否则为 null）。
   * 供 UI 层接入 Web Audio AnalyserNode 做电平/波形分析，不影响录音本身。
   */
  getStream(): MediaStream | null {
    return this.stream
  }

  /**
   * 获取当前录音状态
   */
  getState(): 'inactive' | 'recording' | 'paused' {
    if (!this.mediaRecorder) return 'inactive'
    return this.mediaRecorder.state
  }

  /**
   * 释放所有资源
   */
  destroy(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    this.audioChunks = []
  }

  /**
   * 获取浏览器支持的音频 MIME 类型
   */
  private getSupportedMimeType(): string {
    // macOS Safari/WKWebView 不支持 audio/webm，优先尝试兼容格式
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',  // macOS Safari 原生支持
      'audio/aac',  // macOS Safari 备选
      'audio/ogg;codecs=opus',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    // 无匹配格式时直接抛出明确错误，而不是返回必失败的默认值
    throw new Error('当前环境不支持任何可用的音频录制格式（webm/mp4/aac/ogg）')
  }
}
