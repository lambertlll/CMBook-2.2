'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'
import { useMeetingStore } from './meeting-store'
import { useLiveTranscriptStore } from './meeting-live-transcript'
import Chat from '../chat'

function formatStartSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 实时转写内容区：按时间顺序滚动显示片段，接近底部时自动跟随新内容。
 */
function LiveTranscriptView() {
  const t = useTranslations('meeting')
  const segments = useLiveTranscriptStore((s) => s.segments)
  const liveActive = useLiveTranscriptStore((s) => s.active)
  const liveError = useLiveTranscriptStore((s) => s.error)
  const meetingLiveTranscript = useSettingStore((s) => s.meetingLiveTranscript)
  const setMeetingLiveTranscript = useSettingStore(
    (s) => s.setMeetingLiveTranscript
  )
  const sttEngine = useSettingStore((s) => s.sttEngine)
  const aliyunAsrModel = useSettingStore((s) => s.aliyunAsrModel)
  const recordingMeeting = useMeetingStore((s) =>
    s.meetings.find((m) => m.id === s.recordingMeetingId)
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  // 用户上翻查看时不强制拉到底，只有接近底部才跟随新内容
  const nearBottomRef = useRef(true)

  const supported =
    sttEngine === 'aliyun' &&
    (aliyunAsrModel === 'qwen3-asr-flash' ||
      aliyunAsrModel === 'qwen3-asr-flash-realtime')
  const isRecording =
    recordingMeeting?.status === 'recording' ||
    recordingMeeting?.status === 'paused'

  useEffect(() => {
    const el = scrollRef.current
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [segments])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div className="flex flex-col h-full">
      {/* 实时通道错误透出：连接/发送/服务端错误直接可见，便于定位问题 */}
      {liveError && (
        <div className="flex items-start gap-1.5 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all leading-4">{liveError}</span>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {segments.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground text-center max-w-[260px]">
              {!supported
                ? t('liveHintUnsupported')
                : isRecording
                  ? liveActive
                    ? t('liveHintRecording')
                    : t('liveHintDisabled')
                  : t('liveHintIdle')}
            </p>
          </div>
        ) : (
          segments.map((seg) => (
            <div key={seg.id} className="flex gap-2 text-sm">
              <span className="shrink-0 font-mono text-xs text-muted-foreground leading-5 tabular-nums">
                {formatStartSec(seg.startSec)}
              </span>
              {seg.status === 'pending' ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground leading-5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t('livePending')}
                </span>
              ) : seg.status === 'failed' ? (
                <span className="flex items-center gap-1.5 text-xs text-destructive leading-5">
                  <AlertCircle className="w-3 h-3" />
                  {t('liveFailed')}
                </span>
              ) : (
                <span className="whitespace-pre-wrap break-words leading-5">
                  {seg.text}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* 底部：实时转写开关（同步 meetingLiveTranscript 设置） */}
      <div className="flex items-center gap-2 border-t p-3">
        <Switch
          id="meeting-live-transcript-toggle"
          checked={meetingLiveTranscript}
          onCheckedChange={(checked) => setMeetingLiveTranscript(checked)}
        />
        <label
          htmlFor="meeting-live-transcript-toggle"
          className="text-xs text-muted-foreground cursor-pointer"
        >
          {t('liveToggle')}
        </label>
      </div>
    </div>
  )
}

/**
 * 会议模式右侧面板：默认显示实时转写预览，可切换到原 AI 对话。
 */
export function MeetingLiveTranscriptPanel() {
  const t = useTranslations('meeting')
  const [tab, setTab] = useState<'transcript' | 'chat'>('transcript')

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-center border-b p-2">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'transcript' | 'chat')}
        >
          <TabsList className="h-8">
            <TabsTrigger value="transcript" className="text-xs px-3">
              {t('liveTabTranscript')}
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs px-3">
              {t('liveTabChat')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'transcript' ? <LiveTranscriptView /> : <Chat />}
      </div>
    </div>
  )
}
