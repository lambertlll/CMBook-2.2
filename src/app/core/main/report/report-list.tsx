'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { useReportStore, formatWeekRange, formatWeekLabel } from './report-store'
import { getCurrentWeekStart, getWeekStartOffset } from '@/db/weekly-reports'
import { cn } from '@/lib/utils'

/**
 * 周报列表（左栏）：显示最近 12 周的周报，支持前后周导航 + 本周按钮。
 * 每条显示周标识 + 日期范围 + AI 生成标记。
 */
export function ReportList() {
  const t = useTranslations('report')
  const reports = useReportStore((s) => s.reports)
  const currentWeekStart = useReportStore((s) => s.currentWeekStart)
  const loadReports = useReportStore((s) => s.loadReports)
  const selectWeek = useReportStore((s) => s.selectWeek)
  const goToPrevWeek = useReportStore((s) => s.goToPrevWeek)
  const goToNextWeek = useReportStore((s) => s.goToNextWeek)
  const goToCurrentWeek = useReportStore((s) => s.goToCurrentWeek)

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  // 生成最近 12 周的 weekStart 列表（从本周往前）
  const weekStarts: number[] = []
  const thisWeek = getCurrentWeekStart()
  for (let i = 0; i < 12; i++) {
    weekStarts.push(getWeekStartOffset(thisWeek, -i))
  }

  // 已有周报的 weekStart → report 映射
  const reportMap = new Map(reports.map((r) => [r.weekStart, r]))

  const isCurrentWeek = currentWeekStart === thisWeek
  const isFutureWeek = currentWeekStart > thisWeek

  return (
    <div className="flex h-full w-full flex-col">
      {/* 头部：周导航 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-2">
        <span className="text-xs font-medium text-foreground">{t('title')}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => void goToPrevWeek()}
            title={t('prevWeek')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          {!isCurrentWeek && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void goToCurrentWeek()}
              title={t('currentWeek')}
            >
              <CalendarDays className="mr-1 size-3.5" />
              {t('thisWeek')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => void goToNextWeek()}
            disabled={isFutureWeek}
            title={t('nextWeek')}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* 当前周信息条 */}
      <div className="shrink-0 border-b bg-muted/40 px-3 py-2">
        <div className="text-sm font-medium text-foreground">
          {formatWeekLabel(currentWeekStart)}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatWeekRange(currentWeekStart)}
          {isCurrentWeek && ` · ${t('thisWeek')}`}
        </div>
      </div>

      {/* 周报列表 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {weekStarts.map((ws) => {
            const report = reportMap.get(ws)
            const isActive = ws === currentWeekStart
            const hasContent = report && report.content.length > 0
            const isAi = report && report.aiGenerated === 1
            return (
              <button
                key={ws}
                onClick={() => void selectWeek(ws)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted text-foreground'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">
                      {formatWeekLabel(ws)}
                    </span>
                    {isAi && (
                      <span className="shrink-0 rounded bg-primary/12 px-1 py-px text-[9px] font-medium text-primary">
                        AI
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatWeekRange(ws)}
                    {hasContent ? ` · ${t('hasContent')}` : ` · ${t('empty')}`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
