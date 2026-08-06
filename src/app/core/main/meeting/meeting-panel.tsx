'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useMeetingStore, getMeetingAudioPaths, type MeetingStatus } from './meeting-store'
import { MeetingControls } from './meeting-controls'
import { MeetingNotesEditor } from './meeting-notes-editor'
import { MeetingResult } from './meeting-result'
import {
  getRecorder,
  getRecorderMeetingId,
  getOrCreateRecorder,
  destroyRecorder,
} from './meeting-recorder-manager'
import { transcribeAudioWithFallback, transcribeWithFunAsrDiarization } from './meeting-transcribe'
import { loadMeetingAudio } from './meeting-load-audio'
import useSettingStore from '@/stores/setting'
import { useNetworkStore } from '@/stores/network'
import {
  startLiveTranscript,
  pauseLiveTranscript,
  resumeLiveTranscript,
  finalizeLiveTranscript,
  getFullTranscript,
  getPartialTranscript,
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
    // 客户拜访模板 {客户名称} 占位符来源 + S5 客户背景注入（行业/画像）
    let customerName: string | undefined
    let customerIndustry: string | undefined
    let customerProfile: string | undefined
    if (meeting.customerId) {
      const customer = await getCustomer(meeting.customerId).catch(() => null)
      customerName = customer?.name
      customerIndustry = customer?.industry || undefined
      customerProfile = customer?.profile || undefined
    }
    const fullSummary = await generateMeetingSummary({
      transcript: meeting.transcript,
      manualNotes: meeting.manualNotes,
      templateId: meeting.selectedTemplate,
      title: meeting.title || undefined,
      duration: meeting.duration || undefined,
      customerName,
      customerIndustry,
      customerProfile,
      createdAt: meeting.createdAt,
      modelId: meeting.selectedModel || undefined,
      onStream: (chunk) => {
        updateMeeting(meetingId, { summary: chunk })
      },
    })
    updateMeeting(meetingId, { summary: fullSummary, status: 'completed' })
    // S1：首次转写完成后自动生成的纪要也触发低置信度自检（SummaryEditor 监听事件；
    // 延迟等结果页编辑器挂载，与 result 派发逻辑一致）
    window.setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent('summary-uncertainty-check', {
          detail: { summary: fullSummary },
        })
      )
    }, 300)
    // 生成成功后自动导出到客户知识库并向量化（失败仅告警，不影响会议流程）
    const finished = useMeetingStore
      .getState()
      .meetings.find((m) => m.id === meetingId)
    if (finished) {
      void syncMeetingSummaryToCustomer({
        ...finished,
        summary: fullSummary,
      })
      // 待办确认弹窗（S8：合并笔记勾选待办）
      useTodoConfirmStore.getState().showFromSummary({
        meetingId: meetingId,
        meetingTitle: finished.title,
        customerId: finished.customerId || '',
        visitId: finished.visitId || '',
        summary: fullSummary,
        notes: finished.manualNotes,
      })
    }
  } catch (err) {
    console.error('[Meeting] 自动生成纪要失败:', err)
    const errorMsg = err instanceof Error ? err.message : '生成纪要失败'
    // 对齐手动生成路径：设置占位纪要，避免用户看到「转写成功但纪要空白」
    updateMeeting(meetingId, {
      summary: `## ❌ 生成失败\n\n${errorMsg}\n\n可在会议详情页点击「重新生成纪要」重试。`,
    })
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
  // 网络状态（联网恢复提示补转写用）
  const networkStatus = useNetworkStore((s) => s.status)
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting)
  const { toast } = useToast()

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
      // P0-1：改为 completed + 错误信息，让 MeetingResult 渲染错误态（idle 无渲染分支
      // 会回落到初始页，用户看不到错误提示）；同时清空 recordingMeetingId，
      // 否则该会议仍占全局录音槽位导致后续状态判断误判
      useMeetingStore.setState((state) => ({
        recordingMeetingId:
          state.recordingMeetingId === recordingMeeting.id
            ? null
            : state.recordingMeetingId,
        meetings: state.meetings.map((m) =>
          m.id === recordingMeeting.id
            ? { ...m, status: 'completed' as MeetingStatus, error: errorMsg }
            : m
        ),
      }))
      // 同步落库
      useMeetingStore
        .getState()
        .updateMeeting(recordingMeeting.id, {
          status: 'completed',
          error: errorMsg,
        })
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

  // 联网恢复自动提示：offline → online 时，若存在「待补转写」会议（离线结束标记），
  // 弹提示引导用户补转写。只提示一次，避免多次触发。
  const prevNetworkStatus = useRef(useNetworkStore.getState().status)
  useEffect(() => {
    const current = useNetworkStore.getState().status
    const wasOffline = prevNetworkStatus.current === 'offline'
    prevNetworkStatus.current = current
    if (!wasOffline || current !== 'online') return
    // 网络恢复：检查是否有待补转写的会议（独立 pendingTranscribe 标记，P1-2）
    const pendingMeeting = useMeetingStore
      .getState()
      .meetings.find((m) => m.status === 'completed' && m.pendingTranscribe)
    if (!pendingMeeting) return
    setActiveMeeting(pendingMeeting.id)
    toast({
      title: '网络已恢复',
      description: `「${pendingMeeting.title || '会议'}」已保存录音但未转写，点击「重新转写」即可补转录并生成纪要。`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkStatus])

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

      // 离线检测：结束会议时若断网，跳过实时转写/整段转写/AI 纪要，
      // 仅保存录音并标记「待补转写」，联网后由用户一键补转写（音频已落盘）
      const offlineAtEnd = useNetworkStore.getState().status === 'offline'

      try {
        // 1. Stop recording and get audioBlob
        let audioBlob: Blob | null = null
        // 归属校验：仅当录音器仍归属本会议时才 stop——若用户已快速结束本会议并新建了
        // 其他会议（录音器归属已切换），停掉它会误杀新会议的麦克风（M1 竞态）
        const recorderBelongsToMeeting =
          getRecorderMeetingId() === meetingId
        if (recorder && recorderBelongsToMeeting) {
          // 无论 recordingMeetingId 状态，只要录音器活着就停止并获取音频
          try {
            audioBlob = await recorder.stop()
          } catch (e) {
            console.error('[Meeting] recorder.stop() failed:', e)
          }
          destroyRecorder()
        } else if (recorder) {
          console.warn(
            `[Meeting] 录音器归属 ${getRecorderMeetingId()}，本会议 ${meetingId} 不停止（防误杀新会议录音）`
          )
        }

        // 结束录音：收尾实时转写（送出尾块并等待队列清空），供下方复用
        await finalizeLiveTranscript(meetingId)

        // 离线：只保存录音，跳过联网转写与纪要生成（联网后补）。
        // 但断网前实时转写已识别的文字要保留（P0-2：此前直接丢弃，联网后只能整段重转）
        if (offlineAtEnd && audioBlob && audioBlob.size > 0) {
          try {
            const offlinePath = await saveMeetingAudio(
              meetingId,
              audioBlob,
              previousSegments.length + 1
            )
            const liveText = getFullTranscript(meetingId)
            const partialText = liveText ? '' : getPartialTranscript(meetingId)?.text || ''
            const preservedTranscript = liveText || partialText
            const offlineError = preservedTranscript
              ? '当前离线，已保存录音并保留实时转写片段（断网前内容）。联网后可点击「重新转写」补全并生成纪要。'
              : '当前离线，已保存录音。联网后可点击「重新转写」补转录并生成纪要。'
            updateMeeting(meetingId, {
              audioSegments: [...previousSegments, offlinePath],
              ...(meeting.audioPath ? {} : { audioPath: offlinePath }),
              // 保留断网前实时转写已识别的文字，避免白丢
              ...(preservedTranscript
                ? { transcript: preservedTranscript, transcribeProgress: 100 }
                : {}),
              status: 'completed',
              // 独立待补转写标记（P1-2：不靠 error 文案匹配）
              pendingTranscribe: true,
              error: offlineError,
            })
            console.warn(
              '[Meeting] 离线结束会议：已保存录音',
              preservedTranscript
                ? `，保留实时转写 ${preservedTranscript.length} 字符`
                : '（无实时转写片段）',
              '待联网补转写'
            )
            processingRef.current.delete(meetingId)
            return
          } catch (saveErr) {
            // 录音保存失败：降级继续走正常流程（可能最终失败，但至少尝试）
            console.error('[Meeting] 离线保存录音失败，继续正常流程:', saveErr)
          }
        }

        if (!audioBlob || audioBlob.size === 0) {
          // 如果已经有 transcript（之前转写成功过），直接跳到完成
          if (meeting.transcript) {
            console.warn('[Meeting] No audio blob but transcript exists, skipping transcribe')
            updateMeeting(meetingId, { status: 'completed' })
            processingRef.current.delete(meetingId)
            // 续录场景：已有转写但纪要为空时仍尝试自动生成（拜访会议）
            const noBlobMeeting = useMeetingStore
              .getState()
              .meetings.find((m) => m.id === meetingId)
            if (noBlobMeeting?.visitId && !noBlobMeeting.summary) {
              await autoGenerateVisitSummary(meetingId)
            }
            return
          }
          // 录音器异常未产出音频时，仍有实时转写片段可用（含部分失败兜底）：
          // 直接复用，避免已识别的转写被「未录制到音频」丢弃
          const liveFallback = getFullTranscript(meetingId)
          const partial = liveFallback ? null : getPartialTranscript(meetingId)
          if (liveFallback || partial?.text) {
            const text = liveFallback || (partial as { text: string }).text
            console.warn('[Meeting] 录音器未产出音频，复用实时转写片段:', text.length, '字符')
            updateMeeting(meetingId, {
              transcript: text,
              transcribeProgress: 100,
              status: 'completed',
            })
            processingRef.current.delete(meetingId)
            const doneMeeting = useMeetingStore
              .getState()
              .meetings.find((m) => m.id === meetingId)
            if (doneMeeting?.visitId && !doneMeeting.summary) {
              await autoGenerateVisitSummary(meetingId)
            }
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
          // getFullTranscript 返回 null 时（实时转写有失败块/会话断开），尝试用已有
          // 成功片段兜底——避免长录音 2h+ 单 webm Blob 在浏览器 decodeAudioData 失败时
          // 把用户已得到的转写文字全部丢光
          const partial = getPartialTranscript(meetingId)
          if (partial.text && partial.failedCount > 0) {
            console.warn(
              `[Meeting] 实时转写有 ${partial.failedCount} 段失败，保留 ${partial.text.length} 字符`,
              ' 兜底使用，跳过整段转写'
            )
            updateMeeting(meetingId, {
              transcribeProgress: 100,
              // 明确提示用户：部分片段失败，结果可能不完整
              error: `实时转写有 ${partial.failedCount} 段失败，已保留其余片段（结果可能不完整）`,
            })
            result = { text: partial.text }
          } else {
            updateMeeting(meetingId, { transcribeProgress: 5 })
            // 统一兜底入口：主通道失败时自动降级（qwen 解码失败 → fun-asr 服务端；
            // fun-asr/paraformer 失败 → 自动重试一次；硅基流动等有阿里云配置也降级 fun-asr）
            const fallbackResult = await transcribeAudioWithFallback(audioBlob, {
              language: 'zh',
              customerId: meeting?.customerId || undefined,
              onProgress: (progress) => {
                updateMeeting(meetingId, { transcribeProgress: progress })
              },
            })
            result = {
              text: fallbackResult.text,
              duration: fallbackResult.duration,
            }
            if (fallbackResult.usedFallback) {
              console.warn('[Meeting] 已自动降级转写通道（fun-asr 服务端）')
            }
          }
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
        // 转写成功：清除离线「待补转写」标记（P1-2）
        updateMeeting(meetingId, { pendingTranscribe: false })

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
        } else if (finishedMeeting?.visitId && isContinuation && finishedMeeting.summary) {
          // 续录完成但已有旧纪要（第一段生成的）：新转写追加后纪要已过期。
          // 不自动覆盖（可能含用户手动编辑），仅提示用户手动重新生成
          console.warn('[Meeting] 续录完成，旧纪要可能不包含新录音内容，提示重新生成')
          updateMeeting(meetingId, {
            error: '续录完成，旧纪要可能不完整，建议点击「重新生成纪要」更新。',
          })
        }
      } catch (err) {
        console.error('转写/生成失败:', err)
        const errorMsg =
          err instanceof Error ? err.message : '转写失败，请检查 STT 配置'

        // —— 纠错机制：录音已落盘时，用 fun-asr 异步任务通道重转写 ——
        // 浏览器 decodeAudioData 对 2h+ 大 webm 有容器体积上限（约 1-2GB），
        // 整段转写可能失败；阿里云 fun-asr 异步任务接口服务端解码（支持 12h/2GB），
        // 且音频已保存到磁盘，读取后 base64 直传即可，不依赖浏览器解码。
        const fallbackMeeting = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        const fallbackPaths = fallbackMeeting
          ? getMeetingAudioPaths(fallbackMeeting)
          : []
        // 最终保险：统一入口失败（实时转写 null + 主通道失败）且录音已落盘时，
        // 读取保存的音频用 fun-asr 服务端异步任务通道重转（12h/2GB 无浏览器解码限制）
        if (!fallbackMeeting?.transcript && fallbackPaths.length > 0) {
          try {
            console.log('[Meeting] 转写失败，用已保存录音降级 fun-asr 服务端重转写')
            updateMeeting(meetingId, {
              transcribeProgress: 5,
              error: '转写失败，正在用阿里云服务端重新转写…',
            })
            const texts: string[] = []
            for (let i = 0; i < fallbackPaths.length; i++) {
              const segmentBlob = await loadMeetingAudio(fallbackPaths[i])
              const segmentResult = await transcribeWithFunAsrDiarization(
                segmentBlob,
                (progress) => {
                  updateMeeting(meetingId, {
                    transcribeProgress: Math.round(
                      ((i * 100 + progress) / fallbackPaths.length) * 0.9
                    ),
                  })
                }
              )
              if (segmentResult.text.trim()) {
                texts.push(segmentResult.text.trim())
              }
            }
            if (texts.length > 0) {
              updateMeeting(meetingId, {
                transcript: texts.join('\n'),
                transcribeProgress: 100,
                error: '',
                status: 'completed',
              })
              console.log('[Meeting] fun-asr 降级转写成功，共', texts.length, '段')
              // 降级成功后继续后续流程（标题/拜访纪要），不再走下方失败分支
              const fallbackDone = useMeetingStore
                .getState()
                .meetings.find((m) => m.id === meetingId)
              if (fallbackDone?.visitId && !fallbackDone.summary) {
                await autoGenerateVisitSummary(meetingId)
              }
              return
            }
          } catch (fallbackErr) {
            console.error('[Meeting] fun-asr 降级转写也失败:', fallbackErr)
          }
        }

        // 若已有 transcript（实时转写兜底成功），不要覆盖；仅记录错误让用户感知
        // 这样用户至少能拿到实时转写片段继续用，不会被「❌ 转写失败」覆盖丢失
        const latestWithErr = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        if (!isContinuation && !latestWithErr?.transcript) {
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
