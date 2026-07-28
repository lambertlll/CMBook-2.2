'use client'

import { useEffect, useRef, useState } from 'react'
import { getRecorder } from './meeting-recorder-manager'
import { cn } from '@/lib/utils'

/** 竖条数量（类似微信语音的跳动电平条） */
const BAR_COUNT = 6

interface MeetingAudioLevelProps {
  /** 是否正在录音（暂停时动画静止并置灰） */
  active: boolean
}

/**
 * 实时音频电平动画。
 * 从录音管理器拿到 MediaStream，用 AudioContext + AnalyserNode 读取频域数据，
 * requestAnimationFrame 驱动竖条跳动；AnalyserNode 只做分析，不影响录音。
 */
export function MeetingAudioLevel({ active }: MeetingAudioLevelProps) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([])
  // 保存平滑后的电平值，暂停时保持最后状态不跳动
  const levelsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0))
  // 用 ref 同步录音状态，避免暂停/继续时重建 AudioContext
  const activeRef = useRef(active)
  activeRef.current = active
  const [hasStream, setHasStream] = useState(false)

  useEffect(() => {
    let audioContext: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let rafId = 0
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let disposed = false

    const setup = (stream: MediaStream) => {
      if (disposed) return
      audioContext = new AudioContext()
      // 部分浏览器策略下 AudioContext 初始为 suspended，尝试恢复
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {})
      }
      const source = audioContext.createMediaStreamSource(stream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.7
      // 只连接分析节点，不接到 destination，避免回放与干扰录音
      source.connect(analyser)
      setHasStream(true)

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const binSize = Math.max(1, Math.floor(freqData.length / BAR_COUNT))

      const render = () => {
        if (disposed || !analyser) return
        if (activeRef.current) {
          analyser.getByteFrequencyData(freqData)
          for (let i = 0; i < BAR_COUNT; i++) {
            // 每根竖条取一段频段的平均能量，归一化到 0-1
            let sum = 0
            for (let j = i * binSize; j < (i + 1) * binSize; j++) {
              sum += freqData[j]
            }
            const target = sum / binSize / 255
            // 平滑过渡，避免跳动过于生硬
            levelsRef.current[i] += (target - levelsRef.current[i]) * 0.4
          }
        }
        for (let i = 0; i < BAR_COUNT; i++) {
          const bar = barRefs.current[i]
          if (bar) {
            // 最小高度保证静止时也可见，整体 4px-16px
            const height = 4 + levelsRef.current[i] * 12
            bar.style.height = `${height.toFixed(1)}px`
          }
        }
        rafId = requestAnimationFrame(render)
      }
      rafId = requestAnimationFrame(render)
    }

    // 录音器由模块级管理器持有，组件挂载时 stream 可能尚未就绪，轮询等待
    const trySetup = () => {
      const stream = getRecorder()?.getStream()
      if (stream && stream.active) {
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        setup(stream)
      }
    }
    trySetup()
    if (!analyser) {
      pollTimer = setInterval(trySetup, 500)
    }

    return () => {
      disposed = true
      if (pollTimer) clearInterval(pollTimer)
      if (rafId) cancelAnimationFrame(rafId)
      // 只关闭自己创建的 AudioContext，不触碰录音管理器与 MediaStream
      if (audioContext) {
        audioContext.close().catch(() => {})
      }
    }
    // AudioContext 只建一次，录音状态通过 activeRef 读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={cn(
        'flex items-end gap-[3px] h-4 transition-opacity',
        (!active || !hasStream) && 'opacity-40'
      )}
      aria-hidden
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            barRefs.current[i] = el
          }}
          className={cn(
            'w-[3px] rounded-full',
            active ? 'bg-danger' : 'bg-muted-foreground'
          )}
          style={{ height: 4 }}
        />
      ))}
    </div>
  )
}
