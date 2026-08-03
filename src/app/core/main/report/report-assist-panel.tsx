'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Sparkles, Copy, FileDown, Loader2, Users, CalendarCheck,
  ListTodo, CheckCircle2, AlertTriangle, TrendingUp, FileType,
} from 'lucide-react'
import { useReportStore, formatWeekLabel } from './report-store'
import { generateWeeklyReport } from './report-generator'
import { copyReportToClipboard, saveReportAsNote, exportReportToWord } from './report-exporter'
import useSettingStore from '@/stores/setting'
import useChatStore from '@/stores/chat'
import { cn } from '@/lib/utils'
import Chat from '../chat'

/**
 * 周报右栏面板：默认显示「周报助手」（统计概览 + AI 一键生成 + 导出操作），
 * 可切换到「AI 对话」——选中周报后像笔记/会议一样，内容自动关联到对话中。
 */
export function ReportAssistPanel() {
  const t = useTranslations('report')
  const [tab, setTab] = useState<'assist' | 'chat'>('assist')
  const editorSelectionQuote = useChatStore((s) => s.editorSelectionQuote)

  // 选中周报文字 → 自动切到 AI 对话 tab（与笔记体验一致：选中即见引用卡片）
  const prevQuoteRef = useRef(editorSelectionQuote)
  useEffect(() => {
    if (editorSelectionQuote && prevQuoteRef.current !== editorSelectionQuote) {
      setTab('chat')
    }
    prevQuoteRef.current = editorSelectionQuote
  }, [editorSelectionQuote])

  return (
    <div className="flex h-full flex-col">
      {/* 面板切换：周报助手 / AI 对话 */}
      <div className="flex justify-center border-b p-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'assist' | 'chat')}>
          <TabsList className="h-8">
            <TabsTrigger value="assist" className="text-xs px-3">
              {t('assistTitle')}
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs px-3">
              {t('tabChat')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'assist' ? <ReportAssistContent /> : <Chat />}
      </div>
    </div>
  )
}

/**
 * 周报助手内容：周数据统计概览 + AI 一键生成 + 导出操作。
 */
function ReportAssistContent() {
  const t = useTranslations('report')
  const currentReport = useReportStore((s) => s.currentReport)
  const weekData = useReportStore((s) => s.weekData)
  const currentWeekStart = useReportStore((s) => s.currentWeekStart)
  const generating = useReportStore((s) => s.generating)
  const setGenerating = useReportStore((s) => s.setGenerating)
  const setStreamingContent = useReportStore((s) => s.setStreamingContent)
  const markGenerated = useReportStore((s) => s.markGenerated)

  const [copied, setCopied] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [exportedWord, setExportedWord] = useState(false)

  // 自定义模板
  const customReportTemplates = useSettingStore((s) => s.customReportTemplates)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  // AI 一键生成
  const handleGenerate = async () => {
    if (!weekData || generating) return
    setGenerating(true)
    setStreamingContent('')
    try {
      // 获取选中的自定义模板 prompt
      const customTpl = customReportTemplates.find(t => t.id === selectedTemplateId)
      const full = await generateWeeklyReport(weekData, currentWeekStart, (chunk) => {
        const current = useReportStore.getState().streamingContent
        setStreamingContent(current + chunk)
      }, customTpl?.prompt)
      await markGenerated(full)
    } catch (err) {
      console.error('[ReportAssistPanel] AI 生成失败:', err)
      setGenerating(false)
      setStreamingContent('')
      alert(err instanceof Error ? err.message : t('generateFailed'))
    }
  }

  // 复制到剪贴板
  const handleCopy = async () => {
    const content = currentReport?.content || ''
    if (!content) return
    try {
      await copyReportToClipboard(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[ReportAssistPanel] 复制失败:', err)
    }
  }

  // 另存为笔记
  const handleSaveAsNote = async () => {
    const content = currentReport?.content || ''
    if (!content) return
    try {
      await saveReportAsNote(content, currentWeekStart)
      setSavedNote(true)
      setTimeout(() => setSavedNote(false), 1500)
    } catch (err) {
      console.error('[ReportAssistPanel] 另存为笔记失败:', err)
      alert(t('saveNoteFailed'))
    }
  }

  // 导出为 Word
  const handleExportWord = async () => {
    const content = currentReport?.content || ''
    if (!content) return
    try {
      await exportReportToWord(content, currentWeekStart)
      setExportedWord(true)
      setTimeout(() => setExportedWord(false), 1500)
    } catch (err) {
      console.error('[ReportAssistPanel] 导出Word失败:', err)
      alert(t('exportWordFailed'))
    }
  }

  if (!currentReport) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('selectWeek')}</p>
      </div>
    )
  }

  const stats = weekData?.stats
  const completionPct = stats ? Math.round(stats.completionRate * 100) : 0

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* 头部 */}
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <span className="text-xs font-medium text-foreground">{t('assistTitle')}</span>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            {/* 周信息 */}
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-sm font-medium text-foreground">
                {formatWeekLabel(currentWeekStart)}
              </div>
            </div>

            {/* 统计概览 */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                icon={CalendarCheck}
                label={t('statVisits')}
                value={stats?.visitCount ?? 0}
              />
              <StatCard
                icon={Users}
                label={t('statCustomers')}
                value={stats?.customerCount ?? 0}
              />
              <StatCard
                icon={CheckCircle2}
                label={t('statCompleted')}
                value={stats?.todoCompleted ?? 0}
              />
              <StatCard
                icon={AlertTriangle}
                label={t('statOverdue')}
                value={stats?.overdueCount ?? 0}
                highlight={!!stats && stats.overdueCount > 0}
              />
            </div>

            {/* 完成率 */}
            {stats && (
              <div className="rounded-lg border px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="size-3" />
                    {t('completionRate')}
                  </span>
                  <span className="text-xs font-medium text-foreground">{completionPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ListTodo className="size-3" />
                  {t('todoSummary', {
                    completed: stats.todoCompleted,
                    total: stats.todoTotal,
                  })}
                </div>
              </div>
            )}

            {/* 自定义模板选择 */}
            {customReportTemplates.length > 0 && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t('template')}</label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={t('defaultTemplate')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('defaultTemplate')}</SelectItem>
                    {customReportTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* AI 生成按钮 */}
            <Button
              className="w-full"
              onClick={() => void handleGenerate()}
              disabled={generating || !weekData}
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('generating')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  {t('aiGenerate')}
                </>
              )}
            </Button>

            {/* 导出操作 */}
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => void handleCopy()}
                    disabled={!currentReport.content || generating}
                  >
                    {copied ? (
                      <CheckCircle2 className="mr-1.5 size-3.5 text-green-600" />
                    ) : (
                      <Copy className="mr-1.5 size-3.5" />
                    )}
                    {copied ? t('copied') : t('copy')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('copyTip')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => void handleSaveAsNote()}
                    disabled={!currentReport.content || generating}
                  >
                    {savedNote ? (
                      <CheckCircle2 className="mr-1.5 size-3.5 text-green-600" />
                    ) : (
                      <FileDown className="mr-1.5 size-3.5" />
                    )}
                    {savedNote ? t('savedNote') : t('saveAsNote')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('saveAsNoteTip')}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* 导出 Word */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void handleExportWord()}
                  disabled={!currentReport.content || generating}
                >
                  {exportedWord ? (
                    <CheckCircle2 className="mr-1.5 size-3.5 text-green-600" />
                  ) : (
                    <FileType className="mr-1.5 size-3.5" />
                  )}
                  {exportedWord ? t('exported') : t('exportWord')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{t('exportWordTip')}</p>
              </TooltipContent>
            </Tooltip>

            {/* 数据预览：本周拜访列表 */}
            {weekData && weekData.visits.length > 0 && (
              <div className="rounded-lg border px-3 py-2">
                <div className="mb-1.5 text-xs font-medium text-foreground">
                  {t('weekVisits')}
                </div>
                <div className="flex flex-col gap-1">
                  {weekData.visits.slice(0, 8).map((v, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="shrink-0 font-mono">
                        {new Date(v.visitDate).getMonth() + 1}.{new Date(v.visitDate).getDate()}
                      </span>
                      <span className="truncate">{v.customerName}</span>
                    </div>
                  ))}
                  {weekData.visits.length > 8 && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('moreCount', { count: weekData.visits.length - 8 })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 数据预览：下周待办 */}
            {weekData && weekData.nextWeekTodos.length > 0 && (
              <div className="rounded-lg border px-3 py-2">
                <div className="mb-1.5 text-xs font-medium text-foreground">
                  {t('nextWeekTodos')}
                </div>
                <div className="flex flex-col gap-1">
                  {weekData.nextWeekTodos.slice(0, 6).map((todo) => (
                    <div key={todo.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-1 shrink-0 rounded-full bg-primary" />
                      <span className="truncate">{todo.content}</span>
                      {todo.dueDate > 0 && (
                        <span className="ml-auto shrink-0 font-mono">
                          {new Date(todo.dueDate).getMonth() + 1}.{new Date(todo.dueDate).getDate()}
                        </span>
                      )}
                    </div>
                  ))}
                  {weekData.nextWeekTodos.length > 6 && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('moreCount', { count: weekData.nextWeekTodos.length - 6 })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  )
}

/** 统计小卡片 */
function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Users
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div className={cn(
      'rounded-lg border px-2.5 py-2',
      highlight && 'border-destructive/30 bg-destructive/5'
    )}>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={cn(
        'mt-0.5 text-lg font-semibold',
        highlight ? 'text-destructive' : 'text-foreground'
      )}>
        {value}
      </div>
    </div>
  )
}
