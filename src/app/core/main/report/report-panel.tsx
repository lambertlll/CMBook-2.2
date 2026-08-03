'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Save, Check, PenLine, Eye } from 'lucide-react'
import { useReportStore, formatWeekRange, formatWeekLabel } from './report-store'
import { MarkdownToolbar } from './markdown-toolbar'
import { ReportSelectionMenu } from './report-selection-menu'
import emitter from '@/lib/emitter'
import useChatStore from '@/stores/chat'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { MarkdownFile } from '@/lib/files'
// 复用主编辑器的排版样式（.tiptap-editor .ProseMirror），与笔记/会议纪要保持一致
import '../editor/markdown/style.css'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // 同步 store 内容到本地编辑状态（切换周报时）
  useEffect(() => {
    const content = currentReport?.content || ''
    setLocalContent(content)
    setDirty(false)
  }, [currentReport?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选中文字 → 右侧 AI 对话（与笔记 tiptap syncEditorSelectionQuote 同机制）：
  // textarea 选区变化时构造 PendingQuote 写入 chat store，AI 对话输入框上方出现引用卡片
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const syncSelectionQuote = () => {
      const { selectionStart, selectionEnd } = textarea
      if (selectionStart === selectionEnd) {
        useChatStore.getState().setEditorSelectionQuote(null)
        return
      }
      const quote = localContent.substring(selectionStart, selectionEnd)
      if (!quote.trim()) {
        useChatStore.getState().setEditorSelectionQuote(null)
        return
      }
      const beforeFrom = localContent.substring(0, selectionStart)
      const startLine = (beforeFrom.match(/\n/g)?.length || 0) + 1
      const beforeTo = localContent.substring(0, selectionEnd)
      const endLine = (beforeTo.match(/\n/g)?.length || 0) + 1

      useChatStore.getState().setEditorSelectionQuote({
        quote,
        fullContent: quote,
        fileName: formatWeekLabel(currentWeekStart) || '周报',
        startLine,
        endLine,
        from: selectionStart,
        to: selectionEnd,
        articlePath: currentReport?.id || '',
      })
    }

    textarea.addEventListener('selectionchange', syncSelectionQuote)
    // mouseup/click 兜底（selectionchange 在部分浏览器对 textarea 不触发）
    textarea.addEventListener('mouseup', syncSelectionQuote)
    textarea.addEventListener('keyup', syncSelectionQuote)
    return () => {
      textarea.removeEventListener('selectionchange', syncSelectionQuote)
      textarea.removeEventListener('mouseup', syncSelectionQuote)
      textarea.removeEventListener('keyup', syncSelectionQuote)
    }
  }, [localContent, currentReport?.id, currentWeekStart])

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

  // 选中文字 AI 改写（与笔记/会议一致：预设指令直接执行）：调用 rewriteReportSelection 调 LLM，
  // 返回改写结果由调用方（选区浮层/工具栏）负责原位替换
  const [aiProcessing, setAiProcessing] = useState(false)
  const handleAskAI = useCallback(async (instruction: string): Promise<string | null> => {
    if (aiProcessing) return null
    const textarea = textareaRef.current
    if (!textarea) return null
    const { selectionStart: start, selectionEnd: end } = textarea
    if (start === end) return null
    const selectedText = localContent.substring(start, end)
    if (!selectedText.trim()) return null

    setAiProcessing(true)
    try {
      const { rewriteReportSelection } = await import('./report-generator')
      const weekLabel = formatWeekLabel(currentWeekStart)
      const result = await rewriteReportSelection({
        selectedText,
        instruction,
        weekLabel,
      })
      if (result && result !== selectedText) {
        handleContentChange(localContent.substring(0, start) + result + localContent.substring(end))
        requestAnimationFrame(() => {
          textarea.focus()
          textarea.setSelectionRange(start, start + result.length)
        })
      }
      return result || null
    } catch (err) {
      console.error('[ReportPanel] AI 改写失败:', err)
      alert(err instanceof Error ? err.message : 'AI 改写失败，请重试')
      return null
    } finally {
      setAiProcessing(false)
    }
  }, [aiProcessing, currentWeekStart, localContent, handleContentChange])

  /**
   * 自动关联当前周报到右侧 AI 对话（与笔记 activeFilePath / 会议 meeting.id 选中体验一致）：
   * 切换周报或内容变化时，把内容写入 .ai-tmp/ 隐藏目录临时 md 文件并注入 LinkedResource，
   * AI 对话输入框上方出现「@周报（第X周）.md」标签；周报为空时清空关联。
   */
  useEffect(() => {
    async function autoLinkReportToChat() {
      const content = (currentReport?.content || '').trim()
      if (!content) {
        useChatStore.getState().setLinkedResource(null)
        return
      }

      try {
        const weekLabel = formatWeekLabel(currentWeekStart).replace(/[\\/:*?"<>|]/g, '_').slice(0, 20)
        const relDir = '.ai-tmp'
        const fileName = `${relDir}/__ai_周报-${weekLabel}.md`
        const displayName = `周报（${formatWeekLabel(currentWeekStart)}）.md`
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(fileName)
        // 确保 .ai-tmp/ 目录存在（writeTextFile 不自动建父目录；recursive 幂等）
        const { mkdir } = await import('@tauri-apps/plugin-fs')
        if (workspace.isCustom) {
          await mkdir(`${workspace.path}/${relDir}`, { recursive: true })
          await writeTextFile(pathOptions.path, content)
        } else {
          await mkdir(pathOptions.path.substring(0, pathOptions.path.lastIndexOf('/')) || relDir, {
            baseDir: pathOptions.baseDir,
            recursive: true,
          })
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }

        const linkedFile: MarkdownFile = {
          name: displayName,
          path: workspace.isCustom ? pathOptions.path : fileName,
          relativePath: workspace.isCustom ? `${workspace.path}/${fileName}` : fileName,
        }

        // 与 chat-input 的 fileSelected 监听保持一致：本地 state + chat store 双写
        useChatStore.getState().setLinkedResource(linkedFile)
        emitter.emit('fileSelected', linkedFile)
      } catch (error) {
        console.error('[ReportPanel] 关联 AI 对话失败:', error)
      }
    }

    autoLinkReportToChat()
  }, [currentReport?.id, currentReport?.content, currentWeekStart])

  // 卸载（切离周报 tab）时清空 AI 对话关联，避免残留「@周报」标签
  useEffect(() => {
    return () => {
      useChatStore.getState().setLinkedResource(null)
    }
  }, [])

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
          <div className="flex h-full flex-col">
            <MarkdownToolbar textareaRef={textareaRef} value={localContent} onChange={handleContentChange} onAskAI={handleAskAI} aiProcessing={aiProcessing} />
            {/* 编辑区容器（position: relative 供选区浮层定位） */}
            <div ref={editorContainerRef} className="relative min-h-0 flex-1">
              <Textarea
                ref={textareaRef}
                value={localContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder={t('editPlaceholder')}
                className="h-full w-full flex-1 resize-none rounded-none border-0 text-base leading-relaxed focus-visible:ring-0"
              />
              <ReportSelectionMenu
                textareaRef={textareaRef}
                onApply={handleAskAI}
                processing={aiProcessing}
                containerRef={editorContainerRef}
              />
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="tiptap-editor">
              <div
                className="ProseMirror"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
