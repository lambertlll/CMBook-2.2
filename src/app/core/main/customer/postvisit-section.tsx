'use client'

import { useEffect, useMemo, useState } from 'react'
import type { VisitRecord } from '@/db/visits'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ListTodo, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// 新待办高亮窗口：纪要提取出新待办后 30 秒内显示"新"徽标 + 区块高亮，之后自动消退
const NEW_TODO_HIGHLIGHT_MS = 30 * 1000

/** 时限的紧凑展示：M/d（无时限返回 null 由调用方跳过，与待办面板一致） */
function formatDueDate(dueDate: number): string | null {
  if (!dueDate) return null
  const d = new Date(dueDate)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 拜访卡片的"访后"区块（拜访级待办清单）：
 * - 列出该拜访的待办（拜访纪要生成后自动提取入库；store 排序即未完成在前、已完成在后）
 * - checkbox 勾选切换完成态；有值时显示负责人/时限（逾期未完成标红）
 * - A5 高亮：有新待办出现（最新待办创建时间处于高亮窗口内）时显示"新"徽标 + 区块高亮
 * 报告生成（财报分析/审贷会材料）已提升到客户级，见 customer-reports-section.tsx
 */
export function PostvisitSection({ visit }: { visit: VisitRecord }) {
  const t = useTranslations('customer')
  const tTodos = useTranslations('todos')
  const todos = useVisitTodosStore((s) => s.todos)
  const todosInitialized = useVisitTodosStore((s) => s.initialized)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)
  const toggleDone = useVisitTodosStore((s) => s.toggleDone)
  const confirmTodo = useVisitTodosStore((s) => s.confirmTodo)
  const removeTodo = useVisitTodosStore((s) => s.removeTodo)
  // 高亮窗口结束时强制重渲染以消退"新"徽标
  const [, forceRender] = useState(0)

  // 待办未加载时补加载（customer-panel 也会触发，这里兜底）
  useEffect(() => {
    if (!todosInitialized) void loadTodos()
  }, [todosInitialized, loadTodos])

  // 本拜访的待办（store 已排序：未完成在前 → 时限近者优先 → 新创建优先）
  const visitTodos = useMemo(
    () => todos.filter((todo) => todo.visitId === visit.id),
    [todos, visit.id]
  )

  // A5 高亮：最新待办创建时间处于窗口内视为"有新待办"（纪要生成提取出新待办即触发）
  const latestCreatedAt = visitTodos.reduce(
    (max, todo) => Math.max(max, todo.createdAt),
    0
  )
  const hasNewTodo =
    latestCreatedAt > 0 && Date.now() - latestCreatedAt < NEW_TODO_HIGHLIGHT_MS
  useEffect(() => {
    if (!hasNewTodo) return
    const remain = latestCreatedAt + NEW_TODO_HIGHLIGHT_MS - Date.now()
    const timer = setTimeout(() => forceRender((n) => n + 1), Math.max(remain, 0))
    return () => clearTimeout(timer)
  }, [hasNewTodo, latestCreatedAt])

  const handleToggle = (id: string) => {
    toggleDone(id).catch((err) => {
      console.error('[PostvisitSection] 切换待办状态失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 待确认条目（confirmed=0）：确认后转入正常待办样式
  const handleConfirm = (id: string) => {
    confirmTodo(id).catch((err) => {
      console.error('[PostvisitSection] 确认待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 待确认条目：忽略（复用删除语义，与待办面板一致）
  const handleIgnore = (id: string) => {
    removeTodo(id).catch((err) => {
      console.error('[PostvisitSection] 忽略待办失败:', err)
      toast({ description: String(err), variant: 'destructive' })
    })
  }

  // 逾期判定用（今天 0 点之前且未完成视为逾期）
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime()

  return (
    <div
      className={
        hasNewTodo
          ? 'rounded border border-primary/50 bg-card p-2 ring-1 ring-primary/30'
          : 'rounded border bg-card p-2'
      }
    >
      <div className="flex items-center gap-1.5">
        <ListTodo className="w-3.5 h-3.5 text-primary" />
        <span className="text-sm font-medium">{t('stagePostTitle')}</span>
        {hasNewTodo && (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
            {t('newBadge')}
          </Badge>
        )}
      </div>

      {/* 拜访级待办清单（未完成在前；已完成划线弱化，checkbox 可勾回） */}
      {visitTodos.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-1">
          {t('postvisitTodoEmptyCoach')}
        </p>
      ) : (
        <div className="flex flex-col mt-1">
          {visitTodos.map((todo) => {
            const isDone = todo.done === 1
            // 待确认（AI 提取未确认）：条目内容前显示「待确认」徽章，并附确认/忽略按钮，确认后转正常样式
            const isPendingConfirm = !isDone && todo.confirmed === 0
            const dueText = formatDueDate(todo.dueDate)
            const overdue =
              !isDone && todo.dueDate > 0 && todo.dueDate < startOfToday
            // 次行元信息：负责人 · 时限（有值时展示）
            const metaSegments = [
              todo.owner ? `${tTodos('ownerLabel')} ${todo.owner}` : null,
              dueText ? `${tTodos('dueLabel')} ${dueText}` : null,
            ].filter(Boolean)
            return (
              <div
                key={todo.id}
                className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-accent"
              >
                <Checkbox
                  checked={isDone}
                  onCheckedChange={() => handleToggle(todo.id)}
                  aria-label={isDone ? tTodos('undoDone') : tTodos('markDone')}
                  className="mt-0.5 shrink-0"
                />
                {isPendingConfirm && (
                  <>
                    <button
                      onClick={() => handleConfirm(todo.id)}
                      className="mt-0.5 flex h-5 shrink-0 items-center rounded border border-warning/40 px-1.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10 dark:border-warning dark:text-warning"
                    >
                      {tTodos('confirm')}
                    </button>
                    <button
                      onClick={() => handleIgnore(todo.id)}
                      aria-label={tTodos('ignore')}
                      className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-sm leading-snug break-words',
                      isDone && 'text-muted-foreground line-through',
                      overdue && 'text-danger'
                    )}
                  >
                    {isPendingConfirm && (
                      <Badge
                        variant="outline"
                        className="mr-1 border-warning/40 px-1 py-0 align-middle text-[10px] font-normal text-warning dark:border-warning dark:text-warning"
                      >
                        {tTodos('pendingConfirm')}
                      </Badge>
                    )}
                    {todo.content}
                  </div>
                  {metaSegments.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {metaSegments.join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
