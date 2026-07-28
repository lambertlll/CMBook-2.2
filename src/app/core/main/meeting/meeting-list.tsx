'use client'

import { useEffect, useState, useMemo, useDeferredValue } from 'react'
import { useMeetingStore, type MeetingStatus, type Meeting } from './meeting-store'
import { useCustomerStore } from '../customer/customer-store'
import { ClassifyToCustomerDialog } from './meeting-result'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Plus, Mic, Search, Users, AlertTriangle, FolderInput } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { getMeetingAudioPaths } from './meeting-store'
import {
  findInterruptedRecordings,
  recoverInterruptedRecording,
  discardInterruptedRecording,
  type InterruptedRecording,
} from './meeting-recording-recovery'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: MeetingStatus }) {
  const t = useTranslations('meeting')

  const config: Record<
    MeetingStatus,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    idle: { label: t('statusIdle'), variant: 'secondary' },
    recording: { label: t('statusRecording'), variant: 'destructive' },
    paused: { label: t('statusPaused'), variant: 'outline' },
    transcribing: { label: t('statusTranscribing'), variant: 'default' },
    generating: { label: t('statusGenerating'), variant: 'default' },
    completed: { label: t('statusCompleted'), variant: 'secondary' },
  }

  const { label, variant } = config[status]

  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0">
      {(status === 'recording') && (
        <span className="relative flex h-2 w-2 mr-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
        </span>
      )}
      {(status === 'transcribing' || status === 'generating') && (
        <span className="mr-1 h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {label}
    </Badge>
  )
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

export function MeetingList() {
  const t = useTranslations('meeting')
  const meetings = useMeetingStore((s) => s.meetings)
  const activeMeetingId = useMeetingStore((s) => s.activeMeetingId)
  const createMeeting = useMeetingStore((s) => s.createMeeting)
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting)
  const deleteMeeting = useMeetingStore((s) => s.deleteMeeting)
  const loadMeetings = useMeetingStore((s) => s.loadMeetings)
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const recordingMeetingId = useMeetingStore((s) => s.recordingMeetingId)
  const initialized = useMeetingStore((s) => s.initialized)
  // 客户名称映射：有关联客户的会议显示客户名小徽章（客户列表未加载时静默不显示）
  const customers = useCustomerStore((s) => s.customers)
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  // 归类到客户知识库的目标会议（右键菜单触发，对话框独立于菜单生命周期）
  const [classifyTarget, setClassifyTarget] = useState<Meeting | null>(null)
  // 崩溃残留的未正常结束录音（.part 临时文件）
  const [interrupted, setInterrupted] = useState<InterruptedRecording[]>([])

  // 延迟搜索词，避免每次击键都对全部会议文本做匹配
  const deferredQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    if (!initialized) {
      loadMeetings()
    }
  }, [initialized, loadMeetings])

  // 列表加载后探测一次崩溃残留的录音分片（.part 文件）
  useEffect(() => {
    if (!initialized) return
    let cancelled = false
    findInterruptedRecordings()
      .then((list) => {
        if (!cancelled) setInterrupted(list)
      })
      .catch((err) => {
        console.warn('[Meeting] 残留录音探测失败:', err)
      })
    return () => {
      cancelled = true
    }
  }, [initialized])

  // 当前正在录音的会议 .part 属于正常落盘，不算崩溃残留
  const visibleInterrupted = interrupted.filter(
    (item) => item.meetingId !== recordingMeetingId
  )

  // 恢复残留录音：转为该会议的正式音频段并回到可转写的稳定状态
  const handleRecoverRecording = async (item: InterruptedRecording) => {
    const meeting = meetings.find((m) => m.id === item.meetingId)
    if (!meeting) return
    try {
      const existingPaths = getMeetingAudioPaths(meeting)
      const savedPath = await recoverInterruptedRecording(
        item,
        existingPaths.length
      )
      updateMeeting(meeting.id, {
        audioSegments: [...existingPaths, savedPath],
        // audioPath 始终指向第一段（结果页等旧逻辑依赖），为空时才写入
        audioPath: meeting.audioPath || savedPath,
        status: 'completed',
        error: undefined,
      })
      setInterrupted((prev) =>
        prev.filter((p) => p.meetingId !== item.meetingId)
      )
      toast({ description: t('recoverRecordingSuccess') })
    } catch (err) {
      console.error('[Meeting] 恢复残留录音失败:', err)
      toast({
        description: t('recoverRecordingFailed'),
        variant: 'destructive',
      })
    }
  }

  // 丢弃残留录音：删除 .part 临时文件
  const handleDiscardRecording = async (item: InterruptedRecording) => {
    await discardInterruptedRecording(item)
    setInterrupted((prev) => prev.filter((p) => p.meetingId !== item.meetingId))
    toast({ description: t('discardRecordingSuccess') })
  }

  useEffect(() => {
    if (!customersInitialized) {
      loadCustomers()
    }
  }, [customersInitialized, loadCustomers])

  // 客户 ID → 客户名（客户已删除时映射不到，徽章静默不显示）
  const customerNameMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers]
  )

  // 缓存各会议的 lowercase 搜索文本，仅在 meetings 变化时重算
  const searchTexts = useMemo(
    () =>
      meetings.map((meeting) => ({
        meeting,
        text: [
          meeting.title || '',
          meeting.transcript || '',
          stripHtml(meeting.manualNotes || ''),
          meeting.summary || '',
        ]
          .join('\n')
          .toLowerCase(),
      })),
    [meetings]
  )

  const filteredMeetings = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase()
    if (!query) return meetings
    return searchTexts
      .filter((item) => item.text.includes(query))
      .map((item) => item.meeting)
  }, [meetings, searchTexts, deferredQuery])

  const handleNewMeeting = () => {
    createMeeting()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with new meeting button */}
      <div className="p-2 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleNewMeeting}
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('newMeeting')}
        </Button>
      </div>

      {/* Search box */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('searchMeetings')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* 崩溃残留录音恢复提示条 */}
      {visibleInterrupted.length > 0 && (
        <div className="p-2 border-b border-warning/40 bg-warning/10 dark:border-warning dark:bg-warning/30">
          <div className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {t('interruptedRecordingsBanner', {
              count: visibleInterrupted.length,
            })}
          </div>
          <div className="mt-1.5 space-y-1">
            {visibleInterrupted.map((item) => {
              const meeting = meetings.find((m) => m.id === item.meetingId)
              return (
                <div key={item.meetingId} className="flex items-center gap-1.5">
                  <span className="flex-1 truncate text-xs text-warning">
                    {meeting
                      ? meeting.title || t('untitledMeeting')
                      : t('orphanRecording')}
                  </span>
                  <span className="shrink-0 text-[10px] text-warning">
                    {formatSize(item.sizeBytes)}
                  </span>
                  {/* 会议记录已删除的孤儿残留只能丢弃 */}
                  {meeting && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleRecoverRecording(item)}
                    >
                      {t('recoverRecording')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleDiscardRecording(item)}
                  >
                    {t('discardRecording')}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Meeting list */}
      <ScrollArea className="flex-1">
        {meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Mic className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {t('noMeetings')}
            </p>
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Search className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {t('noSearchResults')}
            </p>
          </div>
        ) : (
          <div className="p-1">
            {filteredMeetings.map((meeting) => (
              <ContextMenu key={meeting.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'group relative w-full text-left p-2.5 rounded-md transition-colors cursor-pointer',
                      'hover:bg-accent/50',
                      activeMeetingId === meeting.id && 'bg-accent'
                    )}
                    onClick={() => setActiveMeeting(meeting.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate flex-1">
                        {meeting.title || t('untitledMeeting')}
                      </span>
                      <StatusBadge status={meeting.status} />
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatTime(meeting.createdAt)}
                      </span>
                      {/* 关联客户的会议显示客户名小徽章（客户未加载/已删除时不显示） */}
                      {meeting.customerId &&
                        customerNameMap.get(meeting.customerId) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 gap-0.5"
                          >
                            <Users className="w-2.5 h-2.5" />
                            {customerNameMap.get(meeting.customerId)}
                          </Badge>
                        )}
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setActiveMeeting(meeting.id)}>
                    查看会议
                  </ContextMenuItem>
                  {/* 归类到客户知识库：已出纪要但未关联客户时可用（与会议结果页同一对话框） */}
                  {meeting.summary && !meeting.customerId && (
                    <ContextMenuItem onClick={() => setClassifyTarget(meeting)}>
                      <FolderInput className="w-4 h-4 mr-2" />
                      {t('classifyToCustomer')}
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTargetId(meeting.id)}
                  >
                    删除会议
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* 归类到客户知识库对话框（复用会议结果页实现，挂在菜单外） */}
      {classifyTarget && (
        <ClassifyToCustomerDialog
          meeting={classifyTarget}
          open={!!classifyTarget}
          onOpenChange={(open) => {
            if (!open) setClassifyTarget(null)
          }}
          onExported={() => {
            // 归类导出成功后无需额外处理（列表徽章自动随 store 更新）
          }}
        />
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTargetId) deleteMeeting(deleteTargetId)
                setDeleteTargetId(null)
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
