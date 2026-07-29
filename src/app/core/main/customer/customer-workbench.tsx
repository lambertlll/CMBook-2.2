'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarClock, ListChecks, ListTodo, Loader2, Mic, Users, X, Zap } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useCustomerStore } from './customer-store'
import { useVisitGenerateStore, type VisitGenerateKind } from './visit-generate-manager'
import { useMeetingStore, type Meeting } from '../meeting/meeting-store'
import { syncMeetingSummaryToCustomer, ensureVisitForMeeting } from '../meeting/meeting-customer-export'
import { useTodoConfirmStore } from '@/stores/todo-confirm'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { useSidebarStore } from '@/stores/sidebar'
import { getUpcomingVisits, type UpcomingVisitRecord } from '@/db/visits'
import type { VisitTodoRecord } from '@/db/visit-todos'

// 进行中任务的会议状态（录音/转写/纪要生成中）
const ACTIVE_MEETING_STATUSES = new Set(['recording', 'transcribing', 'generating'])
// 待归类会议卡片最多展示条数
const UNCLASSIFIED_MEETING_LIMIT = 5

// 日期紧凑展示：M月d日 风格随系统语言
function formatVisitDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMeetingTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 工作卡片（原型 .card）：主色描边图标 + 标题 + 右侧数量；行间发丝线分隔；空态一行轻文案
function WorkbenchCard({
  icon,
  title,
  count,
  emptyText,
  children,
  ref,
}: {
  icon: ReactNode
  title: string
  count: number
  emptyText: string
  children: ReactNode
  ref?: Ref<HTMLElement>
}) {
  return (
    <section ref={ref} className="paper-sec scroll-mt-4 overflow-hidden rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-[18px] py-[13px]">
        <span className="shrink-0 text-primary [&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {count > 0 && (
          <span className="ml-auto text-xs font-normal text-muted-foreground">{count}</span>
        )}
      </header>
      {count === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-[22px]">
          <span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          <p className="text-[13px] text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        children
      )}
    </section>
  )
}

// 卡片行（原型 .todo-row）：整行可点，行间发丝线分隔，末行无线
function CardRow({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b px-[18px] py-2.5 text-left text-[13px] transition-colors last:border-b-0 hover:bg-accent"
    >
      {children}
    </button>
  )
}

// 顶部统计项（原型 .stat-card）：小图标 + 小标签 + 大号数字，点击滚动到对应卡片区
// unit 为 paper 主题大号明体数字后的单位小字（场/项），非 paper 主题下经 hidden 隐藏，不影响经典视觉
function StatCard({
  icon,
  label,
  value,
  unit,
  tone = 'default',
  onClick,
}: {
  icon: ReactNode
  label: string
  value: number
  unit?: string
  tone?: 'default' | 'accent' | 'warning'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="paper-stat-cell rounded-lg border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent/60"
    >
      <span className="paper-stat-label flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0 text-muted-foreground/70 [&>svg]:h-[13px] [&>svg]:w-[13px]">
          {icon}
        </span>
        {label}
      </span>
      <span
        className={cn(
          'paper-stat-num mt-1.5 block text-2xl font-semibold tabular-nums',
          tone === 'accent' && 'text-primary',
          tone === 'warning' && 'text-warning'
        )}
      >
        {value}
        {unit && <span className="paper-stat-unit hidden">{unit}</span>}
      </span>
    </button>
  )
}

/**
 * 工作台：客户 Tab 未选中客户时的中栏落地页（V1 商务藏青原型）。
 * 顶部：页头 → 右栏收起时的待办摘要条 → 横向统计条（点击滚动到对应卡片）；
 * 工作卡片（2x2 网格）：📅 近 7 天待拜访 / ⚡ 进行中 / ✅ 待确认待办 / 🎙 待归类会议（后两块可行内处理）。
 */
export function CustomerWorkbench() {
  const t = useTranslations('workbench')
  const tMeeting = useTranslations('meeting')
  const tTodos = useTranslations('todos')

  const customers = useCustomerStore((s) => s.customers)
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const selectCustomer = useCustomerStore((s) => s.selectCustomer)

  const meetings = useMeetingStore((s) => s.meetings)
  const meetingsInitialized = useMeetingStore((s) => s.initialized)
  const loadMeetings = useMeetingStore((s) => s.loadMeetings)
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting)
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)

  const generateTasks = useVisitGenerateStore((s) => s.tasks)
  const todos = useVisitTodosStore((s) => s.todos)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)
  const confirmTodo = useVisitTodosStore((s) => s.confirmTodo)
  const removeTodo = useVisitTodosStore((s) => s.removeTodo)

  const rightSidebarVisible = useSidebarStore((s) => s.rightSidebarVisible)
  const toggleRightSidebar = useSidebarStore((s) => s.toggleRightSidebar)
  const setLeftSidebarTab = useSidebarStore((s) => s.setLeftSidebarTab)

  const [upcomingVisits, setUpcomingVisits] = useState<UpcomingVisitRecord[]>([])

  // 统计条点击滚动锚点：四张工作卡片
  const upcomingCardRef = useRef<HTMLElement | null>(null)
  const inProgressCardRef = useRef<HTMLElement | null>(null)
  const todosCardRef = useRef<HTMLElement | null>(null)
  const unclassifiedCardRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!customersInitialized) void loadCustomers()
  }, [customersInitialized, loadCustomers])

  useEffect(() => {
    if (!meetingsInitialized) void loadMeetings()
  }, [meetingsInitialized, loadMeetings])

  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  useEffect(() => {
    getUpcomingVisits(7)
      .then(setUpcomingVisits)
      .catch((err) => console.error('[Workbench] 加载待拜访失败:', err))
  }, [])

  const customerNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of customers) map.set(c.id, c.name)
    return map
  }, [customers])

  // 进行中：录音/转写/生成中的会议 + 生成任务队列
  const activeMeetings = useMemo(
    () => meetings.filter((m) => ACTIVE_MEETING_STATUSES.has(m.status)),
    [meetings]
  )

  // 会议标题映射（待确认待办分组取来源会议标题用）
  const meetingTitleMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of meetings) map.set(m.id, m.title)
    return map
  }, [meetings])

  // 待确认待办（confirmed=0 且未完成），按来源分组：meetingId 非空的取会议标题，
  // 否则取客户名并标注「手动/笔记」，两者皆无归入个人待办
  const pendingTodoGroups = useMemo(() => {
    interface PendingGroup {
      key: string
      label: string
      suffix: string | null
      items: VisitTodoRecord[]
    }
    const groups = new Map<string, PendingGroup>()
    for (const todo of todos) {
      if (todo.confirmed !== 0 || todo.done === 1 || todo.deleted === 1) continue
      const key = todo.meetingId
        ? `meeting:${todo.meetingId}`
        : todo.customerId
          ? `customer:${todo.customerId}`
          : 'personal'
      let group = groups.get(key)
      if (!group) {
        const label = todo.meetingId
          ? meetingTitleMap.get(todo.meetingId) || t('meetingUntitled')
          : customerNameMap.get(todo.customerId) || t('personalTodos')
        group = {
          key,
          label,
          suffix: todo.meetingId ? null : t('sourceManualNote'),
          items: [],
        }
        groups.set(key, group)
      }
      group.items.push(todo)
    }
    return [...groups.values()]
  }, [todos, meetingTitleMap, customerNameMap, t])

  // 卡片标题行的数量徽章：分组内条目总数
  const pendingTodoCount = useMemo(
    () => pendingTodoGroups.reduce((sum, g) => sum + g.items.length, 0),
    [pendingTodoGroups]
  )

  // 待归类：已有纪要但未关联客户的会议（全量口径，统计条用总数）。
  // 口径：store 已加载详情的看 summary 内容，未加载的看列表查询的 hasSummary 计算列（重启后也覆盖）
  const unclassifiedAll = useMemo(
    () =>
      meetings.filter(
        (m) =>
          !m.customerId &&
          (m.summary.trim().length > 0 || m.hasSummary === 1)
      ),
    [meetings]
  )

  // 卡片只展示最新 5 条
  const unclassifiedMeetings = useMemo(
    () => unclassifiedAll.slice(0, UNCLASSIFIED_MEETING_LIMIT),
    [unclassifiedAll]
  )

  // 待办摘要条统计：本周（含今天与逾期）未完成数与逾期数
  const { weekCount, overdueCount } = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const endOfWeek = startOfToday + 7 * 24 * 60 * 60 * 1000
    let week = 0
    let overdue = 0
    for (const todo of todos) {
      if (todo.done === 1 || todo.deleted === 1 || todo.dueDate === 0) continue
      if (todo.dueDate < endOfWeek) week += 1
      if (todo.dueDate < startOfToday) overdue += 1
    }
    return { weekCount: week, overdueCount: overdue }
  }, [todos])

  const jumpToCustomer = (customerId: string) => {
    void setLeftSidebarTab('customer')
    selectCustomer(customerId)
  }

  const jumpToMeeting = (meetingId: string) => {
    void setLeftSidebarTab('meeting')
    setActiveMeeting(meetingId)
  }

  // 统计条：点击平滑滚动到对应工作卡片
  const scrollToCard = (ref: RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 待确认待办：确认（乐观更新，条目即时从卡片消失）
  const handleConfirmTodo = (id: string) => {
    confirmTodo(id).catch((err) => {
      console.error('[Workbench] 确认待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 待确认待办：忽略（与待办面板一致，复用删除语义）
  const handleIgnoreTodo = (id: string) => {
    removeTodo(id).catch((err) => {
      console.error('[Workbench] 忽略待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 待归类会议：行内下拉选中客户即归类 —— 更新会议关联客户 + 建拜访记录 + 同步纪要到客户知识库 + toast
  const handleClassify = (meeting: Meeting, customerId: string) => {
    const customerName = customerNameMap.get(customerId) || ''
    updateMeeting(meeting.id, { customerId })
    // 归类即建拜访记录（进入拜访时间线并计入拜访次数；失败不影响归类）
    void ensureVisitForMeeting(meeting, customerId)
    void syncMeetingSummaryToCustomer({ ...meeting, customerId })
      .then((result) => {
        if (result.ok) {
          toast({ description: t('classifySuccess', { name: customerName }) })
          // 待办确认弹窗
          useTodoConfirmStore.getState().showFromSummary({
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            customerId,
            visitId: meeting.visitId || '',
            summary: meeting.summary,
          })
        }
      })
      .catch((err) => console.error('[Workbench] 归类同步失败:', err))
  }

  const meetingStatusLabel = (status: Meeting['status']) => {
    const keyMap: Record<Meeting['status'], string> = {
      idle: 'statusIdle',
      recording: 'statusRecording',
      paused: 'statusPaused',
      transcribing: 'statusTranscribing',
      generating: 'statusGenerating',
      completed: 'statusCompleted',
    }
    return tMeeting(keyMap[status])
  }

  const generateKindLabel = (kind: VisitGenerateKind) =>
    kind === 'previsit'
      ? t('kindPrevisit')
      : kind === 'financial'
        ? t('kindFinancial')
        : t('kindCredit')

  const inProgressCount = activeMeetings.length + generateTasks.length

  // 统计条：与四张工作卡片同源（待归类会议取全量总数，卡片内只展示最新 5 条）
  const stats = [
    {
      key: 'visits',
      icon: <CalendarClock />,
      label: t('statVisits'),
      value: upcomingVisits.length,
      unit: t('statUnitVisits'),
      tone: 'accent' as const,
      ref: upcomingCardRef,
    },
    {
      key: 'todos',
      icon: <ListTodo />,
      label: t('statTodos'),
      value: pendingTodoCount,
      unit: t('statUnitTodos'),
      tone: 'default' as const,
      ref: todosCardRef,
    },
    {
      key: 'unclassified',
      icon: <Mic />,
      label: t('statUnclassified'),
      value: unclassifiedAll.length,
      unit: t('statUnitUnclassified'),
      tone: 'warning' as const,
      ref: unclassifiedCardRef,
    },
    {
      key: 'inProgress',
      icon: <Zap />,
      label: t('statInProgress'),
      value: inProgressCount,
      unit: t('statUnitInProgress'),
      tone: 'default' as const,
      ref: inProgressCardRef,
    },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="paper-workbench-body relative mx-auto flex w-full max-w-[1040px] flex-col px-8 pb-10 pt-[26px]">
        {/* 右侧竖排标语「记录招行智慧」：默认 hidden，仅 paper 主题显示（原型 .w-vertical） */}
        <span className="paper-vertical-slogan hidden" aria-hidden="true">{t('verticalSlogan')}</span>

        {/* 页头（原型 .page-head）：纯文本标题 + 副标题，无 logo */}
        <div className="mb-5">
          <h1 className="paper-page-title text-lg font-semibold">{t('title')}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* 右栏收起时的待办摘要条：点击展开右栏待办面板 */}
        {!rightSidebarVisible && (
          <button
            onClick={() => void toggleRightSidebar()}
            className="mb-3 flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm transition-colors hover:bg-accent"
          >
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">
              {overdueCount > 0
                ? t('todoSummaryOverdue', { week: weekCount, overdue: overdueCount })
                : t('todoSummary', { week: weekCount })}
            </span>
            <span className="shrink-0 text-xs text-primary">{t('todoSummaryExpand')}</span>
          </button>
        )}

        {/* 顶部统计条（原型 .stat-band）：本周拜访 / 待办事项 / 待归类会议（警示色）/ 进行中 */}
        <div className="paper-stat-band mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <StatCard
              key={s.key}
              icon={s.icon}
              label={s.label}
              value={s.value}
              unit={s.unit}
              tone={s.tone}
              onClick={() => scrollToCard(s.ref)}
            />
          ))}
        </div>

        {/* 工作卡片区（原型 .ws-grid）：2x2 网格，窄屏单列 */}
        <div className="paper-ws-grid grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* 📅 近 7 天待拜访 */}
          <WorkbenchCard
            ref={upcomingCardRef}
            icon={<CalendarClock />}
            title={t('upcomingTitle')}
            count={upcomingVisits.length}
            emptyText={t('upcomingEmpty')}
          >
            {upcomingVisits.map((visit) => (
              <CardRow key={visit.id} onClick={() => jumpToCustomer(visit.customerId)}>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatVisitDate(visit.visitDate)}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="shrink-0 font-medium">
                    {visit.customerName || t('visitUntitled')}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {visit.title || t('visitUntitled')}
                  </span>
                </span>
                <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </CardRow>
            ))}
          </WorkbenchCard>

          {/* ⚡ 进行中 */}
          <WorkbenchCard
            ref={inProgressCardRef}
            icon={<Zap />}
            title={t('inProgressTitle')}
            count={inProgressCount}
            emptyText={t('inProgressEmpty')}
          >
            {activeMeetings.map((meeting) => (
              <CardRow key={meeting.id} onClick={() => jumpToMeeting(meeting.id)}>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {meeting.title || t('meetingUntitled')}
                </span>
                <span className="shrink-0 animate-pulse text-xs text-muted-foreground">
                  {meetingStatusLabel(meeting.status)}
                </span>
              </CardRow>
            ))}
            {generateTasks.map((task) => (
              <CardRow key={task.key} onClick={() => jumpToCustomer(task.customerId)}>
                <Loader2
                  className={
                    task.status === 'running'
                      ? 'h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground'
                      : 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  {customerNameMap.get(task.customerId) || ''} · {generateKindLabel(task.kind)}
                </span>
                <span className="shrink-0 animate-pulse text-xs text-muted-foreground">
                  {task.status === 'queued'
                    ? t('statusQueued')
                    : tMeeting('statusGenerating')}
                </span>
              </CardRow>
            ))}
          </WorkbenchCard>

          {/* ✅ 待确认待办：按来源会议/客户分组，行内 确认 / ✗忽略（处理后条目即时消失） */}
          <WorkbenchCard
            ref={todosCardRef}
            icon={<ListChecks />}
            title={t('pendingTodosTitle')}
            count={pendingTodoCount}
            emptyText={t('pendingTodosEmpty')}
          >
            {pendingTodoGroups.map((group) => (
              <div key={group.key} className="border-b last:border-b-0">
                <p className="truncate px-[18px] pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">
                  {group.label}
                  {group.suffix && <span className="font-normal"> · {group.suffix}</span>}
                </p>
                {group.items.map((todo) => {
                  const sourceText = todo.meetingId
                    ? meetingTitleMap.get(todo.meetingId) || t('meetingUntitled')
                    : todo.customerId
                      ? customerNameMap.get(todo.customerId) || ''
                      : ''
                  return (
                    <div
                      key={todo.id}
                      className="flex items-center gap-1.5 px-[18px] py-2 text-[13px] transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate">{todo.content}</span>
                      {sourceText && (
                        <button
                          onClick={() =>
                            todo.meetingId
                              ? jumpToMeeting(todo.meetingId)
                              : jumpToCustomer(todo.customerId)
                          }
                          className="max-w-24 shrink-0 truncate text-[11px] text-muted-foreground hover:text-primary hover:underline"
                        >
                          {sourceText}
                        </button>
                      )}
                      <button
                        onClick={() => handleConfirmTodo(todo.id)}
                        aria-label={tTodos('confirm')}
                        title={tTodos('confirm')}
                        className="shrink-0 rounded px-1 text-[13px] text-primary transition-colors hover:underline"
                      >
                        {tTodos('confirm')}
                      </button>
                      <button
                        onClick={() => handleIgnoreTodo(todo.id)}
                        aria-label={tTodos('ignore')}
                        title={tTodos('ignore')}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </WorkbenchCard>

          {/* 🎙 待归类会议：行内下拉选客户即归类（同步纪要到客户知识库），「打开」跳会议 Tab */}
          <WorkbenchCard
            ref={unclassifiedCardRef}
            icon={<Mic />}
            title={t('unclassifiedTitle')}
            count={unclassifiedAll.length}
            emptyText={t('unclassifiedEmpty')}
          >
            {unclassifiedMeetings.map((meeting) => (
              <div
                key={meeting.id}
                className="flex items-center gap-2.5 border-b px-[18px] py-2.5 text-[13px] transition-colors last:border-b-0 hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">
                  {meeting.title || t('meetingUntitled')}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatMeetingTime(meeting.createdAt)}
                </span>
                <Select onValueChange={(customerId) => handleClassify(meeting, customerId)}>
                  <SelectTrigger
                    className="h-[26px] w-[76px] shrink-0 gap-1 rounded-md px-2.5 text-xs"
                    aria-label={t('classify')}
                  >
                    <SelectValue placeholder={t('classify')} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => jumpToMeeting(meeting.id)}
                  className="shrink-0 text-[13px] text-primary hover:underline"
                >
                  {t('open')}
                </button>
              </div>
            ))}
          </WorkbenchCard>
        </div>
      </div>
    </ScrollArea>
  )
}
