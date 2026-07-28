'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { useCustomerStore } from '@/app/core/main/customer/customer-store'
import { useMeetingStore } from '@/app/core/main/meeting/meeting-store'
import { useSidebarStore } from '@/stores/sidebar'
import type { VisitTodoRecord } from '@/db/visit-todos'

// 新提取/新添加的待办短暂高亮的判定窗口（10 秒内创建视为新条目）
const NEW_HIGHLIGHT_WINDOW_MS = 10 * 1000
// 手动添加表单中「不关联客户」的 Select 占位值（Radix Select 不允许空串 value）
const NO_CUSTOMER_VALUE = '__none__'

type TodoGroupKey = 'overdue' | 'today' | 'thisWeek' | 'later'

interface GroupedTodos {
  overdue: VisitTodoRecord[]
  today: VisitTodoRecord[]
  thisWeek: VisitTodoRecord[]
  later: VisitTodoRecord[]
  completed: VisitTodoRecord[]
}

// 按 逾期/今天/本周/以后（无时限归入以后）/已完成 分组
function groupTodos(todos: VisitTodoRecord[]): GroupedTodos {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000
  const endOfWeek = startOfToday + 7 * 24 * 60 * 60 * 1000

  const grouped: GroupedTodos = { overdue: [], today: [], thisWeek: [], later: [], completed: [] }
  for (const todo of todos) {
    if (todo.done === 1) {
      grouped.completed.push(todo)
    } else if (todo.dueDate > 0 && todo.dueDate < startOfToday) {
      grouped.overdue.push(todo)
    } else if (todo.dueDate >= startOfToday && todo.dueDate < startOfTomorrow) {
      grouped.today.push(todo)
    } else if (todo.dueDate >= startOfTomorrow && todo.dueDate < endOfWeek) {
      grouped.thisWeek.push(todo)
    } else {
      // dueDate === 0（无时限）或更远的未来
      grouped.later.push(todo)
    }
  }
  return grouped
}

// 时限的紧凑展示：M/d（无时限返回 null 由调用方跳过）
function formatDueDate(dueDate: number): string | null {
  if (!dueDate) return null
  const d = new Date(dueDate)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function TodoPanel() {
  const t = useTranslations('todos')
  const todos = useVisitTodosStore((s) => s.todos)
  const newTodoCount = useVisitTodosStore((s) => s.newTodoCount)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)
  const toggleDone = useVisitTodosStore((s) => s.toggleDone)
  const confirmTodo = useVisitTodosStore((s) => s.confirmTodo)
  const addManualTodo = useVisitTodosStore((s) => s.addManualTodo)
  const removeTodo = useVisitTodosStore((s) => s.removeTodo)
  const markTodosSeen = useVisitTodosStore((s) => s.markTodosSeen)

  const customers = useCustomerStore((s) => s.customers)
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const selectCustomer = useCustomerStore((s) => s.selectCustomer)
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting)
  const setLeftSidebarTab = useSidebarStore((s) => s.setLeftSidebarTab)

  const [draft, setDraft] = useState('')
  const [draftCustomerId, setDraftCustomerId] = useState(NO_CUSTOMER_VALUE)
  const [submitting, setSubmitting] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  useEffect(() => {
    if (!customersInitialized) void loadCustomers()
  }, [customersInitialized, loadCustomers])

  // 面板可见期间（含新待办到达时）即视为已读，清掉客户 Tab 角标
  useEffect(() => {
    markTodosSeen()
  }, [newTodoCount, markTodosSeen])

  const customerNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of customers) map.set(c.id, c.name)
    return map
  }, [customers])

  // 待确认分组：AI 提取未确认（confirmed=0）且未完成的待办，确认后才进入正式分组
  const pendingConfirmTodos = useMemo(
    () => todos.filter((todo) => todo.confirmed === 0 && todo.done === 0),
    [todos]
  )
  // 正式分组只统计已确认（confirmed=1）的待办
  const grouped = useMemo(
    () => groupTodos(todos.filter((todo) => todo.confirmed === 1)),
    [todos]
  )
  const hasPending =
    grouped.overdue.length + grouped.today.length + grouped.thisWeek.length + grouped.later.length > 0

  // 跳客户详情：切客户 Tab + 选中客户
  const handleJumpCustomer = (customerId: string) => {
    void setLeftSidebarTab('customer')
    selectCustomer(customerId)
  }

  // 跳来源会议：切会议 Tab + 打开对应会议
  const handleJumpMeeting = (meetingId: string) => {
    void setLeftSidebarTab('meeting')
    setActiveMeeting(meetingId)
  }

  const handleToggle = (id: string) => {
    toggleDone(id).catch((err) => {
      console.error('[TodoPanel] 切换待办状态失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  const handleRemove = (id: string) => {
    removeTodo(id).catch((err) => {
      console.error('[TodoPanel] 删除待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 待确认分组：确认（进入正式分组）
  const handleConfirm = (id: string) => {
    confirmTodo(id).catch((err) => {
      console.error('[TodoPanel] 确认待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  const handleAdd = () => {
    const content = draft.trim()
    if (!content || submitting) return
    setSubmitting(true)
    addManualTodo({
      content,
      customerId: draftCustomerId === NO_CUSTOMER_VALUE ? undefined : draftCustomerId,
    })
      .then(() => setDraft(''))
      .catch((err) => {
        console.error('[TodoPanel] 添加待办失败:', err)
        toast({ description: String(err), variant: 'destructive' })
      })
      .finally(() => setSubmitting(false))
  }

  const renderItem = (todo: VisitTodoRecord, group: TodoGroupKey | 'completed') => {
    const isNew = Date.now() - todo.createdAt < NEW_HIGHLIGHT_WINDOW_MS
    const isDone = todo.done === 1
    const customerName = todo.customerId ? customerNameMap.get(todo.customerId) : undefined
    const dueText = formatDueDate(todo.dueDate)
    // 次行元信息段：客户名（可点）· 负责人 · 时限 · 来源纪要（可点），有内容的段用「·」串联
    const metaSegments: ReactNode[] = []
    if (customerName) {
      metaSegments.push(
        <button
          key="customer"
          className="hover:text-primary hover:underline"
          onClick={() => handleJumpCustomer(todo.customerId)}
        >
          {customerName}
        </button>
      )
    }
    if (todo.owner) {
      metaSegments.push(<span key="owner">{t('ownerLabel')} {todo.owner}</span>)
    }
    if (dueText) {
      metaSegments.push(
        <span
          key="due"
          className={cn(group === 'overdue' && !isDone && 'text-danger')}
        >
          {t('dueLabel')} {dueText}
        </span>
      )
    }
    if (todo.meetingId) {
      metaSegments.push(
        <button
          key="meeting"
          className="hover:text-primary hover:underline"
          onClick={() => handleJumpMeeting(todo.meetingId)}
        >
          {t('fromMeeting')}
        </button>
      )
    }
    return (
      <div
        key={todo.id}
        className={cn(
          'group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60',
          isNew && 'todo-new-highlight'
        )}
      >
        <Checkbox
          checked={isDone}
          onCheckedChange={() => handleToggle(todo.id)}
          aria-label={isDone ? t('undoDone') : t('markDone')}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm leading-snug break-words',
              isDone && 'text-muted-foreground line-through',
              group === 'overdue' && !isDone && 'text-danger'
            )}
          >
            {todo.content}
          </p>
          {metaSegments.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              {metaSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span>·</span>}
                  {seg}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => handleRemove(todo.id)}
          aria-label={t('deleteTodo')}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // 待确认条目：内容 + 来源（客户名/纪要链接）+ ✓确认 / ✗忽略 两个行内按钮
  const renderPendingItem = (todo: VisitTodoRecord) => {
    const customerName = todo.customerId ? customerNameMap.get(todo.customerId) : undefined
    const sourceSegments: ReactNode[] = []
    if (customerName) {
      sourceSegments.push(
        <button
          key="customer"
          className="hover:text-primary hover:underline"
          onClick={() => handleJumpCustomer(todo.customerId)}
        >
          {customerName}
        </button>
      )
    }
    if (todo.meetingId) {
      sourceSegments.push(
        <button
          key="meeting"
          className="hover:text-primary hover:underline"
          onClick={() => handleJumpMeeting(todo.meetingId)}
        >
          {t('fromMeeting')}
        </button>
      )
    }
    return (
      <div
        key={todo.id}
        className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug break-words">{todo.content}</p>
          {sourceSegments.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              {sourceSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span>·</span>}
                  {seg}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-0.5 flex shrink-0 items-center gap-1">
          <button
            onClick={() => handleConfirm(todo.id)}
            className="flex items-center gap-0.5 rounded border border-warning/40 px-1.5 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10 dark:border-warning dark:text-warning"
          >
            <Check className="h-3 w-3" />
            {t('confirm')}
          </button>
          <button
            onClick={() => handleRemove(todo.id)}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
            {t('ignore')}
          </button>
        </div>
      </div>
    )
  }

  // 待确认分组（橙色主题，标题带数量徽章；无待确认事项时不渲染）
  const renderPendingGroup = () => {
    if (pendingConfirmTodos.length === 0) return null
    return (
      <div className="mb-2">
        {/* 与正式分组标题保持同一粘性定位模式 */}
        <div className="sticky top-0 z-10 -mx-2 flex items-center gap-1.5 bg-background/95 px-4 pb-1 pt-1 text-xs font-medium text-warning/90 backdrop-blur-sm dark:text-warning/90">
          {t('pendingConfirm')}
          <span className="rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold text-warning">
            {pendingConfirmTodos.length}
          </span>
        </div>
        {pendingConfirmTodos.map(renderPendingItem)}
      </div>
    )
  }

  const renderGroup = (key: TodoGroupKey, items: VisitTodoRecord[]) => {
    if (items.length === 0) return null
    return (
      <div key={key} className="mb-2">
        {/* 分组标题粘性定位：长列表滚动时保持当前分组可见（负边距让底色铺满两侧留白） */}
        <div
          className={cn(
            'sticky top-0 z-10 -mx-2 bg-background/95 px-4 pb-1 pt-1 text-xs font-medium backdrop-blur-sm',
            key === 'overdue' ? 'text-danger/80' : 'text-muted-foreground'
          )}
        >
          {t(key)} <span className="font-normal">{items.length}</span>
        </div>
        {items.map((todo) => renderItem(todo, key))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 新条目高亮动画：3 秒内由主色淡底过渡到透明 */}
      <style>{`@keyframes todo-new-highlight-kf { 0% { background-color: color-mix(in srgb, var(--primary) 22%, transparent); } 100% { background-color: transparent; } } .todo-new-highlight { animation: todo-new-highlight-kf 3s ease-out forwards; }`}</style>

      <div className="flex h-10 shrink-0 items-center border-b px-3">
        <h2 className="text-sm font-semibold">{t('todoPanel')}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {!hasPending && grouped.completed.length === 0 && pendingConfirmTodos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <p className="text-base font-medium">{t('noTodos')}</p>
              <p className="text-xs text-muted-foreground">{t('noTodosDesc')}</p>
            </div>
          ) : (
            <>
              {renderPendingGroup()}
              {!hasPending && pendingConfirmTodos.length === 0 && (
                <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                  <p className="text-sm font-medium">{t('noTodos')}</p>
                  <p className="text-xs text-muted-foreground">{t('noTodosDesc')}</p>
                </div>
              )}
              {renderGroup('overdue', grouped.overdue)}
              {renderGroup('today', grouped.today)}
              {renderGroup('thisWeek', grouped.thisWeek)}
              {renderGroup('later', grouped.later)}

              {grouped.completed.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="flex w-full items-center gap-1 px-2 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {showCompleted
                      ? t('hideCompleted')
                      : t('showCompleted', { count: grouped.completed.length })}
                  </button>
                  {showCompleted && grouped.completed.map((todo) => renderItem(todo, 'completed'))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* 底部手动添加：内容 + 可选客户关联（允许纯个人待办） */}
      <div className="shrink-0 space-y-2 border-t p-2">
        <Select value={draftCustomerId} onValueChange={setDraftCustomerId}>
          <SelectTrigger className="h-8 text-xs" aria-label={t('linkCustomer')}>
            <SelectValue placeholder={t('noCustomer')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CUSTOMER_VALUE}>{t('noCustomer')}</SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAdd()
            }}
            placeholder={t('addPlaceholder')}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            disabled={!draft.trim() || submitting}
            onClick={handleAdd}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('add')}
          </Button>
        </div>
      </div>
    </div>
  )
}
