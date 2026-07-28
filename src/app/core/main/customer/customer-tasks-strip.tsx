'use client'

import { Loader2, Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  useVisitGenerateStore,
  type VisitGenerateKind,
} from './visit-generate-manager'

/** 生成类型的展示文案（任务横条用，键与 visit-generate-manager 的会话命名一致） */
function kindLabelKey(kind: VisitGenerateKind): string {
  return kind === 'previsit'
    ? 'taskKindPrevisit'
    : kind === 'financial'
      ? 'taskKindFinancial'
      : 'taskKindCredit'
}

/**
 * A1 任务中心：客户工作区顶部的"进行中的任务"横条。
 * 消费模块级 useVisitGenerateStore，仅展示当前客户的 running/queued 任务；
 * 无任务时不渲染。
 */
export function CustomerTasksStrip({ customerId }: { customerId: string }) {
  const t = useTranslations('customer')
  // 订阅整个 tasks 数组（引用稳定，仅在 setState 时变化），渲染期按客户过滤
  const tasks = useVisitGenerateStore((s) => s.tasks)
  const customerTasks = tasks.filter((task) => task.customerId === customerId)

  if (customerTasks.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <Zap className="w-4 h-4 shrink-0 text-primary" />
      <span className="text-sm font-medium shrink-0">{t('taskStripTitle')}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {customerTasks.map((task) => (
          <span
            key={task.key}
            className="flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs"
          >
            {task.status === 'running' ? (
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
            ) : (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-warning" />
              </span>
            )}
            <span className="truncate">{t(kindLabelKey(task.kind))}</span>
            <span className="shrink-0 text-muted-foreground">
              {task.status === 'running' ? t('taskRunning') : t('taskQueued')}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
