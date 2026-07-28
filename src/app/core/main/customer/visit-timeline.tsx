'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCustomerStore } from './customer-store'
import { useMeetingStore, type MeetingStatus } from '../meeting/meeting-store'
import { useSidebarStore } from '@/stores/sidebar'
import { useVisitTodosStore } from '@/stores/visit-todos'
import useArticleStore from '@/stores/article'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { CUSTOMER_MEETING_SUBFOLDER } from '@/lib/customer-folders'
import type { CustomerRecord } from '@/db/customers'
import type { VisitRecord } from '@/db/visits'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  Mic,
  Trash2,
  Loader2,
  MoreHorizontal,
  Check,
  History,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react'

/** 拜访时间线默认展开的最近拜访场数（超出部分折叠到"展开更早"） */
const RECENT_VISIT_COUNT = 3
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { PrevisitSection } from './previsit-section'
import { PostvisitSection } from './postvisit-section'
import { CollapsibleCustomerSection } from './customer-collapsible-section'
import type { VisitType } from '@/db/visits'

/** 本地日期 YYYY-MM-DD（拜访日期展示与文件名共用格式） */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// B3 状态语义色：录音中=红、转写/生成中=黄（琥珀）、已完成=绿、失败/错误=红描边、其余=灰
const MEETING_STATUS_CLASS: Record<MeetingStatus, string> = {
  idle: 'border-border bg-background text-muted-foreground',
  recording: 'border-transparent bg-destructive text-destructive-foreground',
  paused: 'border-border bg-background text-muted-foreground',
  transcribing:
    'border-warning/50 bg-warning/10 text-warning',
  generating:
    'border-warning/50 bg-warning/10 text-warning',
  completed:
    'border-success/50 bg-success/10 text-success',
}

/** 会议状态徽章（拜访卡片"访中"区块用，复用 meeting 命名空间文案；hasError 时红描边优先） */
function MeetingStatusBadge({
  status,
  hasError,
}: {
  status: MeetingStatus
  hasError?: boolean
}) {
  const tMeeting = useTranslations('meeting')
  const keyMap: Record<MeetingStatus, string> = {
    idle: 'statusIdle',
    recording: 'statusRecording',
    paused: 'statusPaused',
    transcribing: 'statusTranscribing',
    generating: 'statusGenerating',
    completed: 'statusCompleted',
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] px-1.5 py-0',
        hasError
          ? 'border-destructive/60 bg-destructive/5 text-destructive'
          : MEETING_STATUS_CLASS[status]
      )}
    >
      {status === 'recording' && !hasError && (
        <span className="relative flex h-1.5 w-1.5 mr-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-danger" />
        </span>
      )}
      {(status === 'transcribing' || status === 'generating') && !hasError && (
        <span className="mr-1 h-1.5 w-1.5 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {tMeeting(keyMap[status])}
    </Badge>
  )
}

// B3 拜访阶段徽章语义色：已拜访=黄、准备中=灰
//（'followed' 已废弃：报告生成提升到客户级后不再写入，历史数据按已拜访展示）
const STAGE_BADGE_CLASS: Record<string, string> = {
  preparing: 'border-border bg-background text-muted-foreground',
  visited:
    'border-warning/50 bg-warning/10 text-warning',
}

// B5 拜访类型选项（新建拜访对话框 chips 单选；'' 表示未指定）
const VISIT_TYPE_OPTIONS: Exclude<VisitType, ''>[] = [
  'first-visit',
  'regular-return',
  'post-loan',
  'marketing',
]

/** A2 步骤条圆点：完成步对勾替代数字、当前步柔和外发光 ring，颜色随状态平滑过渡 */
function StepDot({
  done,
  current,
  index,
}: {
  done: boolean
  current: boolean
  index: number
}) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition-colors duration-300',
        done
          ? 'border-primary bg-primary text-primary-foreground'
          : current
            ? 'border-primary text-primary ring-4 ring-primary/15'
            : 'border-border text-muted-foreground'
      )}
    >
      {done ? <Check className="h-3 w-3" /> : index}
    </span>
  )
}

/** A2 步骤条连接线：颜色随完成态平滑过渡 */
function StepConnector({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        'w-px flex-1 transition-colors duration-300',
        done ? 'bg-primary' : 'bg-border'
      )}
    />
  )
}

/** 拜访类型的 i18n 键映射 */
function visitTypeLabelKey(visitType: string): string | null {
  switch (visitType) {
    case 'first-visit':
      return 'visitTypeFirst'
    case 'regular-return':
      return 'visitTypeRegular'
    case 'post-loan':
      return 'visitTypePostLoan'
    case 'marketing':
      return 'visitTypeMarketing'
    default:
      return null
  }
}

export function VisitTimeline({ customer }: { customer: CustomerRecord }) {
  const t = useTranslations('customer')
  const visits = useCustomerStore((s) => s.visits)
  const visitsLoadedFor = useCustomerStore((s) => s.visitsLoadedFor)
  const loadVisits = useCustomerStore((s) => s.loadVisits)
  const createVisit = useCustomerStore((s) => s.createVisit)
  const updateVisit = useCustomerStore((s) => s.updateVisit)
  const removeVisit = useCustomerStore((s) => s.removeVisit)
  const meetings = useMeetingStore((s) => s.meetings)
  const meetingsInitialized = useMeetingStore((s) => s.initialized)
  const loadMeetings = useMeetingStore((s) => s.loadMeetings)
  // 访后步骤完成判定依赖拜访级待办（store 排序即未完成在前）
  const todos = useVisitTodosStore((s) => s.todos)
  const todosInitialized = useVisitTodosStore((s) => s.initialized)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)

  // 新建拜访对话框状态
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newVisitType, setNewVisitType] = useState<VisitType>('') // B5 拜访类型（默认未指定）
  // 后补拜访记录：新建拜访时可关联的已有会议（当前客户且尚未关联拜访）
  const [linkMeetingId, setLinkMeetingId] = useState('')
  const linkableMeetings = useMemo(
    () => meetings.filter((m) => m.customerId === customer.id && !m.visitId),
    [meetings, customer.id]
  )
  // 拜访较多时默认只展开最近几场，更早的收起（防时间线过长）
  const [showAllVisits, setShowAllVisits] = useState(false)
  const visibleVisits = showAllVisits ? visits : visits.slice(0, RECENT_VISIT_COUNT)
  const hiddenVisitCount = visits.length - visibleVisits.length
  const [creating, setCreating] = useState(false)
  // 删除确认目标
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  // 开始拜访会议的进行中拜访 ID（按钮 loading，防双击重复创建）
  const [startingVisitId, setStartingVisitId] = useState<string | null>(null)

  // 当前客户的拜访列表未加载时补加载（selectCustomer 已触发过一次，这里兜底）
  useEffect(() => {
    if (visitsLoadedFor !== customer.id) {
      loadVisits(customer.id)
    }
  }, [customer.id, visitsLoadedFor, loadVisits])

  // 会议列表未加载时加载（解析拜访关联的会议标题/状态需要）
  useEffect(() => {
    if (!meetingsInitialized) {
      loadMeetings()
    }
  }, [meetingsInitialized, loadMeetings])

  // 待办未加载时补加载（访后步骤完成判定需要；customer-panel 也会触发，这里兜底）
  useEffect(() => {
    if (!todosInitialized) void loadTodos()
  }, [todosInitialized, loadTodos])

  // 拜访渲染区域按 id 索引会议（避免每个拜访卡片都线性 find）
  const meetingById = useMemo(
    () => new Map(meetings.map((m) => [m.id, m])),
    [meetings]
  )

  const openCreateDialog = () => {
    const today = formatDate(Date.now())
    setNewTitle(t('visitDefaultTitle', { date: today }))
    setNewDate(today)
    setNewNotes('')
    setNewVisitType('')
    setLinkMeetingId('')
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title) return
    setCreating(true)
    try {
      // 日期输入为 YYYY-MM-DD，按本地零点存时间戳
      const visitDate = newDate
        ? new Date(`${newDate}T00:00:00`).getTime()
        : Date.now()
      const visit = await createVisit({
        customerId: customer.id,
        title,
        visitDate,
        visitType: newVisitType,
        notes: newNotes.trim(),
      })
      // 关联已有会议（后补拜访记录）：双向关联并把拜访置为已拜访
      if (linkMeetingId) {
        await updateVisit(visit.id, { meetingId: linkMeetingId, stage: 'visited' })
        useMeetingStore.getState().updateMeeting(linkMeetingId, { visitId: visit.id })
      }
      setCreateOpen(false)
    } catch (err) {
      console.error('[VisitTimeline] 创建拜访失败:', err)
      toast({ description: t('visitCreateFailed'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // 跳转到会议 Tab 并选中关联会议（录音中的会议会直接进入录音界面）
  const openLinkedMeeting = async (meetingId: string) => {
    const sidebar = useSidebarStore.getState()
    if (!sidebar.leftSidebarVisible) {
      await sidebar.toggleLeftSidebar()
    }
    await useSidebarStore.getState().setLeftSidebarTab('meeting')
    useMeetingStore.getState().setActiveMeeting(meetingId)
  }

  // 在编辑器中打开归档笔记（访中笔记文档，切到文件 Tab 复用文件模块打开方式）
  const openNoteDoc = async (path: string) => {
    try {
      const sidebar = useSidebarStore.getState()
      if (!sidebar.leftSidebarVisible) {
        await sidebar.toggleLeftSidebar()
      }
      await useSidebarStore.getState().setLeftSidebarTab('files')
      await useArticleStore.getState().setActiveFilePath(path)
    } catch (err) {
      console.error('[VisitTimeline] 打开拜访笔记失败:', err)
    }
  }

  /** 检查工作区相对路径文件是否存在（关联笔记同名去重用） */
  const workspaceFileExists = async (relativePath: string) => {
    const options = await getFilePathOptions(relativePath)
    return exists(
      options.path,
      options.baseDir ? { baseDir: options.baseDir } : undefined
    )
  }

  // 关联笔记（归档型拜访）：选一篇 Markdown 复制到客户「访中」目录作为拜访记录并向量化
  const [linkingNoteVisitId, setLinkingNoteVisitId] = useState<string | null>(null)
  const handleLinkNote = async (visit: VisitRecord) => {
    if (linkingNoteVisitId) return
    setLinkingNoteVisitId(visit.id)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (!selected || typeof selected !== 'string') return

      const content = await readTextFile(selected)
      const dateStr = formatDate(visit.visitDate || Date.now())
      const dirRel = `${customer.folderPath}/${CUSTOMER_MEETING_SUBFOLDER}`
      // 同名冲突自动加 -2/-3 后缀
      let relativePath = `${dirRel}/${dateStr}-拜访笔记.md`
      let suffix = 2
      while (await workspaceFileExists(relativePath)) {
        relativePath = `${dirRel}/${dateStr}-拜访笔记-${suffix}.md`
        suffix++
      }
      const dirOptions = await getFilePathOptions(dirRel)
      await mkdir(dirOptions.path, {
        baseDir: dirOptions.baseDir,
        recursive: true,
      })
      const pathOptions = await getFilePathOptions(relativePath)
      await writeTextFile(
        pathOptions.path,
        content,
        pathOptions.baseDir ? { baseDir: pathOptions.baseDir } : undefined
      )
      // 向量化（尽力而为，embedding 未配置/失败不影响关联）
      try {
        const { checkEmbeddingModelAvailable, processMarkdownFile } = await import('@/lib/rag')
        if (await checkEmbeddingModelAvailable()) {
          await processMarkdownFile(relativePath, content)
        }
      } catch (embedErr) {
        console.warn('[VisitTimeline] 拜访笔记向量化失败:', embedErr)
      }
      await updateVisit(visit.id, { noteDocPath: relativePath, stage: 'visited' })
      toast({ description: t('linkNoteSuccess') })
    } catch (err) {
      console.error('[VisitTimeline] 关联笔记失败:', err)
      toast({ description: t('linkNoteFailed'), variant: 'destructive' })
    } finally {
      setLinkingNoteVisitId(null)
    }
  }

  // 开始拜访会议：新建会议并关联客户/拜访，默认客户拜访纪要模板，跳转进入录音
  const handleStartVisitMeeting = async (visit: VisitRecord) => {
    // 防双击：启动流程进行中（加载会议列表/回写拜访）直接忽略重复点击
    if (startingVisitId) return
    setStartingVisitId(visit.id)
    try {
      // 会议列表未加载时先加载，与 quickStartMeeting 的启动流程保持一致
      const meetingStore = useMeetingStore.getState()
      if (!meetingStore.initialized) {
        await meetingStore.loadMeetings()
      }

      const sidebar = useSidebarStore.getState()
      if (!sidebar.leftSidebarVisible) {
        await sidebar.toggleLeftSidebar()
      }
      await useSidebarStore.getState().setLeftSidebarTab('meeting')

      // 已有录音中的会议时只跳转到会议标签并提示，不新建
      // （与 quickStartMeeting 守卫一致：此时新建会销毁正在录音的旧录音器，导致音频丢失）
      if (useMeetingStore.getState().recordingMeetingId) {
        toast({ description: t('meetingRecordingBusy') })
        return
      }

      const dateStr = formatDate(visit.visitDate || Date.now())
      // createMeeting 内部会置为 activeMeeting + recordingMeeting，落地即进入录音界面
      const meetingId = useMeetingStore.getState().createMeeting({
        title: t('startMeetingTitle', { name: customer.name, date: dateStr }),
        selectedTemplate: 'customer-visit',
        customerId: customer.id,
        visitId: visit.id,
      })

      // 回写拜访：关联会议 ID；拜访日期未确定时补当前时间
      try {
        await useCustomerStore.getState().updateVisit(visit.id, {
          meetingId,
          ...(visit.visitDate ? {} : { visitDate: Date.now() }),
        })
      } catch (err) {
        console.error('[VisitTimeline] 回写拜访关联会议失败:', err)
      }
    } finally {
      setStartingVisitId(null)
    }
  }

  return (
    // 可折叠区块（C1）：标题行常驻（图标衬底+标题+拜访数摘要+chevron），折叠状态按区块全局持久化；
    // 仅外层包折叠容器，步骤条与拜访卡片逻辑零改动
    <CollapsibleCustomerSection
      sectionId="timeline"
      icon={
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <History className="w-3.5 h-3.5 text-primary" />
        </span>
      }
      title={t('timelineTitle')}
      summary={t('summaryVisitCount', { count: visits.length })}
      headerExtra={
        <Button variant="outline" size="sm" onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-1" />
          {t('newVisit')}
        </Button>
      }
    >
      {/* 拜访卡片列表（store 已按拜访时间倒序） */}
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">{t('noVisitsCoach')}</p>
      ) : (
        <div className="flex flex-col gap-3 mt-3">
          {visibleVisits.map((visit) => {
            const linkedMeeting = visit.meetingId
              ? meetingById.get(visit.meetingId)
              : undefined
            const typeLabelKey = visitTypeLabelKey(visit.visitType || '')
            // A2 纵向步骤条：访前 → 访中 → 访后依次排列
            // 完成判定：访前=已生成访前材料；访中=已关联会议或笔记；访后=该拜访有待办且全部完成
            // 拜访形态（2.4）：归档型拜访（已有会议/笔记归档且无访前材料）只渲染 访中/访后 两步
            const visitTodos = todos.filter((todo) => todo.visitId === visit.id)
            const todosAllDone =
              visitTodos.length > 0 &&
              visitTodos.every((todo) => todo.done === 1)
            const isArchivedVisit = !!visit.meetingId || !!visit.noteDocPath
            const showPreStep = !isArchivedVisit || !!visit.previsitDocPath
            const stepDone = showPreStep
              ? [!!visit.previsitDocPath, isArchivedVisit, todosAllDone]
              : [isArchivedVisit, todosAllDone]
            // 当前步骤 = 第一个未完成步骤（全部完成时为 -1，全部按完成态渲染）
            const currentStepIndex = stepDone.findIndex((done) => !done)
            return (
              <ContextMenu key={visit.id}>
                <ContextMenuTrigger asChild>
                  <div className="group rounded-md border bg-background p-3">
                    {/* 卡片头部：标题 + 类型徽章 + 阶段徽章 + hover「⋯」菜单（A4） */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {visit.title}
                        </span>
                        {typeLabelKey && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] px-1.5 py-0 text-muted-foreground"
                          >
                            {t(typeLabelKey)}
                          </Badge>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0',
                            visit.stage === 'preparing'
                              ? STAGE_BADGE_CLASS.preparing
                              : STAGE_BADGE_CLASS.visited
                          )}
                        >
                          {visit.stage === 'preparing'
                            ? t('stagePreparing')
                            : t('stageVisited')}
                        </Badge>
                        {/* A4 菜单发现性：hover 显示「⋯」，菜单项与右键菜单一致 */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label={t('deleteVisit')}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTargetId(visit.id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {t('deleteVisit')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </div>
                    {!!visit.visitDate && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(visit.visitDate)}
                      </p>
                    )}

                    {/* A2 纵向步骤条：左侧序号圆点 + 连接线（已完成主色、当前/未开始弱化），内容区横向铺开。
                        归档型拜访（无访前材料）只渲染 访中/访后 两步；计划型拜访渲染完整三步 */}
                    <div className="flex flex-col mt-2">
                      {/* 访前：尽调报告列表 + 生成访前材料（client-research skill）；归档型拜访不显示 */}
                      {showPreStep && (
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <StepDot done={stepDone[0]} current={currentStepIndex === 0} index={1} />
                            <StepConnector done={stepDone[0]} />
                          </div>
                          <div className="min-w-0 flex-1 pb-2">
                            <PrevisitSection customer={customer} visit={visit} />
                          </div>
                        </div>
                      )}

                      {/* 访中：已关联会议/笔记可点击打开；未关联显示开始拜访会议 + 关联笔记 */}
                      <div className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <StepDot
                            done={stepDone[showPreStep ? 1 : 0]}
                            current={currentStepIndex === (showPreStep ? 1 : 0)}
                            index={showPreStep ? 2 : 1}
                          />
                          <StepConnector done={stepDone[showPreStep ? 1 : 0]} />
                        </div>
                        <div className="min-w-0 flex-1 pb-2">
                          <div className="rounded border bg-card p-2">
                            <div className="flex items-center gap-1.5">
                              <Mic className="w-3.5 h-3.5 text-primary" />
                              <span className="text-sm font-medium">
                                {t('stageDuringTitle')}
                              </span>
                            </div>
                            {visit.meetingId ? (
                              linkedMeeting ? (
                                <button
                                  type="button"
                                  className="mt-1 flex w-full items-center justify-between gap-1 text-left"
                                  onClick={() => openLinkedMeeting(linkedMeeting.id)}
                                >
                                  <span className="text-sm text-primary hover:underline truncate">
                                    {linkedMeeting.title}
                                  </span>
                                  <MeetingStatusBadge
                                    status={linkedMeeting.status}
                                    hasError={!!linkedMeeting.error}
                                  />
                                </button>
                              ) : meetingsInitialized ? (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {t('meetingDeleted')}
                                </p>
                              ) : (
                                // 会议列表未加载完时找不到关联会议是正常过程，不闪烁"会议已删除"
                                <p className="text-sm text-muted-foreground mt-1">
                                  {t('meetingLoading')}
                                </p>
                              )
                            ) : visit.noteDocPath ? (
                              // 归档型拜访（笔记）：点击在编辑器打开拜访笔记
                              <button
                                type="button"
                                className="mt-1 flex items-center gap-1.5 text-left"
                                onClick={() => openNoteDoc(visit.noteDocPath)}
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-sm text-primary hover:underline truncate">
                                  {visit.noteDocPath.split('/').pop()}
                                </span>
                              </button>
                            ) : (
                              // 计划型拜访：录音开会 或 直接关联一篇笔记
                              <div className="flex gap-1.5 mt-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 flex-1 text-sm"
                                  disabled={startingVisitId === visit.id}
                                  onClick={() => handleStartVisitMeeting(visit)}
                                >
                                  {startingVisitId === visit.id ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                  ) : (
                                    <Mic className="w-3.5 h-3.5 mr-1" />
                                  )}
                                  {t('startVisitMeeting')}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 flex-1 text-sm"
                                  disabled={linkingNoteVisitId === visit.id}
                                  onClick={() => handleLinkNote(visit)}
                                >
                                  {linkingNoteVisitId === visit.id ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                  ) : (
                                    <FileText className="w-3.5 h-3.5 mr-1" />
                                  )}
                                  {t('linkNote')}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 访后：拜访级待办清单（纪要生成自动提取，勾选完成；报告生成已提升到客户级） */}
                      <div className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <StepDot
                            done={stepDone[showPreStep ? 2 : 1]}
                            current={currentStepIndex === (showPreStep ? 2 : 1)}
                            index={showPreStep ? 3 : 2}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <PostvisitSection visit={visit} />
                        </div>
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTargetId(visit.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t('deleteVisit')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      )}

      {/* 拜访较多时的折叠开关：默认只显示最近 RECENT_VISIT_COUNT 场 */}
      {hiddenVisitCount > 0 && !showAllVisits && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full text-muted-foreground"
          onClick={() => setShowAllVisits(true)}
        >
          <ChevronDown className="w-4 h-4 mr-1" />
          {t('showEarlierVisits', { count: hiddenVisitCount })}
        </Button>
      )}
      {showAllVisits && visits.length > RECENT_VISIT_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full text-muted-foreground"
          onClick={() => setShowAllVisits(false)}
        >
          <ChevronUp className="w-4 h-4 mr-1" />
          {t('hideEarlierVisits')}
        </Button>
      )}

      {/* 新建拜访对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('visitCreateTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('visitTitleLabel')}</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t('visitDateLabel')}</Label>
              <Input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            {/* B5 拜访类型：chips 单选（再点已选中的可取消，默认空） */}
            <div className="space-y-1">
              <Label>{t('visitTypeLabel')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {VISIT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      newVisitType === option
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                    onClick={() =>
                      setNewVisitType(newVisitType === option ? '' : option)
                    }
                  >
                    {t(visitTypeLabelKey(option)!)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('visitNotesLabel')}</Label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder={t('visitNotesPlaceholder')}
                rows={3}
              />
            </div>
            {/* 后补拜访记录：可关联该客户尚未关联拜访的已有会议（双向关联，拜访置为已拜访） */}
            {linkableMeetings.length > 0 && (
              <div className="space-y-1">
                <Label>{t('visitLinkMeetingLabel')}</Label>
                <Select value={linkMeetingId || 'none'} onValueChange={(v) => setLinkMeetingId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('visitLinkMeetingNone')}</SelectItem>
                    {linkableMeetings.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title || m.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              {creating ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除拜访确认（仅删 visits 记录，关联会议与文件保留） */}
      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteVisitConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteVisitConfirmDesc', {
                title:
                  visits.find((v) => v.id === deleteTargetId)?.title ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                // removeVisit 内部乐观删除 + 失败回滚，这里捕获错误提示
                if (deleteTargetId) {
                  try {
                    await removeVisit(deleteTargetId)
                  } catch {
                    toast({ description: t('visitDeleteFailed'), variant: 'destructive' })
                  }
                }
                setDeleteTargetId(null)
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CollapsibleCustomerSection>
  )
}

