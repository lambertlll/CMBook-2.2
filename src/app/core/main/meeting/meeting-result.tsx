'use client'

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useMeetingStore, getMeetingAudioPaths, type Meeting } from './meeting-store'
import { MEETING_TEMPLATES } from './meeting-templates'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Copy, Save, RefreshCw, Check, FileText, Mic2, Mic, Sparkles, Loader2, RotateCcw, Library, FolderInput, Building2, User, Search, ChevronLeft, Calendar, Clock, ChevronDown, ChevronUp, FileType, Square, ListChecks } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown } from '@tiptap/markdown'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import EditorToolbar from '@/app/core/main/editor/markdown/editor-toolbar'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { generateMeetingSummary, rewriteSummarySelection } from './meeting-generate-summary'
import { SummaryBubbleMenu } from './meeting-summary-bubble'
import { transcribeAudio } from './meeting-transcribe'
import { loadMeetingAudio } from './meeting-load-audio'
import { syncMeetingSummaryToCustomer, retryExportFailures, ensureVisitForMeeting, type CustomerSyncFailureStep } from './meeting-customer-export'
import { deleteVisitRecord } from '@/db/visits'
import { useTodoConfirmStore } from '@/stores/todo-confirm'
import { identifyMeetingCustomer } from '@/lib/identify-customer'
import { useCustomerStore } from '../customer/customer-store'
import type { CustomerType } from '@/db/customers'
import { cn } from '@/lib/utils'
import { useSidebarStore } from '@/stores/sidebar'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { exportMarkdownToWord } from '@/lib/export-word'
// 复用主编辑器的排版样式（.tiptap-editor），替换未生效的 prose 类（项目无 typography 插件）
import '../editor/markdown/style.css'

interface MeetingResultProps {
  meeting: Meeting
}

/** HTML 实体转义，防止 AI 输出/转写文本注入标签 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 从会议标题猜测客户名（归类对话框"新建客户"的名称预填）：
 * 剥离日期（2024-01-02 / 2024/1/2 / 2024年1月2日 / 1月2日 / 01-02）、
 * "拜访/会议/纪要/走访/贷后"等常见场景词与分隔标点，收敛空白；
 * 结果为空则不预填（由调用方判断）。
 */
function guessCustomerName(title: string): string {
  if (!title) return ''
  let name = title
    // 日期：含年份的完整日期、X月X日、M-D 短日期
    .replace(/\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日?/g, ' ')
    .replace(/\b\d{1,2}[-/.]\d{1,2}\b/g, ' ')
  // 常见会议场景词（中英文）
  name = name.replace(
    /首次|定期|贷后|貸後|营销|營銷|走访|走訪|拜访|拜訪|面谈|面談|座谈|座談|沟通|溝通|交流|回访|回訪|会议|會議|纪要|紀要|visit|meeting|summary/gi,
    ' '
  )
  // 分隔标点与多余空白
  return name
    .replace(/[-—–_·:：,，.。;；()（）[\]【】「」『』/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Simple markdown to HTML converter for meeting summaries.
 */
function formatMarkdown(md: string): string {
  if (!md) return ''

  // 先转义原文，再做 markdown 标记替换
  let html = escapeHtml(md)

  // 管道表格：连续以 | 开头的行聚合为 table（第二行是分隔行时首行作为表头）
  html = html.replace(/(^\|.*\|$\n?)+/gm, (block) => {
    const rows = block.trim().split('\n')
    if (rows.length < 2) return block
    const isSeparator = (line: string) => /^\|[\s:|-]+\|$/.test(line.trim())
    const cells = (line: string) =>
      line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    let table = '<table>'
    let start = 0
    if (isSeparator(rows[1])) {
      table +=
        '<thead><tr>' +
        cells(rows[0]).map((c) => `<th>${c}</th>`).join('') +
        '</tr></thead>'
      start = 2
    }
    table += '<tbody>'
    for (let i = start; i < rows.length; i++) {
      if (isSeparator(rows[i])) continue
      table += '<tr>' + cells(rows[i]).map((c) => `<td>${c}</td>`).join('') + '</tr>'
    }
    return table + '</tbody></table>'
  })

  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // 连续的 <li> 包一层 <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.trim()}</ul>`)

  html = html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')

  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<table')) {
    html = `<p>${html}</p>`
  }

  return html
}

/** 头部元信息行的时间格式：MM/DD HH:mm（对齐原型） */
function formatMetaTime(timestamp: number): string {
  const d = new Date(timestamp)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

function NotesTab({ meeting }: { meeting: Meeting }) {
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const t = useTranslations('meeting')

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: t('notesPlaceholder'),
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: meeting.manualNotes || '',
    onUpdate: ({ editor }) => {
      updateMeeting(meeting.id, { manualNotes: editor.getHTML() })
    },
    editorProps: {
      attributes: {
        // prose 类未生效（项目无 typography 插件），排版统一由 style.css 的 .tiptap-editor 提供
        class: 'focus:outline-none h-full',
      },
    },
  })

  return (
    <div className="h-full overflow-y-auto tiptap-editor">
      <EditorContent editor={editor} />
    </div>
  )
}

function TranscriptTab({
  meeting,
  onRetranscribe,
}: {
  meeting: Meeting
  onRetranscribe: () => void
}) {
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const sttEngine = useSettingStore((s) => s.sttEngine)
  const setSttEngine = useSettingStore((s) => s.setSttEngine)
  const t = useTranslations('meeting')
  // 记录编辑器最近一次内容，用于区分外部更新与编辑器自身 onUpdate
  const lastContentRef = useRef(meeting.transcript)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: t('transcriptPlaceholder'),
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: meeting.transcript
      ? `<p>${escapeHtml(meeting.transcript).replace(/\n/g, '</p><p>')}</p>`
      : '',
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      lastContentRef.current = text
      updateMeeting(meeting.id, { transcript: text })
    },
    editorProps: {
      attributes: {
        // prose 类未生效（项目无 typography 插件），排版统一由 style.css 的 .tiptap-editor 提供
        class: 'focus:outline-none h-full',
      },
    },
  })

  // 外部（如重新转写完成）更新 transcript 时同步到编辑器，
  // 与 onUpdate 刚写入的值相同则跳过，避免循环
  useEffect(() => {
    if (!editor) return
    if (meeting.transcript === lastContentRef.current) return
    editor.commands.setContent(
      meeting.transcript
        ? `<p>${escapeHtml(meeting.transcript).replace(/\n/g, '</p><p>')}</p>`
        : '',
      { emitUpdate: false }
    )
    lastContentRef.current = meeting.transcript
  }, [meeting.transcript, editor])

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具条：STT 引擎快捷切换 + 重新转写，识别不准时可换引擎后一键重试 */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">{t('sttEngine')}</span>
        <Select
          value={sttEngine}
          onValueChange={(value) =>
            setSttEngine(value as 'openai-compatible' | 'aliyun')
          }
        >
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai-compatible" className="text-xs">
              {t('sttEngineOpenai')}
            </SelectItem>
            <SelectItem value="aliyun" className="text-xs">
              {t('sttEngineAliyun')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetranscribe}
          disabled={
            getMeetingAudioPaths(meeting).length === 0 ||
            meeting.status === 'transcribing'
          }
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {t('retranscribe')}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto tiptap-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

interface SummaryTabProps {
  meeting: Meeting
  onGenerate: () => void // 生成/重新生成（已有纪要时父组件会先弹覆盖确认）
}

function SummaryTab({ meeting, onGenerate }: SummaryTabProps) {
  const t = useTranslations('meeting')

  // 转写中状态（diarizing 表示正在用 fun-asr 重转写补充说话人标注）
  if (meeting.status === 'transcribing') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {meeting.diarizing ? t('diarizing') : t('transcribing')}
        </p>
        <Progress value={meeting.transcribeProgress} className="w-[300px]" />
        <p className="text-xs text-muted-foreground">
          {meeting.transcribeProgress}%
        </p>
      </div>
    )
  }

  // 生成中状态（流式输出）：保持只读流式渲染，底部操作栏的生成按钮同步显示进度
  if (meeting.status === 'generating') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">{t('generating')}</span>
        </div>
        <div className="flex-1 overflow-auto tiptap-editor">
          {/* 流式输出：外层套 ProseMirror 类复用排版样式，不影响流式更新 */}
          <div
            className="ProseMirror"
            dangerouslySetInnerHTML={{
              __html: formatMarkdown(meeting.summary || ''),
            }}
          />
        </div>
      </div>
    )
  }

  // 未生成纪要时显示引导（对齐原型：虚线卡片 + 图标 + 说明 + 主按钮）；
  // 中央大按钮与底部操作栏的生成按钮是"全页唯一生成入口"在空态的形态
  if (!meeting.summary) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-[420px] flex-col items-center gap-3 rounded-lg border border-dashed bg-background px-6 py-8 text-center text-muted-foreground">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="w-5 h-5 text-primary" />
          </span>
          <p className="text-sm">{t('summaryEmptyHint')}</p>
          <Button onClick={onGenerate} className="mt-1">
            <Sparkles className="w-4 h-4 mr-1" />
            {t('generateSummary')}
          </Button>
          <p className="text-xs">{t('summaryEmptyModelHint')}</p>
        </div>
      </div>
    )
  }

  // 已完成：可编辑纪要（生成入口在底部操作栏，全页唯一）
  return (
    <div className="flex flex-col h-full">
      <SummaryEditor meeting={meeting} />
    </div>
  )
}

/**
 * 可编辑纪要：生成完成后以 TipTap 编辑器渲染（复用 .tiptap-editor 排版类），
 * 编辑经 getMarkdown() 转回 markdown 保存（store 侧 500ms 防抖落库）。
 * 仅在“已有纪要”的分支挂载，挂载时读到的即最终内容；外部变更走 setContent 同步。
 */
function SummaryEditor({ meeting }: { meeting: Meeting }) {
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const t = useTranslations('meeting')
  const [rewriting, setRewriting] = useState(false)
  // 滚动容器引用，同时作为气泡菜单的定位容器
  const scrollRef = useRef<HTMLDivElement>(null)
  // 记录编辑器最近一次内容，用于区分外部更新与编辑器自身 onUpdate
  const lastContentRef = useRef(meeting.summary)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      // 格式工具栏所需扩展（与笔记编辑器对齐）
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      // 纪要模板包含管道表格，需要表格扩展才能正确解析与序列化
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // 提供 contentType: 'markdown' 解析与 getMarkdown() 序列化，summary 始终以 markdown 存储
      Markdown,
    ],
    content: meeting.summary,
    contentType: 'markdown',
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      lastContentRef.current = markdown
      updateMeeting(meeting.id, { summary: markdown })
    },
    editorProps: {
      attributes: {
        // prose 类未生效（项目无 typography 插件），排版统一由 style.css 的 .tiptap-editor 提供
        class: 'focus:outline-none h-full',
      },
    },
  })

  // 本地上传图片：与笔记编辑器同一交互（选文件→本地保存/图床上传→插入节点）
  const handleLocalImage = useCallback(async () => {
    if (!editor) return
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const { handleImageUpload } = await import('@/lib/image-handler')
    const insertPos = editor.state.selection.from
    const placeholder = 'Uploading... '

    editor.chain().focus().insertContentAt(insertPos, { type: 'text', text: placeholder }).run()
    const placeholderEnd = insertPos + placeholder.length

    try {
      const file = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      })
      if (!file) {
        editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
        return
      }
      let fileObject: File
      if (typeof file === 'string') {
        const fileData = await readFile(file)
        const ext = file.split('.').pop() || 'png'
        const fileName = file.split('/').pop() || `image.${ext}`
        fileObject = new File([new Uint8Array(fileData)], fileName, { type: `image/${ext}` })
      } else {
        fileObject = file
      }
      const result = await handleImageUpload(fileObject, meeting.audioPath || '')
      editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
      editor.chain().focus().insertContentAt(insertPos, {
        type: 'image',
        attrs: { src: result.src, alt: fileObject.name, relativeSrc: result.relativePath },
      }).run()
    } catch (err) {
      editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
      toast({ description: `图片上传失败：${err instanceof Error ? err.message : '未知错误'}`, variant: 'destructive' })
    }
  }, [editor, meeting.audioPath])

  // 承接工具栏"本地上传"按钮派发的事件（editor-toolbar 派发 tiptap-insert-image）
  useEffect(() => {
    const handler = () => void handleLocalImage()
    document.addEventListener('tiptap-insert-image', handler)
    return () => document.removeEventListener('tiptap-insert-image', handler)
  }, [handleLocalImage])

  // 外部更新 summary（如重新生成完成）时同步到编辑器，
  // 与 onUpdate 刚写入的值相同则跳过，避免循环
  useEffect(() => {
    if (!editor) return
    if (meeting.summary === lastContentRef.current) return
    editor.commands.setContent(meeting.summary || '', {
      emitUpdate: false,
      contentType: 'markdown',
    })
    lastContentRef.current = meeting.summary
  }, [meeting.summary, editor])

  // 局部 AI 修改：选中文字 + 指令发给 AI（用该会议已选模型），
  // 返回后在 TipTap 事务中原地替换选区（保持可撤销）；失败 toast 且不改内容
  const handleApplyRewrite = useCallback(
    async (instruction: string) => {
      if (!editor || rewriting) return
      const { from, to } = editor.state.selection
      const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n')
      if (!selectedText.trim()) return
      setRewriting(true)
      try {
        const result = await rewriteSummarySelection({
          selectedText,
          instruction,
          title: meeting.title || undefined,
          modelId: meeting.selectedModel || undefined,
        })
        if (!result) throw new Error('AI 未返回内容')
        editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, result, { contentType: 'markdown' })
          .run()
      } catch (err) {
        console.error('局部修改纪要失败:', err)
        toast({
          description: `${t('bubbleFailed')}：${err instanceof Error ? err.message : '未知错误'}`,
          variant: 'destructive',
        })
      } finally {
        setRewriting(false)
      }
    },
    [editor, rewriting, meeting.title, meeting.selectedModel, t]
  )

  return (
    <div className="flex h-full flex-col">
      {/* 格式工具栏（与笔记编辑器一致） */}
      <EditorToolbar editor={editor} />
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto tiptap-editor">
        <EditorContent editor={editor} />
        {editor && (
          <SummaryBubbleMenu
            editor={editor}
            containerRef={scrollRef}
            processing={rewriting}
            onApply={handleApplyRewrite}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 「归类到客户知识库」对话框：为已出纪要的会议选择/新建客户（也支持改绑/解绑）。
 * 确认后依次执行：新建客户（可选）→ 关联会议 → 自动导出到客户知识库
 * （导出 + 向量化 + 待办提取一次完成）；失败分步提示，前序步骤成果保留。
 * 已关联客户的会议（改绑场景）：列表中标记当前关联客户并预选，页脚提供"解除关联"。
 */
export function ClassifyToCustomerDialog({
  meeting,
  open,
  onOpenChange,
  onExported,
}: {
  meeting: Meeting
  open: boolean
  onOpenChange: (open: boolean) => void
  onExported: () => void // 导出成功后刷新"编辑后未同步"基线
}) {
  const t = useTranslations('meeting')
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const createCustomer = useCustomerStore((s) => s.createCustomer)
  const customers = useCustomerStore((s) => s.customers)

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<CustomerType>('enterprise')
  const [newIndustry, setNewIndustry] = useState('')
  const [working, setWorking] = useState(false)
  // 解除关联确认弹窗（误归类兜底）
  const [unbindConfirmOpen, setUnbindConfirmOpen] = useState(false)

  // 打开时重置表单：已有客户默认"选择已有"（无客户则落"新建"），改绑场景预选当前关联客户；
  // 新建名称从会议标题猜测预填（剥离日期与常见场景词，猜不出则不预填）
  useEffect(() => {
    if (!open) return
    const state = useCustomerStore.getState()
    if (!state.initialized) void state.loadCustomers()
    setMode(state.customers.length > 0 ? 'existing' : 'new')
    setSearch('')
    setSelectedId(meeting.customerId || '')
    setNewName(guessCustomerName(meeting.title))
    setNewType('enterprise')
    setNewIndustry('')
    setWorking(false)
    setUnbindConfirmOpen(false)
  }, [open, meeting.title, meeting.customerId])

  // 客户搜索过滤（按名称包含匹配，不区分大小写）
  const filteredCustomers = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return customers
    return customers.filter((c) => c.name.toLowerCase().includes(kw))
  }, [customers, search])

  const confirmDisabled =
    working || (mode === 'existing' ? !selectedId : !newName.trim())

  const handleConfirm = useCallback(async () => {
    if (confirmDisabled) return
    setWorking(true)

    // ① 新建客户（createCustomer 内部自动建文件夹结构）；失败则中断，不影响会议
    let customerId = selectedId
    const customerName =
      mode === 'existing'
        ? (customers.find((c) => c.id === selectedId)?.name ?? '')
        : newName.trim()
    if (mode === 'new') {
      try {
        customerId = await createCustomer({
          name: customerName,
          type: newType,
          industry: newIndustry.trim() || undefined,
        })
      } catch (err) {
        console.error('归类-新建客户失败:', err)
        toast({ description: t('classifyCreateFailed'), variant: 'destructive' })
        setWorking(false)
        return
      }
    }

    // ② 关联会议与客户（内存态即生效，store 侧防抖落库）
    try {
      updateMeeting(meeting.id, { customerId })
      // 归类即建拜访记录（进入拜访时间线并计入拜访次数；失败不影响归类）
      await ensureVisitForMeeting(meeting, customerId)
    } catch (err) {
      console.error('归类-关联客户失败:', err)
      toast({ description: t('classifyLinkFailed'), variant: 'destructive' })
      setWorking(false)
      return
    }

    // ③ 自动导出到客户知识库（导出 + 向量化 + 待办提取）。
    // 用 store 中的最新会议对象（含刚写入的 customerId）；
    // 导出失败不阻断：关联已生效，提示稍后手动点「同步到知识库」
    const latest = useMeetingStore
      .getState()
      .meetings.find((m) => m.id === meeting.id)
    const result = latest
      ? await syncMeetingSummaryToCustomer(latest)
      : { ok: false }
    if (result.ok) {
      onExported()
      toast({ description: t('classifySuccess', { name: customerName }) })
      // 待办确认弹窗
      useTodoConfirmStore.getState().showFromSummary({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        customerId: latest?.customerId || '',
        visitId: latest?.visitId || '',
        summary: meeting.summary,
      })
    } else {
      toast({
        description: t('classifyExportFailed', { name: customerName }),
        variant: 'destructive',
      })
    }
    setWorking(false)
    onOpenChange(false)
  }, [
    confirmDisabled,
    selectedId,
    customers,
    mode,
    newName,
    newType,
    newIndustry,
    createCustomer,
    updateMeeting,
    meeting.id,
    onExported,
    onOpenChange,
    t,
  ])

  // 当前关联客户名（改绑/解绑场景用于列表标记与确认文案；记录已删则为空串）
  const linkedName =
    customers.find((c) => c.id === meeting.customerId)?.name ?? ''

  // 解除关联（误归类兜底）：清空会议的客户/拜访关联，删除自动创建的拜访记录；
  // 已导出到客户知识库的文件保留（用户可手动清理）。解绑后回到"归类"入口可用状态
  const handleUnbind = useCallback(async () => {
    // 删除拜访记录（由 ensureVisitForMeeting 自动创建的），并清空 meeting 的关联字段
    if (meeting.visitId) {
      try {
        await deleteVisitRecord(meeting.visitId)
      } catch (err) {
        console.warn('[Unbind] 删除拜访记录失败:', err)
      }
      // 刷新客户拜访列表（若该客户时间线已加载）
      const custId = meeting.customerId
      if (custId && useCustomerStore.getState().visitsLoadedFor === custId) {
        void useCustomerStore.getState().loadVisits(custId)
      }
    }
    updateMeeting(meeting.id, { customerId: '', visitId: '' })
    toast({
      description: t('unbindSuccess', { name: linkedName || '—' }),
    })
    setUnbindConfirmOpen(false)
    onOpenChange(false)
  }, [updateMeeting, meeting.id, meeting.visitId, meeting.customerId, linkedName, onOpenChange, t])

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // 归类进行中禁止关闭，避免重复提交
        if (!working) onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('classifyDialogTitle')}</DialogTitle>
          <DialogDescription>{t('classifyDialogDesc')}</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as 'existing' | 'new')}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="existing"
              id="classify-mode-existing"
              disabled={customers.length === 0}
            />
            <Label htmlFor="classify-mode-existing" className="font-normal">
              {t('classifyModeExisting')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="new" id="classify-mode-new" />
            <Label htmlFor="classify-mode-new" className="font-normal">
              {t('classifyModeNew')}
            </Label>
          </div>
        </RadioGroup>

        {mode === 'existing' ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('classifySearchPlaceholder')}
                className="pl-8"
              />
            </div>
            <ScrollArea className="h-[200px] rounded-md border">
              {filteredCustomers.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {customers.length === 0
                    ? t('classifyNoCustomers')
                    : t('classifyNoMatch')}
                </p>
              ) : (
                <div className="p-1">
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                        selectedId === c.id && 'bg-accent'
                      )}
                    >
                      {/* 与客户列表一致：个人客户 User 图标，企业客户 Building2 图标 */}
                      {c.type === 'individual' ? (
                        <User className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{c.name}</span>
                      {/* 改绑场景：标记当前已关联客户 */}
                      {c.id === meeting.customerId && (
                        <span className="ml-1 shrink-0 text-xs text-muted-foreground">
                          {t('currentLinked')}
                        </span>
                      )}
                      {selectedId === c.id && (
                        <Check className="ml-auto w-4 h-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('classifyNameLabel')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('classifyNamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t('classifyTypeLabel')}</Label>
              <RadioGroup
                value={newType}
                onValueChange={(v) => setNewType(v as CustomerType)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="enterprise"
                    id="classify-type-enterprise"
                  />
                  <Label
                    htmlFor="classify-type-enterprise"
                    className="font-normal"
                  >
                    {t('classifyTypeEnterprise')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="individual"
                    id="classify-type-individual"
                  />
                  <Label
                    htmlFor="classify-type-individual"
                    className="font-normal"
                  >
                    {t('classifyTypeIndividual')}
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1">
              <Label>{t('classifyIndustryLabel')}</Label>
              <Input
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                placeholder={t('classifyIndustryPlaceholder')}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {/* 误归类兜底：已关联客户时提供解除关联（二次确认） */}
          {meeting.customerId && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={working}
              onClick={() => setUnbindConfirmOpen(true)}
            >
              {t('unbindCustomer')}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={confirmDisabled}>
            {working && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {working ? t('classifyWorking') : t('classifyConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 解除关联确认：仅清空会议的客户关联，不删除已导出文件 */}
    <AlertDialog open={unbindConfirmOpen} onOpenChange={setUnbindConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('unbindConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('unbindConfirmDesc', { name: linkedName || '—' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleUnbind}>
            {t('unbindCustomer')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

export function MeetingResult({ meeting }: MeetingResultProps) {
  const t = useTranslations('meeting')
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)
  const setMeetingError = useMeetingStore((s) => s.setMeetingError)
  const continueRecording = useMeetingStore((s) => s.continueRecording)
  // 默认落在“纪要”Tab：用户进入结果页首先看到纪要（未生成时是引导状态）
  const [activeTab, setActiveTab] = useState('summary')
  const [copied, setCopied] = useState(false)
  const aiModelList = useSettingStore((s) => s.aiModelList)
  const primaryModel = useSettingStore((s) => s.primaryModel)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AI 纪要生成的 AbortController：支持中途停止
  const abortControllerRef = useRef<AbortController | null>(null)
  // 待办确认：纪要生成后不自动弹窗，等用户确认纪要内容后再弹出
  const [pendingTodoSummary, setPendingTodoSummary] = useState<string | null>(null)

  // 卸载时清理复制状态的定时器
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  // 计算可用的 chat 模型列表
  const chatModels = React.useMemo(() => {
    const models: { id: string; label: string; group: string }[] = []
    if (!aiModelList) return models
    aiModelList.forEach((config) => {
      if (!config.baseURL) return
      if (config.models && config.models.length > 0) {
        config.models.forEach((model) => {
          if (model.modelType === 'chat' && model.model) {
            models.push({
              id: model.id,
              label: model.model,
              group: config.title,
            })
          }
        })
      } else if ((config.modelType === 'chat' || !config.modelType) && config.model) {
        models.push({
          id: config.key,
          label: config.model,
          group: config.title,
        })
      }
    })
    return models
  }, [aiModelList])

  // 当前选中的模型（优先会议级别，否则 primaryModel）
  const effectiveModel = meeting.selectedModel || primaryModel || ''

  // 实时转写开关（复用现有全局设置，影响后续录音）
  const meetingLiveTranscript = useSettingStore((s) => s.meetingLiveTranscript)
  const setMeetingLiveTranscript = useSettingStore((s) => s.setMeetingLiveTranscript)

  // 头部「详情」折叠：录音路径默认收起，点击展开查看
  const [audioDetailsOpen, setAudioDetailsOpen] = useState(false)

  // 用户自定义模板（设置页维护），与内置模板合并展示
  const customTemplates = useSettingStore((s) => s.customMeetingTemplates)
  // 已选模板被删除（自定义模板）时，下拉回退显示默认模板（生成时 resolveTemplate 同样回退）
  const templateValue = [...MEETING_TEMPLATES, ...customTemplates].some(
    (tpl) => tpl.id === meeting.selectedTemplate
  )
    ? meeting.selectedTemplate
    : 'default'

  // 头部状态标签（结果页只会是 转写中/生成中/已完成 三种状态）
  const statusTag = useMemo(() => {
    switch (meeting.status) {
      case 'completed':
        return { label: t('statusCompleted'), className: 'bg-success/10 text-success' }
      case 'transcribing':
        return { label: t('statusTranscribing'), className: 'bg-warning/10 text-warning' }
      case 'generating':
        return { label: t('statusGenerating'), className: 'bg-warning/10 text-warning' }
      default:
        return null
    }
  }, [meeting.status, t])

  // 头部元信息行的时长文本：不足 1 分钟按 1 分钟计；为 0（老数据）则隐藏
  const durationText = useMemo(() => {
    const totalMin = Math.round(meeting.duration / 60)
    if (totalMin <= 0) return ''
    if (totalMin < 60) return t('durationMinutes', { minutes: totalMin })
    return t('durationHours', {
      hours: Math.floor(totalMin / 60),
      minutes: totalMin % 60,
    })
  }, [meeting.duration, t])

  // 关联客户信息（无关联时为 undefined，相关 UI 不渲染）
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const linkedCustomerName = useCustomerStore((s) =>
    meeting.customerId
      ? s.customers.find((c) => c.id === meeting.customerId)?.name
      : undefined
  )

  // 有关联客户时确保客户列表已加载（用于显示客户名；未加载完成前静默不显示）
  useEffect(() => {
    if (meeting.customerId && !customersInitialized) {
      loadCustomers()
    }
  }, [meeting.customerId, customersInitialized, loadCustomers])

  // 纪要"编辑后未同步"提示（评审改进②）：
  // 同步基线 = 最近一次导出到知识库时的纪要内容。生成/重新生成完成（status 进入 completed，
  // 管线内已自动导出+提取待办）与手动同步成功都会刷新基线；编辑偏离基线则提示重新同步。
  const lastSyncedSummaryRef = useRef(meeting.summary)
  const prevStatusRef = useRef(meeting.status)
  const [summaryDirtySinceSync, setSummaryDirtySinceSync] = useState(false)

  // 切换会议时重置基线
  useEffect(() => {
    lastSyncedSummaryRef.current = meeting.summary
    prevStatusRef.current = meeting.status
    setSummaryDirtySinceSync(false)
  }, [meeting.id])

  // 生成/重新生成完成（status 非 completed → completed）时刷新基线
  useEffect(() => {
    if (
      prevStatusRef.current !== 'completed' &&
      meeting.status === 'completed' &&
      meeting.summary
    ) {
      lastSyncedSummaryRef.current = meeting.summary
      setSummaryDirtySinceSync(false)
    }
    prevStatusRef.current = meeting.status
  }, [meeting.status, meeting.summary])

  // 编辑偏离基线 → 显示"同步以更新知识库与待办"提示
  useEffect(() => {
    setSummaryDirtySinceSync(
      !!meeting.summary && meeting.summary !== lastSyncedSummaryRef.current
    )
  }, [meeting.summary])

  // 跳回客户 Tab 并选中关联客户
  const handleOpenCustomer = useCallback(async () => {
    if (!meeting.customerId) return
    const sidebar = useSidebarStore.getState()
    if (!sidebar.leftSidebarVisible) {
      await sidebar.toggleLeftSidebar()
    }
    await useSidebarStore.getState().setLeftSidebarTab('customer')
    useCustomerStore.getState().selectCustomer(meeting.customerId)
  }, [meeting.customerId])

  // 导出失败步骤名拼接（"向量化、待办提取"），用于部分成功 toast 的 {steps}
  const formatSyncFailedSteps = useCallback(
    (steps: CustomerSyncFailureStep[]): string => {
      const labelMap: Record<CustomerSyncFailureStep, string> = {
        vectorize: t('syncStepVectorize'),
        extractTodos: t('syncStepExtractTodos'),
        writeFile: t('syncStepWriteFile'),
        advanceStage: t('syncStepAdvanceStage'),
      }
      return steps.map((s) => labelMap[s]).join(t('syncStepsSeparator'))
    },
    [t]
  )

  // 定向重试导出失败的附属步骤（仅向量化/待办提取）；重试结果同样走分级 toast
  const [retryingExport, setRetryingExport] = useState(false)
  // 显式类型标注：toast action 闭包内自引用（失败后再次重试）需要避免推断循环
  const handleRetryExportSteps: (
    steps: CustomerSyncFailureStep[]
  ) => Promise<void> = useCallback(
    async (steps: CustomerSyncFailureStep[]) => {
      if (retryingExport || steps.length === 0) return
      setRetryingExport(true)
      try {
        const result = await retryExportFailures(meeting, steps)
        if (result.ok) {
          toast({ description: t('syncKnowledgeRetrySuccess') })
        } else {
          // 仍有失败步骤：再次给出重试入口（只带剩余失败步骤）
          const remaining = result.failures.map((f) => f.step)
          toast({
            description: t('syncKnowledgePartial', {
              steps: formatSyncFailedSteps(remaining),
            }),
            variant: 'destructive',
            action: (
              <ToastAction
                altText={t('syncKnowledgeRetry')}
                onClick={() => void handleRetryExportSteps(remaining)}
              >
                {t('syncKnowledgeRetry')}
              </ToastAction>
            ),
          })
        }
      } finally {
        setRetryingExport(false)
      }
    },
    [retryingExport, meeting, t, formatSyncFailedSteps]
  )

  // 手动同步纪要到客户知识库（覆盖写 + 向量化 + 待办重新提取），供编辑纪要后手动触发
  const [syncingKnowledge, setSyncingKnowledge] = useState(false)
  const handleSyncToKnowledge = useCallback(async () => {
    if (syncingKnowledge) return
    setSyncingKnowledge(true)
    try {
      const result = await syncMeetingSummaryToCustomer(meeting)
      if (result.ok) {
        // 归档成功：刷新基线，清除"编辑后未同步"提示（附属步骤失败不影响归档事实）
        lastSyncedSummaryRef.current = meeting.summary
        setSummaryDirtySinceSync(false)
        // 待办确认弹窗
        useTodoConfirmStore.getState().showFromSummary({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          customerId: meeting.customerId || '',
          visitId: meeting.visitId || '',
          summary: meeting.summary,
        })
        if (result.failures.length === 0) {
          toast({ description: t('syncKnowledgeSuccess') })
        } else {
          // 部分成功：已归档但附属步骤失败，给出定向重试入口（仅可重试步骤）
          const failedSteps = result.failures.map((f) => f.step)
          const retryable = failedSteps.filter(
            (s) => s === 'vectorize' || s === 'extractTodos'
          )
          toast({
            description: t('syncKnowledgePartial', {
              steps: formatSyncFailedSteps(failedSteps),
            }),
            variant: 'destructive',
            action:
              retryable.length > 0 ? (
                <ToastAction
                  altText={t('syncKnowledgeRetry')}
                  onClick={() => void handleRetryExportSteps(retryable)}
                >
                  {t('syncKnowledgeRetry')}
                </ToastAction>
              ) : undefined,
          })
        }
      } else {
        toast({
          description: t('syncKnowledgeFailed'),
          variant: 'destructive',
        })
      }
    } finally {
      setSyncingKnowledge(false)
    }
  }, [syncingKnowledge, meeting, t, formatSyncFailedSteps, handleRetryExportSteps])

  // 「归类到客户知识库」入口：已出纪要但未关联客户的会议显示（与同步按钮互斥）
  const [classifyOpen, setClassifyOpen] = useState(false)
  // 归类成功后已自动导出到知识库：刷新同步基线，避免立即出现"编辑后未同步"提示
  const handleClassifyExported = useCallback(() => {
    lastSyncedSummaryRef.current = meeting.summary
    setSummaryDirtySinceSync(false)
  }, [meeting.summary])

  const getContentForTab = useCallback((): string => {
    switch (activeTab) {
      case 'notes':
        // Strip HTML tags for plain text copy
        const div = document.createElement('div')
        div.innerHTML = meeting.manualNotes
        return div.textContent || div.innerText || ''
      case 'transcript':
        return meeting.transcript
      case 'summary':
        return meeting.summary
      default:
        return ''
    }
  }, [activeTab, meeting.manualNotes, meeting.transcript, meeting.summary])

  const handleCopy = useCallback(async () => {
    const content = getContentForTab()
    if (content) {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast({
        description: t('copied'),
      })
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }
  }, [getContentForTab, t])

  const handleSaveAsNote = useCallback(async () => {
    if (!meeting.summary) return

    try {
      // Generate filename from meeting title and date
      const dateStr = new Date(meeting.createdAt).toISOString().slice(0, 10)
      const safeTitle = (meeting.title || '会议纪要').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
      const fileName = `${safeTitle}-${dateStr}.md`

      // Write file to workspace
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(fileName)
      const content = meeting.summary

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      // Add to file tree and activate
      const { addFile, setActiveFilePath } = useArticleStore.getState()
      const newFileNode = {
        name: fileName,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        isEditing: false,
        isLocale: true,
        parent: undefined,
        sha: '',
        children: [],
      }
      addFile(newFileNode as any)

      // Activate file - this triggers readArticle which loads content into editor
      await setActiveFilePath(fileName)

      toast({
        description: t('savedAsNote'),
      })
    } catch (error) {
      console.error('Save as note failed:', error)
      toast({
        description: '保存失败，请重试',
        variant: 'destructive',
      })
    }
  }, [meeting.summary, meeting.title, meeting.createdAt, t])

  const handleExportWord = useCallback(async () => {
    if (!meeting.summary) return
    try {
      const dateStr = new Date(meeting.createdAt).toISOString().slice(0, 10)
      const safeTitle = (meeting.title || '会议纪要').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
      const fileName = `${safeTitle}-${dateStr}`
      await exportMarkdownToWord(meeting.summary, fileName)
      toast({ description: t('exportedWord') })
    } catch (error) {
      console.error('Word export failed:', error)
      toast({ description: '导出 Word 失败', variant: 'destructive' })
    }
  }, [meeting.summary, meeting.title, meeting.createdAt, t])

  /**
   * 自动识别客户并归类（纪要生成成功且未关联客户时后台触发，不阻塞主流程）：
   * 识别中/失败均静默（不写错误状态），仅成功时 toast；失败/无法判断时保留手动归类按钮。
   * 防重复：仅 customerId 为空时触发；同一会议同时只跑一轮（inFlight 去重）；
   * 识别完成关联前二次确认 customerId 仍为空（期间用户可能已手动归类，不覆盖用户选择）。
   */
  const [identifyingCustomer, setIdentifyingCustomer] = useState(false)
  const autoClassifyInFlightRef = useRef<Set<string>>(new Set())
  const autoClassifyMeeting = useCallback(
    async (meetingId: string, summary: string) => {
      if (autoClassifyInFlightRef.current.has(meetingId)) return
      autoClassifyInFlightRef.current.add(meetingId)
      setIdentifyingCustomer(true)
      try {
        const customerStore = useCustomerStore.getState()
        if (!customerStore.initialized) await customerStore.loadCustomers()

        const current = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        if (!current || current.customerId) return

        const candidates = useCustomerStore.getState().customers.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          industry: c.industry,
        }))
        const result = await identifyMeetingCustomer({
          title: current.title,
          transcriptHead: current.transcript,
          summary,
          customers: candidates,
          modelId: current.selectedModel || undefined,
        })
        // none / 识别失败：静默结束，保留手动归类按钮
        if (!result) return

        let customerId = ''
        let customerName = ''
        if ('customerId' in result) {
          customerId = result.customerId
          customerName = candidates.find((c) => c.id === customerId)?.name ?? ''
        } else {
          customerName = result.newCustomerName
          // 名单中没有的明确客户名：自动建档（默认企业客户，与手动归类默认值一致）
          customerId = await useCustomerStore.getState().createCustomer({
            name: customerName,
            type: 'enterprise',
            industry: '',
          })
        }

        // 关联前再确认：识别期间用户可能已手动归类/改绑，避免覆盖用户选择
        const latest = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        if (!latest || latest.customerId) return

        // 关联成功：自动导出到客户知识库（导出 + 向量化 + 待办提取一次完成）
        updateMeeting(meetingId, { customerId })
        // 归类即建拜访记录（进入拜访时间线并计入拜访次数；失败不影响归类）
        await ensureVisitForMeeting(latest, customerId)
        const linked = useMeetingStore
          .getState()
          .meetings.find((m) => m.id === meetingId)
        if (linked) {
          await syncMeetingSummaryToCustomer(linked)
        }
        toast({ description: t('autoClassifySuccess', { name: customerName }) })
      } catch (err) {
        // 自动归类任何失败（新建客户/关联/导出）只记日志静默结束，不影响会议主流程
        console.warn('自动识别并归类客户失败:', err)
      } finally {
        autoClassifyInFlightRef.current.delete(meetingId)
        setIdentifyingCustomer(false)
      }
    },
    [updateMeeting, t]
  )

  const handleRegenerate = useCallback(async () => {
    if (!meeting.transcript && !meeting.manualNotes) {
      toast({
        description: '没有可用的转录内容或笔记，请先录音或添加笔记',
        variant: 'destructive',
      })
      return
    }
    // 先设置状态，清空旧纪要和错误信息
    updateMeeting(meeting.id, { status: 'generating', summary: '', error: '' })
    setActiveTab('summary')
    // 清除上次待办确认状态
    setPendingTodoSummary(null)

    // 创建 AbortController 支持中途停止
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      // 读取最新的 meeting 数据（包含刚选的模型）
      const latest = useMeetingStore.getState().meetings.find((m) => m.id === meeting.id)
      if (!latest) return

      const fullSummary = await generateMeetingSummary({
        transcript: latest.transcript,
        manualNotes: latest.manualNotes,
        templateId: latest.selectedTemplate,
        title: latest.title || undefined,
        duration: latest.duration || undefined,
        // 客户拜访模板占位符来源：关联客户名 + 会议创建时间（未关联时为 undefined，模板侧替换为"未填写"）
        customerName: linkedCustomerName,
        createdAt: latest.createdAt,
        modelId: latest.selectedModel || undefined,
        signal: controller.signal,
        onStream: (chunk) => {
          updateMeeting(meeting.id, { summary: chunk })
        },
      })
      updateMeeting(meeting.id, { summary: fullSummary, status: 'completed' })
      // 纪要生成成功：已关联客户 → 自动导出到客户知识库并向量化（失败仅告警，不影响会议流程）；
      // 未关联客户 → 后台自动识别客户并归类（不阻塞主流程，识别失败静默，保留手动归类入口）
      const finished = useMeetingStore
        .getState()
        .meetings.find((m) => m.id === meeting.id)
      if (finished) {
        if (finished.customerId) {
          void syncMeetingSummaryToCustomer({
            ...finished,
            summary: fullSummary,
          })
        } else {
          void autoClassifyMeeting(meeting.id, fullSummary)
        }
        // 待办确认改为延迟触发：先让用户确认纪要内容，再弹出待办确认
        setPendingTodoSummary(fullSummary)
      }
    } catch (err) {
      // 用户主动停止：保留已生成内容，状态回到已完成
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = useMeetingStore.getState().meetings.find((m) => m.id === meeting.id)?.summary || ''
        updateMeeting(meeting.id, {
          summary: partial,
          status: 'completed',
        })
        if (partial) {
          setPendingTodoSummary(partial)
        }
      } else {
        console.error('生成纪要失败:', err)
        const errorMsg = err instanceof Error ? err.message : '生成失败'
        updateMeeting(meeting.id, {
          summary: `## ❌ 生成失败\n\n${errorMsg}`,
        })
        setMeetingError(meeting.id, errorMsg)
      }
    } finally {
      abortControllerRef.current = null
    }
  }, [meeting.id, meeting.transcript, meeting.manualNotes, linkedCustomerName, updateMeeting, setMeetingError, autoClassifyMeeting])

  // 停止 AI 生成：abort 后 handleRegenerate 的 catch 会保留已生成内容
  const handleStopGenerate = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  // 手动触发待办确认（用户确认纪要内容后点击）
  const handleConfirmTodos = useCallback(() => {
    if (!pendingTodoSummary) return
    const current = useMeetingStore.getState().meetings.find((m) => m.id === meeting.id)
    useTodoConfirmStore.getState().showFromSummary({
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      customerId: current?.customerId || '',
      visitId: current?.visitId || '',
      summary: pendingTodoSummary,
    })
    setPendingTodoSummary(null)
  }, [pendingTodoSummary, meeting.id, meeting.title])

  // 重新生成保护：已有纪要（可能含手动编辑）时先弹确认，避免误覆盖
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false)
  const requestRegenerate = useCallback(() => {
    if (meeting.summary) {
      setRegenerateConfirmOpen(true)
    } else {
      handleRegenerate()
    }
  }, [meeting.summary, handleRegenerate])

  const handleRetranscribe = useCallback(async () => {
    // 多段会议（续录）按顺序转写全部段并拼接；老数据回退为单段
    const audioPaths = getMeetingAudioPaths(meeting)
    if (audioPaths.length === 0) {
      toast({
        description: '未找到音频文件，无法重新转写',
        variant: 'destructive',
      })
      return
    }
    try {
      updateMeeting(meeting.id, { status: 'transcribing', transcribeProgress: 5, error: '' })
      setActiveTab('transcript')

      const texts: string[] = []
      for (let i = 0; i < audioPaths.length; i++) {
        const audioBlob = await loadMeetingAudio(audioPaths[i])
        const result = await transcribeAudio({
          audioBlob,
          language: 'zh',
          onProgress: (progress) => {
            // 多段时进度按段数折算到 0-100
            updateMeeting(meeting.id, {
              transcribeProgress: Math.round(
                (i * 100 + progress) / audioPaths.length
              ),
            })
          },
        })
        texts.push(result.text)
      }

      updateMeeting(meeting.id, {
        transcript: texts.filter(Boolean).join('\n\n'),
        transcribeProgress: 100,
        status: 'completed',
      })
      toast({ description: '转写完成' })
    } catch (err) {
      console.error('重新转写失败:', err)
      const errorMsg = err instanceof Error ? err.message : '转写失败'
      setMeetingError(meeting.id, errorMsg)
      toast({
        description: `转写失败：${errorMsg}`,
        variant: 'destructive',
      })
    }
  }, [meeting, updateMeeting, setMeetingError])

  // 续录：回到录音界面，在同一会议下录制新的一段（笔记保留）
  const handleContinueRecording = useCallback(() => {
    continueRecording(meeting.id)
  }, [continueRecording, meeting.id])

  // 返回会议首页（开始页/待处理入口）：清空当前选中会议
  const setActiveMeeting = useMeetingStore((s) => s.setActiveMeeting)

  return (
    <div className="flex flex-col h-full">
      {/* 头部：返回键 + 可编辑会议标题 + 状态标签；元信息行（时间 / 关联客户 / 时长，缺失项自动隐藏） */}
      <div className="px-4 pt-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 -ml-1 shrink-0"
            title={t('backToStart')}
            onClick={() => setActiveMeeting(null)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Input
            value={meeting.title}
            onChange={(e) => updateMeeting(meeting.id, { title: e.target.value })}
            placeholder={t('meetingTitle')}
            className="flex-1 text-base font-medium border-none shadow-none px-0 h-8 focus-visible:ring-0"
          />
          {statusTag && (
            <span
              className={cn(
                'ml-1 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                statusTag.className
              )}
            >
              {statusTag.label}
            </span>
          )}
        </div>
        {/* 元信息行：图标 + 文字，以 · 分隔；关联客户可点击跳转，旁置"改绑"入口（误归类兜底） */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {formatMetaTime(meeting.createdAt)}
          </span>
          {linkedCustomerName && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="flex items-center gap-1 text-primary hover:underline"
                onClick={handleOpenCustomer}
              >
                <Building2 className="w-3.5 h-3.5" />
                {linkedCustomerName}
              </button>
              <button
                type="button"
                className="hover:text-primary hover:underline"
                onClick={() => setClassifyOpen(true)}
              >
                {t('rebindCustomer')}
              </button>
            </>
          )}
          {durationText && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {t('metaDuration', { duration: durationText })}
              </span>
            </>
          )}
          {/* 录音路径折叠为「详情」：默认收起，点击展开查看；多段音频段数提示常驻 */}
          {meeting.audioPath && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => setAudioDetailsOpen((v) => !v)}
              >
                <Mic className="w-3.5 h-3.5" />
                {t('audioDetails')}
                {getMeetingAudioPaths(meeting).length > 1 &&
                  `（${t('audioSegments', { count: getMeetingAudioPaths(meeting).length })}）`}
                {audioDetailsOpen ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </>
          )}
        </div>
        {/* 录音详情展开区：完整保存路径（多段时 audioPath 指向第一段） */}
        {audioDetailsOpen && meeting.audioPath && (
          <p className="mt-1 pl-8 text-xs text-muted-foreground break-all">
            {meeting.audioPath}
          </p>
        )}
      </div>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="border-b px-4 mt-2">
          <TabsList className="h-9">
            <TabsTrigger value="notes" className="text-xs">
              <FileText className="w-3.5 h-3.5 mr-1" />
              {t('tabNotes')}
            </TabsTrigger>
            <TabsTrigger value="transcript" className="text-xs">
              <Mic2 className="w-3.5 h-3.5 mr-1" />
              {t('tabTranscript')}
            </TabsTrigger>
            <TabsTrigger value="summary" className="text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1" />
              {t('tabSummary')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="notes" className="flex-1 min-h-0 m-0 overflow-hidden">
          <NotesTab meeting={meeting} />
        </TabsContent>
        <TabsContent value="transcript" className="flex-1 min-h-0 m-0 overflow-hidden">
          <TranscriptTab meeting={meeting} onRetranscribe={handleRetranscribe} />
        </TabsContent>
        <TabsContent value="summary" className="flex-1 min-h-0 m-0 overflow-hidden">
          <SummaryTab meeting={meeting} onGenerate={requestRegenerate} />
        </TabsContent>
      </Tabs>

      {/* 错误提示（录音/转写/生成失败时由 store 写入） */}
      {meeting.error && (
        <div className="border-t px-3 py-2 text-xs text-destructive">
          {meeting.error}
        </div>
      )}

      {/* 底部操作栏（合并为一行，对齐原型）：会议纪要模型 + 纪要模板 + 生成入口（全页唯一）
          | 复制 / 继续录音 / 保存为笔记 | 右侧：提示与次要项（⋯ 菜单）+ 实时转写开关
          （AI 面板展开压缩中栏时：允许换行自适应，避免内容变形） */}
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {/* 会议纪要模型：触发器显示已选模型名，未选时回退到通用文案 */}
        <Select
          value={effectiveModel}
          disabled={meeting.status === 'generating'}
          onValueChange={(value) =>
            updateMeeting(meeting.id, { selectedModel: value })
          }
        >
          <SelectTrigger className="w-auto min-w-[132px] h-8 text-xs">
            <span className="truncate">
              {chatModels.find((m) => m.id === effectiveModel)?.label || t('summaryModel')}
            </span>
          </SelectTrigger>
          <SelectContent>
            {chatModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 纪要模板（内置 + 自定义，已删模板回退默认） */}
        <Select
          value={templateValue}
          disabled={meeting.status === 'generating'}
          onValueChange={(value) =>
            updateMeeting(meeting.id, { selectedTemplate: value })
          }
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder={t('selectTemplate')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('templateGroupBuiltin')}</SelectLabel>
              {MEETING_TEMPLATES.map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {customTemplates.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t('templateGroupCustom')}</SelectLabel>
                {customTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {/* 生成入口 + 停止按钮：生成中可中途停止或更换模型 */}
        {(meeting.transcript || meeting.manualNotes) && meeting.status !== 'generating' && (
          <Button
            size="sm"
            variant={meeting.summary ? 'outline' : 'default'}
            onClick={requestRegenerate}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {meeting.summary ? t('regenerate') : t('generateSummary')}
          </Button>
        )}
        {meeting.status === 'generating' && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleStopGenerate}
          >
            <Square className="w-4 h-4 mr-1" />
            {t('stopGenerate')}
          </Button>
        )}
        {/* 待办确认：纪要生成完成后提示用户确认待办事项 */}
        {pendingTodoSummary && meeting.status !== 'generating' && (
          <Button
            size="sm"
            variant="outline"
            className="border-primary text-primary"
            onClick={handleConfirmTodos}
          >
            <ListChecks className="w-4 h-4 mr-1" />
            {t('confirmTodos')}
          </Button>
        )}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <Check className="w-4 h-4 mr-1" />
          ) : (
            <Copy className="w-4 h-4 mr-1" />
          )}
          {copied ? t('copied') : t('copy')}
        </Button>
        {/* 续录入口：仅 completed 状态可用（转写中/生成中不渲染，天然禁用） */}
        {meeting.status === 'completed' && (
          <Button variant="outline" size="sm" onClick={handleContinueRecording}>
            <Mic className="w-4 h-4 mr-1" />
            {t('continueRecording')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={handleSaveAsNote}>
          <Save className="w-4 h-4 mr-1" />
          {t('saveAsNote')}
        </Button>
        <Button size="sm" variant="outline" onClick={handleExportWord}>
          <FileType className="w-4 h-4 mr-1" />
          {t('exportWord')}
        </Button>
        {/* 同步到知识库 / 归类到客户知识库：独立按钮，与保存为笔记、导出Word并列 */}
        {meeting.summary && !meeting.customerId && (
          <Button size="sm" variant="outline" onClick={() => setClassifyOpen(true)}>
            <FolderInput className="w-4 h-4 mr-1" />
            {t('classifyToCustomer')}
          </Button>
        )}
        {meeting.summary && meeting.customerId && (
          <Button
            size="sm"
            variant="outline"
            disabled={syncingKnowledge}
            onClick={handleSyncToKnowledge}
            className="relative"
          >
            {syncingKnowledge ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Library className="w-4 h-4 mr-1" />
            )}
            {syncingKnowledge ? t('syncingKnowledge') : t('syncToKnowledge')}
            {summaryDirtySinceSync && !syncingKnowledge && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-warning" />
            )}
          </Button>
        )}

        {/* 右侧：润色提示 / 识别中 / 未同步警示 / 归类·同步（⋯ 菜单）/ 实时转写开关 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 已有纪要时：提示局部润色能力（选中文字唤起 AI 改写气泡） */}
          {activeTab === 'summary' && meeting.summary && meeting.status !== 'generating' && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {t('polishHint')}
            </span>
          )}
          {/* 自动识别客户中：轻量状态提示（识别完成自动归类，失败静默保留手动入口） */}
          {identifyingCustomer && !meeting.customerId && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              {t('autoIdentifying')}
            </span>
          )}
          {/* 纪要编辑后未同步：提示文案（同步按钮已独立显示） */}
          {meeting.customerId && meeting.summary && summaryDirtySinceSync && !syncingKnowledge && (
            <span className="text-xs text-warning whitespace-nowrap">
              {t('summaryEditedSinceSync')}
            </span>
          )}
          {/* 实时转写开关（复用现有全局设置，影响后续录音） */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            {t('liveToggle')}
            <Switch
              checked={meetingLiveTranscript}
              onCheckedChange={(checked) => void setMeetingLiveTranscript(checked)}
            />
          </label>
        </div>
      </div>

      {/* 归类到客户知识库：选择已有客户或新建客户，确认后自动关联并导出 */}
      <ClassifyToCustomerDialog
        meeting={meeting}
        open={classifyOpen}
        onOpenChange={setClassifyOpen}
        onExported={handleClassifyExported}
      />

      {/* 重新生成确认：会覆盖当前纪要（含手动编辑） */}
      <AlertDialog
        open={regenerateConfirmOpen}
        onOpenChange={setRegenerateConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('regenerateConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('regenerateConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerate}>
              {t('regenerate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
