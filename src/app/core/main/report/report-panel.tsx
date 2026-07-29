'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Save, Check, PenLine, Eye } from 'lucide-react'
import { useReportStore, formatWeekRange, formatWeekLabel } from './report-store'

// 延迟初始化 markdown-it（仅预览模式时加载）
let mdRenderer: ((markdown: string) => string) | null = null
async function getMarkdownRenderer() {
  if (mdRenderer) return mdRenderer
  const MarkdownIt = (await import('markdown-it')).default
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
  mdRenderer = (text: string) => md.render(text)
  return mdRenderer
}

/**
 * 周报中间面板：编辑 / 预览 Markdown 周报正文。
 * AI 生成中时自动切换到预览模式展示流式内容。
 */
export function ReportPanel() {
  const t = useTranslations('report')
  const currentReport = useReportStore((s) => s.currentReport)
  const currentWeekStart = useReportStore((s) => s.currentWeekStart)
  const generating = useReportStore((s) => s.generating)
  const streamingContent = useReportStore((s) => s.streamingContent)
  const saveContent = useReportStore((s) => s.saveContent)

  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [localContent, setLocalContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [htmlContent, setHtmlContent] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同步 store 内容到本地编辑状态（切换周报时）
  useEffect(() => {
    const content = currentReport?.content || ''
    setLocalContent(content)
    setDirty(false)
  }, [currentReport?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // AI 生成完成后，同步最终内容到本地编辑状态
  // markGenerated 更新了 currentReport.content 但 id 不变，上面的 effect 不会触发
  const prevGeneratingRef = useRef(false)
  useEffect(() => {
    if (prevGeneratingRef.current && !generating) {
      // generating 从 true→false，说明生成刚结束
      setLocalContent(currentReport?.content || '')
      setDirty(false)
    }
    prevGeneratingRef.current = generating
  }, [generating]) // eslint-disable-line react-hooks/exhaustive-deps

  // AI 生成中时自动切换到预览模式
  useEffect(() => {
    if (generating) {
      setMode('preview')
    }
  }, [generating])

  // 展示内容：生成中显示流式内容，否则显示本地编辑内容
  const displayContent = generating ? streamingContent : localContent

  // 渲染 Markdown 预览
  useEffect(() => {
    if (mode !== 'preview') return
    let cancelled = false
    void getMarkdownRenderer().then((render) => {
      if (!cancelled) {
        setHtmlContent(render(displayContent || `*${t('emptyHint')}*`))
      }
    })
    return () => { cancelled = true }
  }, [displayContent, mode, t])

  // 防抖自动保存
  const scheduleSave = useCallback((content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveContent(content)
        setDirty(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      } catch (err) {
        console.error('[ReportPanel] 自动保存失败:', err)
      }
    }, 1500)
  }, [saveContent])

  const handleContentChange = (value: string) => {
    setLocalContent(value)
    setDirty(true)
    setSaved(false)
    scheduleSave(value)
  }

  // 空态
  if (!currentReport) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t('selectWeek')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部：周信息 + 模式切换 + 保存状态 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">
            {formatWeekLabel(currentWeekStart)}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatWeekRange(currentWeekStart)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 保存状态指示 */}
          {generating ? (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Loader2 className="size-3 animate-spin" />
              {t('generating')}
            </span>
          ) : dirty ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Save className="size-3" />
              {t('saving')}
            </span>
          ) : saved ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="size-3" />
              {t('saved')}
            </span>
          ) : null}
          {/* 编辑/预览切换 */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'edit' | 'preview')}>
            <TabsList className="h-7">
              <TabsTrigger value="edit" className="px-2 py-0 text-xs" disabled={generating}>
                <PenLine className="mr-1 size-3" />
                {t('edit')}
              </TabsTrigger>
              <TabsTrigger value="preview" className="px-2 py-0 text-xs">
                <Eye className="mr-1 size-3" />
                {t('preview')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1">
        {mode === 'edit' && !generating ? (
          <Textarea
            value={localContent}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder={t('editPlaceholder')}
            className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
          />
        ) : (
          <ScrollArea className="h-full">
            <div
              className="report-preview prose prose-sm max-w-none px-6 py-4 text-foreground"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
