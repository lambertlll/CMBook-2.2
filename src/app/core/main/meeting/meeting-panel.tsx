'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useMeetingStore, getMeetingAudioPaths } from './meeting-store'
import { MeetingControls } from './meeting-controls'
import { MeetingNotesEditor } from './meeting-notes-editor'
import { MeetingResult } from './meeting-result'
import {
  getRecorder,
  getOrCreateRecorder,
  destroyRecorder,
} from './meeting-recorder-manager'
import { transcribeAudio, transcribeWithFunAsrDiarization } from './meeting-transcribe'
import { loadMeetingAudio } from './meeting-load-audio'
import useSettingStore from '@/stores/setting'
import {
  startLiveTranscript,
  pauseLiveTranscript,
  resumeLiveTranscript,
  finalizeLiveTranscript,
  getFullTranscript,
} from './meeting-live-transcript'
import { generateMeetingTitle } from './meeting-generate-title'
import { generateMeetingSummary } from './meeting-generate-summary'
import { syncMeetingSummaryToCustomer } from './meeting-customer-export'
import { useTodoConfirmStore } from '@/stores/todo-confirm'
import { getCustomer } from '@/db/customers'
import { saveMeetingAudio } from './meeting-save-audio'
import { Button } from '@/components/ui/button'
import { Mic } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * 拜访会议转写完成后自动生成一次纪要（对齐冒烟清单 5.2 的"自动生成"）。
 * 与 MeetingResult 手动"生成纪要"同一管线（流式 + 客户占位符注入 + 导出客户知识库）；
 * 失败安静回退：不写失败占位纪要，走 setMeetingError 记录错误并保持可重试状态。
 */
async function autoGenerateVisitSummary(meetingId: string): Promise<void> {
  const { updateMeeting, setMeetingError } = useMeetingStore.getState()
  const meeting = useMeetingStore
    .getState()
    .meetings.find((m) => m.id === meetingId)
  if (!meeting || meeting.summary) return
  if (!meeting.transcript && !meeting.manualNotes) return

  updateMeeting(meetingId, { status: 'generating', error: '' })
  try {
    // 客户拜访模板 {客户名称} 占位符来源；未关联客户时为 undefined（模板侧替换为"未填写"）
    let customerName: string | undefined
    if (meeting.customerId) {
      const customer = await getCustomer(meeting.customerId).catch(() => null)
      customerName = customer?.name
    }
    const fullSummary = await generateMeetingSummary({
      transcript: meeting.transcript,
      manualNotes: meeting.manualNotes,
      templateId: meeting.selectedTemplate,
      title: meeting.title || undefined,
      duration: meeting.duration || undefined,
      customerName,
      createdAt: meeting.createdAt,
      modelId: meeting.selectedModel || undefined,
      onStream: (chunk) => {
        updateMeeting(meetingId, { summary: chunk })
      },
    })
    updateMeeting(meetingId, { summary: fullSummary, status: 'completed' })
    // 生成成功后自动导出到客户知识库并向量化（失败仅告警，不影响会议流程）
    const finished = useMeetingStore
      .getState()
      .meetings.find((m) => m.id === meetingId)
    if (finished) {
      void syncMeetingSummaryToCustomer({
        ...finished,
        summary: fullSummary,
      })
      // 待办确认弹窗
      useTodoConfirmStore.getState().showFromSummary({
        meetingId: meetingId,
        meetingTitle: finished.title,
        customerId: finished.customerId || '',
        visitId: finished.visitId || '',
        summary: fullSummary,
      })
    }
  } catch (err) {
    console.error('[Meeting] 自动生成纪要失败:', err)
    const errorMsg = err instanceof Error ? err.message : '生成纪要失败'
    setMeetingError(meetingId, errorMsg)
  }
}

function MeetingStartView() {
  const t = useTranslations('meeting')
  const createMeeting = useMeetingStore((s) => s.createMeeting)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
          <Mic className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">{t('startNew')}</h2>
        <p className="text-sm text-muted-foreground text-center max-w-[300px]">
          {t('startDescription')}
        </p>
      </div>
      <Button size="lg" onClick={() => createMeeting()}>
        <Mic className="w-4 h-4 mr-2" />
        {t('startMeeting')}
      </Button>
    </div>
  )
}

function MeetingRecordingView({ meetingId }: { meetingId: string }) {
  const meeting = useMeetingStore((s) =>
    s.meetings.find((m) => m.id === meetingId)
  )

  if (!meeting) return null

  return (
    <div className="flex flex-col h-full">
      <MeetingControls meetingId={meetingId} />
      <div className="flex-1 overflow-hidden">
        <MeetingNotesEditor
          meetingId={meetingId}
          content={meeting.manualNotes}
        />
      </div>
    </div>
  )
}

export function MeetingPanel() {
  const t = useTranslations('meeting')
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const setMeetingError = useMeetingStore((s) => s.setMeetingError)
  const loadMeetings = useMeetingStore((s) => s.loadMeetings)
  const initialized = useMeetingStore((s) => s.initialized)
  const activeMeeting = useMeetingStore((s) =>
    s.meetings.find((m) => m.id === s.activeMeetingId)
  )
  const recordingMeetingId = useMeetingStore((s) => s.recordingMeetingId)
  const recordingMeeting = useMeetingStore((s) =>
    s.meetings.find((m) => m.id === s.recordingMeetingId)
  )
  // 仅订阅处于 transcribing 状态的会议 id，避免每次 updateMeeting 都重跑转写 effect
  const transcribingIds = useMeetingStore((s) =>
    s.meetings
      .filter((m) => m.status === 'transcribing')
      .map((m) => m.id)
      .join(',')
  )

  const processingRef = useRef<Set<string>>(new Set())
  // Panel 自己发起转写（录音停止后）的会议 id 集合；
  // 外部（MeetingResult 重新转写）设置的 transcribing 状态不经 Panel effect 处理
  const handledTranscribeRef = useRef<Set<string>>(new Set())
  const prevRecordingIdRef = useRef<string | null>(null)

  // 初始化：从数据库加载历史会议
  useEffect(() => {
    if (!initialized) {
      loadMeetings()
    }
  }, [initialized, loadMeetings])

  // 录音停止（recordingMeetingId 变化）时，将原录音会议标记为由 Panel 处理转写
  useEffect(() => {
    const prevId = prevRecordingIdRef.current
    if (prevId && prevId !== recordingMeetingId) {
      handledTranscribeRef.current.add(prevId)
    }
    prevRecordingIdRef.current = recordingMeetingId
  }, [recordingMeetingId])

  // Manage audio recorder for the recording meeting
  // 录音器由模块级管理器持有，组件卸载（切换标签）时不销毁
  useEffect(() => {
    if (recordingMeeting?.status !== 'recording') return
    const recorder = getOrCreateRecorder(recordingMeeting.id)
    if (recorder.getState() !== 'inactive') return
    recorder.start().then(() => {
      // 录音流就绪后启动实时转写预览（不满足条件时内部自动忽略）
      startLiveTranscript(recordingMeeting.id)
    }).catch((err) => {
      console.error('录音启动失败:', err)
      // 启动失败后销毁并清空管理器中的实例，避免后续会议复用已销毁的录音器
      destroyRecorder()
      const errorMsg =
        err instanceof Error ? err.message : '录音启动失败，请检查麦克风权限'
      updateMeeting(recordingMeeting.id, { status: 'idle', error: errorMsg })
    })
  }, [recordingMeeting?.status, recordingMeeting?.id, updateMeeting])

  // Handle pause / resume
  useEffect(() => {
    const recorder = getRecorder()
    if (!recorder || !recordingMeeting) return

    if (
      recordingMeeting.status === 'paused' &&
      recorder.getState() === 'recording'
    ) {
      recorder.pause()
      pauseLiveTranscript()
    } else if (
      recordingMeeting.status === 'recording' &&
      recorder.getState() === 'paused'
    ) {
      recorder.resume()
      resumeLiveTranscript()
    }
  }, [recordingMeeting?.status])

  // Handle transcribing - stop recording and start background processing
  useEffect(() => {
    if (!transcribingIds) return

    transcribingIds.split(',').forEach((meetingId) => {
      // 只处理 Panel 自己发起的转写；外部发起的不在此处理
      if (!handledTranscribeRef.current.has(meetingId)) return
      if (processingRef.current.has(meetingId)) return
      handledTranscribeRef.current.delete(meetingId)
      processingRef.current.add(meetingId)
      handleTranscribeAndGenerate(meetingId)
    })
    // handleTranscribeAndGenerate 为稳定的 useCallback，不列入依赖（声明在下方）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcribingIds])

  // Handle regeneration
  // Handle generating - triggered directly from MeetingResult's handleRegenerate
  // No useEffect needed here; generation is called inline from the result view.

  const handleTranscribeAndGenerate = useCallback(
    async (meetingId: string) => {
      const meeting = useMeetingStore
        .getState()
        .meetings.find((m) => m.id === meetingId)
      if (!meeting) return

      const recorder = getRecorder()
      // 已有音频段说明是续录：新段只追加转写，不重新生成标题
      const previousSegments = getMeetingAudioPaths(meeting)
      const isContinuation = previousSegments.length > 0

      try {
        // 1. Stop recording and get audioBlob
        let audioBlob: Blob | null = null
        if (recorder) {
          // 无论 recordingMeetingId 状态，只要录音器活着就停止并获取音频
          try {
            audioBlob = await recorder.stop()
          } catch (e) {
            console.error('[Meeting] recorder.stop() failed:', e)
          }
          destroyRecorder()
        }

        // 结束录音：收尾实时转写（送出尾块并等待队列清空），供下方复用
        await finalizeLiveTranscript(meetingId)

        if (!audioBlob || audioBlob.size === 0) {
          // 如果已经有 transcript（之前转写成功过），直接跳到完成
          if (meeting.transcript) {
            console.warn('[Meeting] No audio blob but transcript exists, skipping transcribe')
            updateMeeting(meetingId, { status: 'completed' })
            processingRef.current.delete(meetingId)
            return
          }
          console.error('未录制到音频')
          updateMeeting(meetingId, {
            summary:
              '## ❌ 未录制到音频\n\n请确认麦克风权限已开启，然后重新开始会议。',
            status: 'completed',
          })
          processingRef.current.delete(meetingId)
          return
        }

        // 2. Save audio file FIRST (before transcribe, so it's preserved if transcribe fails)
        if (audioBlob) {
          try {
            // 续录的第 N 段命名为 {id}-N.{ext}，首段保持 {id}.{ext} 兼容旧逻辑
            const audioPath = await saveMeetingAudio(
              meetingId,
              audioBlob,
              previousSegments.length + 1
            )
            updateMeeting(meetingId, {
              audioSegments: [...previousSegments, audioPath],
              // audioPath 始终指向第一段（结果页展示等旧逻辑依赖），为空时才写入
              ...(meeting.audioPath ? {} : { audioPath }),
            })
          } catch (audioSaveErr) {
            console.error('[Meeting] 保存音频文件失败:', audioSaveErr)
            // 音频未落盘，后续将无法重新转写，需让用户感知
            updateMeeting(meetingId, {
              error: '音频文件保存失败，本次会议将无法重新转写',
            })
          }
        }

        // 3. Transcribe audio
        console.log(
          '[Meeting] 开始转写, audioBlob size:',
          audioBlob.size,
          'type:',
          audioBlob.type
        )

        // 实时转写全部块成功时直接复用其拼接结果，跳过整段重复转写（省钱省时间）；
        // 有失败块或未开启实时转写时走原有完整转写流程（音频已落盘，可重转写）
        const liveTranscript = getFullTranscript(meetingId)
        let result: { text: string; duration?: number }
        if (liveTranscript) {
          console.log('[Meeting] 复用实时转写结果，跳过整段转写')
          updateMeeting(meetingId, { transcribeProgress: 100 })
          result = { text: liveTranscript }
        } else {
          updateMeeting(meetingId, { transcribeProgress: 5 })
          result = await transcribeAudio({
            audioBlob,
            language: 'zh',
            onProgress: (progress) => {
              updateMeeting(meetingId, { transcribeProgress: progress })
            },
          })
        }

        if (isContinuation) {
          // 续录：新段转写文本带时间标注追加到已有转写之后（读最新值，避免覆盖用户编辑）
          const latest = useMeetingStore
            .getState()
            .meetings.find((m) => m.id === meetingId)
          const now = new Date()
          const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          const existingTranscript = latest?.transcript || ''
          updateMeeting(meetingId, {
            transcript: existingTranscript
              ? `${existingTranscript}\n\n${t('resumeMarker', { time })}\n${result.text}`
              : result.text,
            transcribeProgress: 100,
          })
        } else {
          updateMeeting(meetingId, {
            transcript: result.text,
            transcribeProgress: 100,
          })
        }

        // 3.5 自动补充说话人标注：qwen3-asr-flash-realtime 不支持说话人分离，
        // 用户开启开关后，用 fun-asr + diarization 对全部音频段重转写并替换转写文本；
        // 失败时安静降级（保留实时转写原文），不影响主流程、不记录会议错误
        const {
          meetingAutoDiarize,
          sttEngine,
          aliyunAsrModel,
        } = useSettingStore.getState()
        const latestForDiarize = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        const diarizeAudioPaths = latestForDiarize
          ? getMeetingAudioPaths(latestForDiarize)
          : []
        if (
          meetingAutoDiarize &&
          sttEngine === 'aliyun' &&
          (aliyunAsrModel === 'qwen3-asr-flash-realtime' ||
            aliyunAsrModel === 'qwen-audio-3.0-asr-flash-streaming') &&
          diarizeAudioPaths.length > 0 &&
          latestForDiarize?.transcript
        ) {
          updateMeeting(meetingId, { diarizing: true, transcribeProgress: 5 })
          try {
            console.log('[Meeting] 开始自动补充说话人标注（fun-asr 重转写）')
            const texts: string[] = []
            for (let i = 0; i < diarizeAudioPaths.length; i++) {
              const segmentBlob = await loadMeetingAudio(diarizeAudioPaths[i])
              const diarizeResult = await transcribeWithFunAsrDiarization(
                segmentBlob,
                (progress) => {
                  // 多段时进度按段数折算到 0-100
                  updateMeeting(meetingId, {
                    transcribeProgress: Math.round(
                      (i * 100 + progress) / diarizeAudioPaths.length
                    ),
                  })
                }
              )
              texts.push(diarizeResult.text)
            }
            const diarizedText = texts.filter(Boolean).join('\n\n')
            if (diarizedText) {
              updateMeeting(meetingId, {
                transcript: diarizedText,
                transcribeProgress: 100,
              })
              console.log('[Meeting] 说话人标注补充完成')
            }
          } catch (diarizeErr) {
            // 降级：保留实时转写原文，不 setMeetingError（用户已有一份可用转写）
            console.error('[Meeting] 自动补充说话人标注失败，保留实时转写原文:', diarizeErr)
          } finally {
            updateMeeting(meetingId, { diarizing: false })
          }
        }

        // 4. Auto-generate title from transcript（续录不重新生成，首次已生成；
        // 仅标题为空时生成——拜访会议创建时已预设"{客户}拜访 {date}"标题，不能覆盖）
        if (!isContinuation) {
          const latestMeeting = useMeetingStore.getState().meetings.find((m) => m.id === meetingId)
          if (!latestMeeting?.title?.trim()) {
            try {
              const autoTitle = await generateMeetingTitle(result.text, latestMeeting?.selectedModel || undefined)
              updateMeeting(meetingId, { title: autoTitle })
            } catch (titleErr) {
              console.error('[Meeting] 自动生成标题失败:', titleErr)
              const now = new Date()
              const fallbackTitle = `会议 ${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
              updateMeeting(meetingId, { title: fallbackTitle })
            }
          }
        }

        updateMeeting(meetingId, { status: 'completed' })

        // 5. 拜访会议（关联 visitId）转写完成且纪要为空时，自动生成一次纪要（对齐冒烟清单 5.2）；
        // 失败安静回退走 setMeetingError，普通会议行为不变
        const finishedMeeting = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        if (finishedMeeting?.visitId && !finishedMeeting.summary) {
          await autoGenerateVisitSummary(meetingId)
        }
      } catch (err) {
        console.error('转写/生成失败:', err)
        const errorMsg =
          err instanceof Error ? err.message : '转写失败，请检查 STT 配置'
        // 续录失败时保留已生成的纪要，只记录错误
        if (!isContinuation) {
          updateMeeting(meetingId, {
            summary: `## ❌ 转写失败\n\n${errorMsg}\n\n请检查设置中的语音识别模型配置是否正确。`,
          })
        }
        setMeetingError(meetingId, errorMsg)
      } finally {
        processingRef.current.delete(meetingId)
      }
    },
    [updateMeeting, setMeetingError, t]
  )

  // Render based on active meeting state
  if (!activeMeeting) return <MeetingStartView />

  if (
    activeMeeting.status === 'recording' ||
    activeMeeting.status === 'paused'
  ) {
    return <MeetingRecordingView meetingId={activeMeeting.id} />
  }

  if (
    activeMeeting.status === 'transcribing' ||
    activeMeeting.status === 'generating' ||
    activeMeeting.status === 'completed'
  ) {
    // key 保证切换会议时 MeetingResult 整体重挂载，编辑器内容随之重置
    return <MeetingResult key={activeMeeting.id} meeting={activeMeeting} />
  }

  return <MeetingStartView />
}
