'use client'

import { useEffect, useState, useCallback } from 'react'
import { useMeetingStore } from './meeting-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MicOff, Pause, Play, Square, Pencil, WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeetingAudioLevel } from './meeting-audio-level'
import { useNetworkStore } from '@/stores/network'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

interface MeetingControlsProps {
  meetingId: string
}

export function MeetingControls({ meetingId }: MeetingControlsProps) {
  const t = useTranslations('meeting')
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const pauseRecording = useMeetingStore((s) => s.pauseRecording)
  const resumeRecording = useMeetingStore((s) => s.resumeRecording)
  const stopRecording = useMeetingStore((s) => s.stopRecording)
  const meeting = useMeetingStore((s) =>
    s.meetings.find((m) => m.id === meetingId)
  )

  const [displayDuration, setDisplayDuration] = useState(0)
  // 标题默认纯文本展示，点击进入编辑态
  const [editingTitle, setEditingTitle] = useState(false)
  // 网络状态（离线时显示徽标）
  const networkStatus = useNetworkStore((s) => s.status)

  // 实时计算录音时长（基于时间戳，不依赖组件挂载状态）
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (meeting?.status === 'recording' && meeting.recordingStartedAt) {
      const tick = () => {
        const elapsed = Date.now() - (meeting.recordingStartedAt || 0)
        const totalMs = (meeting.pausedDuration || 0) + elapsed
        setDisplayDuration(Math.round(totalMs / 1000))
      }
      tick()
      interval = setInterval(tick, 1000)
    } else if (meeting?.status === 'paused') {
      // 暂停时显示已累计时长
      setDisplayDuration(Math.round((meeting.pausedDuration || 0) / 1000))
    } else if (meeting) {
      setDisplayDuration(meeting.duration)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [meeting?.status, meeting?.recordingStartedAt, meeting?.pausedDuration, meeting?.duration])

  const handlePauseResume = useCallback(() => {
    if (!meeting) return
    if (meeting.status === 'recording') {
      pauseRecording(meetingId)
    } else {
      resumeRecording(meetingId)
    }
  }, [meeting?.status, meetingId, pauseRecording, resumeRecording])

  const handleStop = useCallback(() => {
    stopRecording(meetingId)
  }, [meetingId, stopRecording])

  if (!meeting) return null

  const isRecording = meeting.status === 'recording'

  return (
    <div className="flex items-center gap-4 border-b p-3">
      {/* 左侧：低调的标题（纯文本展示，点击进入编辑） */}
      <div className="flex-1 min-w-0">
        {editingTitle ? (
          <Input
            autoFocus
            value={meeting.title}
            onChange={(e) => updateMeeting(meetingId, { title: e.target.value })}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                setEditingTitle(false)
              }
            }}
            placeholder={t('titlePlaceholder')}
            className="h-8"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            className="group flex max-w-full items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            title={meeting.title || t('titlePlaceholder')}
          >
            <span className="truncate">
              {meeting.title || t('titlePlaceholder')}
            </span>
            <Pencil className="w-3 h-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        )}
      </div>

      {/* 离线徽标：断网时提示实时转写/纪要等联网功能不可用，录音仍正常进行 */}
      {networkStatus === 'offline' && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          <WifiOff className="h-3 w-3" />
          离线模式（录音正常，联网后可补转写）
        </span>
      )}

      {/* 中间：录音状态 + 大号计时 + 实时电平动画（视觉中心） */}
      <div className="flex shrink-0 items-center gap-3">
        {isRecording ? (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-danger" />
          </span>
        ) : (
          <MicOff className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground">
          {isRecording ? t('recording') : t('paused')}
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums leading-none">
          {formatDuration(displayDuration)}
        </span>
        <MeetingAudioLevel active={isRecording} />
      </div>

      {/* 右侧：暂停/继续 + 结束会议 */}
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" onClick={handlePauseResume}>
          {isRecording ? (
            <>
              <Pause className="w-4 h-4 mr-1" />
              {t('pause')}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-1" />
              {t('resume')}
            </>
          )}
        </Button>
        <Button variant="destructive" onClick={handleStop}>
          <Square className="w-4 h-4 mr-1" />
          {t('endMeeting')}
        </Button>
      </div>
    </div>
  )
}
