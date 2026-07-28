'use client'

import { useEffect } from 'react'
import { useCustomerStore } from './customer-store'
import { VisitTimeline } from './visit-timeline'
import { CustomerKnowledge } from './customer-knowledge'
import { CustomerReportsSection } from './customer-reports-section'
import { CustomerWorkbench } from './customer-workbench'
import { CustomerTasksStrip } from './customer-tasks-strip'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Building2, CalendarDays, ChevronLeft, ListTodo, User, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'

/** 本地日期 YYYY-MM-DD（档案卡"最近拜访"展示用） */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function CustomerPanel() {
  const t = useTranslations('customer')
  const customer = useCustomerStore((s) =>
    s.customers.find((c) => c.id === s.currentCustomerId)
  )
  const selectCustomer = useCustomerStore((s) => s.selectCustomer)
  // B2 档案卡统计：拜访列表（store 中即当前客户的拜访）与未完成待办
  const visits = useCustomerStore((s) => s.visits)
  const todos = useVisitTodosStore((s) => s.todos)
  const todosInitialized = useVisitTodosStore((s) => s.initialized)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)

  // 待办未加载时补加载（未完成待办数统计需要）
  useEffect(() => {
    if (!todosInitialized) void loadTodos()
  }, [todosInitialized, loadTodos])

  // 未选客户时显示工作台（近 7 天待拜访 / 进行中 / 未处理会议三卡片）
  if (!customer) {
    return <CustomerWorkbench />
  }

  // B2 三统计：最近拜访日期 / 拜访次数 / 未完成待办数
  const lastVisitDate = visits.reduce(
    (max, v) => (v.visitDate > max ? v.visitDate : max),
    0
  )
  // 未完成待办数只统计已确认（confirmed=1）的；待确认（confirmed=0）的 AI 提取待办不计入
  const openTodoCount = todos.filter(
    (todo) =>
      todo.customerId === customer.id && todo.done === 0 && todo.confirmed === 1
  ).length

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {/* A1 任务中心：进行中的任务横条（仅当前客户有生成任务时渲染） */}
        <CustomerTasksStrip customerId={customer.id} />

        {/* 客户档案卡：返回工作台 + 图标锚点 + 名称 + 类型徽章 + 行业 + chip 化三统计（B2） */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            {/* 返回工作台（未选中客户的落地页） */}
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 -ml-1 shrink-0"
              title={t('backToWorkbench')}
              onClick={() => selectCustomer(null)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {customer.type === 'individual' ? (
                <User className="w-4 h-4" />
              ) : (
                <Building2 className="w-4 h-4" />
              )}
            </span>
            <h2 className="text-lg font-semibold truncate">{customer.name}</h2>
            <Badge variant="secondary" className="shrink-0 font-normal">
              {customer.type === 'individual'
                ? t('typeIndividual')
                : t('typeEnterprise')}
            </Badge>
          </div>
          {customer.industry && (
            <p className="text-sm text-muted-foreground mt-1.5">
              {customer.industry}
            </p>
          )}
          {/* B2 统计 chips：最近拜访 / 拜访次数 / 未完成待办（圆角小徽章带图标） */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              {lastVisitDate > 0
                ? t('statsLastVisit', { date: formatDate(lastVisitDate) })
                : t('statsNoVisit')}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {t('statsVisitCount', { count: visits.length })}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <ListTodo className="w-3.5 h-3.5" />
              {t('statsOpenTodos', { count: openTodoCount })}
            </span>
          </div>
        </div>

        {/* 客户报告：财报分析/审贷会材料生成（客户级）+ 访后目录报告列表 */}
        <CustomerReportsSection customer={customer} />

        {/* 拜访时间线（含每个拜访的访前/访中/访后三阶段区块） */}
        <VisitTimeline customer={customer} />

        {/* 客户知识库：文件列表 / 上传资料 / 索引管理 / 范围检索提问 */}
        <CustomerKnowledge customer={customer} />
      </div>
    </ScrollArea>
  )
}
