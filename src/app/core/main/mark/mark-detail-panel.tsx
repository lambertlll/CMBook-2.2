'use client'

import React, { useCallback, useEffect, useMemo, useState } from "react"
import dayjs from "dayjs"
import {
  CheckCircle2,
  CheckSquare,
  Circle,
  FileText,
  FolderOpen,
  ImageIcon,
  Link,
  type LucideIcon,
  LoaderCircle,
  Mic,
  NotebookPen,
  RefreshCw,
  RotateCcw,
  ScanText,
  Sparkles,
  Tag,
  Trash2,
  Type,
} from "lucide-react"
import { PhotoView } from "react-photo-view"
import { useTranslations } from "next-intl"
import { delMark, delMarkForever, restoreMark, type Mark } from "@/db/marks"
import { LocalImage } from "@/components/local-image"
import { PhotoPreviewProvider } from "@/components/photo-preview-provider"
import { AudioPlayer } from "@/components/audio-player"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TooltipButton } from "@/components/tooltip-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn, isHttpUrl } from "@/lib/utils"
import { fetchAiDesc } from "@/lib/ai/description"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useArticleStore from "@/stores/article"
import useSettingStore from "@/stores/setting"
import { parseTodoMarkContent } from "./mark-list-item-content"
import type { Priority } from "./todo-form"
import { BaseDirectory, readFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { ImageRecognitionStage, recognizeImageWithFallback } from "@/lib/image-recognition"
import { getImageRecognitionProgressText } from "@/lib/image-recognition-progress"
import { toast } from "@/hooks/use-toast"
import { appDataDir } from "@tauri-apps/api/path"
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener"
import { canOpenMarkSource, getMarkOpenAction } from "./mark-open-path"
import { createRecordTab, getRecordTabPath } from "./mark-record-tab"
import { getMarkTypeListBadgeClasses } from "./mark-type-meta"
import { TipTapEditor } from "@/app/core/main/editor/markdown/tiptap-editor"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"

const getMarkTitle = (mark: Mark, fallback: string) => {
  const title = mark.desc?.trim() || mark.content?.trim() || mark.url?.trim()

  if (!title) {
    return fallback
  }

  return title.replace(/\s+/g, ' ')
}

const getEditableTitle = (mark: Mark, fallback: string) => {
  if (mark.type === 'todo') {
    return parseTodoMarkContent(mark).title || fallback
  }

  return getMarkTitle(mark, fallback)
}

// 将记录内容转换为笔记 Markdown 正文：文字类直接写入，todo 转任务列表，图片/录音附原始文件引用
const buildMarkNoteContent = (mark: Mark): string => {
  if (mark.type === 'todo') {
    const content = mark.content?.trim() || ''

    // content 本身不是 JSON（老数据或纯文本）时直接写入原文
    if (!content.startsWith('{')) {
      return content
    }

    const todo = parseTodoMarkContent(mark)
    const checkbox = `- [${todo.completed ? 'x' : ' '}] ${todo.title}`

    return todo.description ? `${checkbox}\n\n${todo.description}` : checkbox
  }

  const body = mark.content?.trim() || ''

  if (mark.type === 'image' || mark.type === 'scan') {
    // 网络图片直接插入图片引用；本地文件无法在工作区直接引用，降级为说明文字 + 原始路径
    if (mark.url && isHttpUrl(mark.url)) {
      return `${body}\n\n![](${mark.url})`.trim()
    }

    return `${body}\n\n> 原始文件：${mark.url || '-'}`.trim()
  }

  if (mark.type === 'recording') {
    return `${body}\n\n> 录音文件：${mark.url || '-'}`.trim()
  }

  // text / link / file：内容直接作为正文，内容为空时降级为链接地址
  return body || mark.url || ''
}

const detailToolbarIconButtonClass = "text-muted-foreground hover:text-foreground [&_svg]:size-4"

const MARK_DETAIL_TYPE_VISUALS: Record<Mark["type"], { icon: LucideIcon; className: string }> = {
  text: {
    icon: Type,
    className: "text-lime-500/20 dark:text-lime-300/18",
  },
  recording: {
    icon: Mic,
    className: "text-rose-500/20 dark:text-rose-300/18",
  },
  scan: {
    icon: ScanText,
    className: "text-cyan-500/20 dark:text-cyan-300/18",
  },
  image: {
    icon: ImageIcon,
    className: "text-fuchsia-500/20 dark:text-fuchsia-300/18",
  },
  link: {
    icon: Link,
    className: "text-blue-500/20 dark:text-blue-300/18",
  },
  file: {
    icon: FileText,
    className: "text-amber-500/20 dark:text-amber-300/18",
  },
  todo: {
    icon: CheckSquare,
    className: "text-slate-500/20 dark:text-slate-300/18",
  },
}

const TODO_PRIORITY_SELECTED_CLASSES: Record<Priority, string> = {
  low: "bg-success/10 text-success dark:bg-success/15",
  medium: "bg-warning/12 text-warning dark:bg-warning/15",
  high: "bg-danger/10 text-danger dark:bg-danger/15",
}

const getTextContentStats = (content: string) => {
  const charCount = content.replace(/\s/g, '').length
  const lineCount = content.trim() ? content.split(/\r?\n/).length : 0

  return { charCount, lineCount }
}

const getImageSrc = (mark: Mark): string | null => {
  if (!mark.url || (mark.type !== 'image' && mark.type !== 'scan')) {
    return null
  }

  if (isHttpUrl(mark.url)) {
    return mark.url
  }

  return `/${mark.type === 'scan' ? 'screenshot' : 'image'}/${mark.url}`
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function getLocalImagePath(mark: Mark) {
  if (!mark.url || isHttpUrl(mark.url) || (mark.type !== 'image' && mark.type !== 'scan')) {
    return null
  }

  return `${mark.type === 'scan' ? 'screenshot' : 'image'}/${mark.url}`
}

function getImageMimeType(url: string) {
  const extension = url.split('.').pop()?.toLowerCase()

  switch (extension) {
  case 'jpg':
  case 'jpeg':
    return 'image/jpeg'
  case 'webp':
    return 'image/webp'
  case 'gif':
    return 'image/gif'
  default:
    return 'image/png'
  }
}

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
}

function SectionBlock({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 px-5 py-4", className)}>
      {title || description || actions ? (
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="truncate text-xs font-medium text-muted-foreground">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={cn("min-w-0 max-w-full overflow-hidden text-sm", contentClassName)}>
        {children}
      </div>
    </section>
  )
}

function TodoMetaControls({
  todoData,
  disabled,
  onChange,
}: {
  todoData: TodoData
  disabled?: boolean
  onChange: (nextTodoData: TodoData) => void | Promise<void>
}) {
  const t = useTranslations()
  const priorityOptions: Array<{ value: Priority; label: string }> = [
    { value: 'low', label: t('record.mark.todo.priorityLow') },
    { value: 'medium', label: t('record.mark.todo.priorityMedium') },
    { value: 'high', label: t('record.mark.todo.priorityHigh') },
  ]

  const handleToggleComplete = useCallback(() => {
    if (disabled) {
      return
    }

    void onChange({
      ...todoData,
      completed: !todoData.completed,
    })
  }, [disabled, onChange, todoData])

  return (
    <div className="flex h-8 w-full min-w-0 flex-wrap items-center gap-x-6 gap-y-2 overflow-hidden">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground/70">状态</span>
        <button
          type="button"
          disabled={disabled}
          onClick={handleToggleComplete}
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
            todoData.completed
              ? "font-medium text-success hover:text-success/80"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {todoData.completed ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-3.5 w-3.5" />
          )}
          {todoData.completed ? t('record.mark.todo.completed') : t('record.mark.todo.uncompleted')}
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground/70">{t('record.mark.todo.priority')}</span>
        <div className="flex min-w-0 items-center gap-0.5">
          {priorityOptions.map((option) => {
            const active = option.value === todoData.priority

            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => void onChange({ ...todoData, priority: option.value })}
                className={cn(
                  "h-5 rounded-md px-1.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
                  active
                    ? cn("font-medium", TODO_PRIORITY_SELECTED_CLASSES[option.value])
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TextRecordMeta({ content }: { content: string }) {
  const { charCount, lineCount } = getTextContentStats(content)

  return (
    <div className="flex h-8 min-w-0 items-center">
      <span className="truncate text-xs text-muted-foreground">
        {charCount > 0 ? `${charCount} 字 · ${lineCount} 行` : '空内容'}
      </span>
    </div>
  )
}

function MarkDetailToolbar({
  mark,
  onClose,
}: {
  mark: Mark
  onClose: () => void
}) {
  const t = useTranslations()
  const fallbackTitle = t(`record.mark.type.${mark.type}`)
  const [titleValue, setTitleValue] = useState(() => getEditableTitle(mark, fallbackTitle))
  const [isRegeneratingDesc, setIsRegeneratingDesc] = useState(false)
  const [destructiveAction, setDestructiveAction] = useState<'delete' | 'deleteForever' | null>(null)
  const {
    marks,
    updateMark,
    fetchMarks,
    fetchAllMarks,
    fetchAllTrashMarks,
    clearActiveMark,
    setActiveMarkId,
  } = useMarkStore()
  const { tags, fetchTags, getCurrentTag } = useTagStore()
  const addTab = useArticleStore((state) => state.addTab)
  const removeTab = useArticleStore((state) => state.removeTab)
  const setActiveTabId = useArticleStore((state) => state.setActiveTabId)
  const setActiveFilePath = useArticleStore((state) => state.setActiveFilePath)
  const isTrashMark = mark.deleted === 1
  const canOpenSource = canOpenMarkSource(mark)
  const filteredTags = useMemo(() => tags.filter((tag) => tag.id !== mark.tagId), [mark.tagId, tags])
  const shouldShowTitleInput = mark.type !== 'text' && mark.type !== 'todo'
  const todoData = useMemo(() => mark.type === 'todo' ? parseTodoMarkContent(mark) : null, [mark])
  const canMoveTag = !isTrashMark && filteredTags.length > 0
  const canCopyLink = Boolean(mark.url)
  const canRegenerateDesc = !isTrashMark && mark.type !== 'text' && mark.type !== 'todo' && Boolean(mark.content?.trim())

  useEffect(() => {
    setTitleValue(getEditableTitle(mark, fallbackTitle))
  }, [fallbackTitle, mark])

  useEffect(() => {
    if (tags.length === 0) {
      void fetchTags()
    }
  }, [fetchTags, tags.length])

  const nextMark = useMemo(() => {
    const visibleMarks = marks.filter((item) => item.id !== mark.id)
    const currentIndex = marks.findIndex((item) => item.id === mark.id)

    if (currentIndex === -1) {
      return visibleMarks[0] ?? null
    }

    return marks[currentIndex + 1] ?? marks[currentIndex - 1] ?? null
  }, [mark.id, marks])

  const refreshMarks = useCallback(async () => {
    if (isTrashMark) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
      await fetchAllMarks()
    }
  }, [fetchAllMarks, fetchAllTrashMarks, fetchMarks, isTrashMark])

  const handleTransfer = useCallback(async (tagId: number) => {
    await updateMark({ ...mark, tagId })
    await fetchTags()
    getCurrentTag()
    await refreshMarks()
  }, [fetchTags, getCurrentTag, mark, refreshMarks, updateMark])

  const handleTitleChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = event.target.value
    setTitleValue(nextTitle)

    if (mark.type === 'todo') {
      const todoData = parseTodoMarkContent(mark)
      await updateMark({
        ...mark,
        desc: nextTitle.trim(),
        content: JSON.stringify({
          ...todoData,
          title: nextTitle,
        }),
      })
      return
    }

    if (mark.type === 'text') {
      await updateMark({
        ...mark,
        content: nextTitle,
        desc: nextTitle,
      })
      return
    }

    await updateMark({
      ...mark,
      desc: nextTitle,
    })
  }, [mark, updateMark])

  const handleTodoMetaChange = useCallback(async (nextTodoData: TodoData) => {
    if (mark.type !== 'todo') {
      return
    }

    await updateMark({
      ...mark,
      desc: nextTodoData.title.trim(),
      content: JSON.stringify(nextTodoData),
    })
    await fetchTags()
    getCurrentTag()
  }, [fetchTags, getCurrentTag, mark, updateMark])

  const handleCopyLink = useCallback(async () => {
    if (!mark.url) {
      return
    }

    await navigator.clipboard.writeText(mark.url)
    toast({ title: t('record.mark.toolbar.copied') })
  }, [mark.url, t])

  // 转为笔记：写入工作区 .md 文件并在编辑器打开（与会议"保存为笔记"同一套路径）
  const handleConvertToNote = useCallback(async () => {
    try {
      // 标题取记录内容第一行（todo 取待办标题），降级为"记录 yyyy-MM-dd HH:mm"
      const firstLine = (mark.type === 'todo'
        ? parseTodoMarkContent(mark).title
        : (mark.content || mark.desc || '').split(/\r?\n/)[0]
      ).trim()
      const fallbackName = `${t('record.mark.toolbar.noteDefaultTitle')} ${dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm')}`
      const safeTitle = (firstLine || fallbackName).replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
      const dateStr = new Date(mark.createdAt).toISOString().slice(0, 10)
      const fileName = `${safeTitle}-${dateStr}.md`
      const content = buildMarkNoteContent(mark)

      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(fileName)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      // 加入文件树并激活，触发编辑器加载新笔记
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
      await setActiveFilePath(fileName)

      toast({ description: t('record.mark.toolbar.convertToNoteSuccess') })
    } catch (error) {
      console.error('转为笔记失败:', error)
      toast({
        description: t('record.mark.toolbar.convertToNoteFailed'),
        variant: 'destructive',
      })
    }
  }, [mark, t])

  const handleRegenerateDesc = useCallback(async () => {
    if (mark.type === 'text' || !mark.content?.trim()) {
      return
    }

    setIsRegeneratingDesc(true)
    try {
      const desc = await fetchAiDesc(mark.content || '')
      if (!desc) {
        toast({
          title: t('common.error'),
          description: t('record.mark.toolbar.regenerateDesc'),
          variant: 'destructive',
        })
        return
      }

      await updateMark({ ...mark, desc })
      await refreshMarks()
      toast({
        title: t('recording.success'),
        description: t('record.mark.toolbar.regenerateDesc'),
      })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('record.mark.toolbar.regenerateDesc'),
        variant: 'destructive',
      })
    } finally {
      setIsRegeneratingDesc(false)
    }
  }, [mark, refreshMarks, t, updateMark])

  const handleOpenSource = useCallback(async (target: 'folder' | 'file') => {
    try {
      const appDir = await appDataDir()
      const action = getMarkOpenAction(mark, appDir, target)

      if (!action?.path) {
        return
      }

      if (action.mode === 'reveal') {
        await revealItemInDir(action.path)
        return
      }

      await openPath(action.path)
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }, [mark, t])

  const handleRestore = useCallback(async () => {
    await restoreMark(mark.id)
    await fetchAllTrashMarks()
    await removeTab(getRecordTabPath(mark.id))
    if (nextMark) {
      setActiveMarkId(nextMark.id)
      const recordTab = createRecordTab(nextMark, t(`record.mark.type.${nextMark.type}`))
      await addTab(recordTab)
      await setActiveTabId(recordTab.id)
      await setActiveFilePath('')
      return
    }

    clearActiveMark()
    onClose()
  }, [addTab, clearActiveMark, fetchAllTrashMarks, mark.id, nextMark, onClose, removeTab, setActiveFilePath, setActiveMarkId, setActiveTabId, t])

  const handleDelete = useCallback(async () => {
    const candidateMark = nextMark

    if (destructiveAction === 'deleteForever') {
      await delMarkForever(mark.id)
      await fetchAllTrashMarks()
    } else if (destructiveAction === 'delete') {
      await delMark(mark.id)
      await fetchMarks()
      await fetchAllMarks()
      await fetchTags()
      getCurrentTag()
    }

    setDestructiveAction(null)
    await removeTab(getRecordTabPath(mark.id))

    if (candidateMark) {
      setActiveMarkId(candidateMark.id)
      const recordTab = createRecordTab(candidateMark, t(`record.mark.type.${candidateMark.type}`))
      await addTab(recordTab)
      await setActiveTabId(recordTab.id)
      await setActiveFilePath('')
      return
    }

    clearActiveMark()
    onClose()
  }, [
    addTab,
    clearActiveMark,
    destructiveAction,
    fetchAllMarks,
    fetchAllTrashMarks,
    fetchMarks,
    fetchTags,
    getCurrentTag,
    mark.id,
    nextMark,
    onClose,
    removeTab,
    setActiveFilePath,
    setActiveMarkId,
    setActiveTabId,
    t,
  ])

  const destructiveTitle = destructiveAction === 'deleteForever'
    ? t('record.mark.toolbar.deleteForever')
    : t('record.mark.toolbar.delete')
  const destructiveDescription = destructiveAction === 'deleteForever'
    ? t('record.trash.syncWarning')
    : t('record.mark.toolbar.deleteConfirm')
  const TypeBackgroundIcon = MARK_DETAIL_TYPE_VISUALS[mark.type].icon

  return (
    <>
      <div className="shrink-0 border-b bg-background/95">
        <div className="flex min-w-0 items-center gap-5 px-5 py-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
            <TypeBackgroundIcon
              aria-hidden="true"
              className={cn("size-11", MARK_DETAIL_TYPE_VISUALS[mark.type].className)}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("shrink-0", getMarkTypeListBadgeClasses(mark.type))}>
                  {t(`record.mark.type.${mark.type}`)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                </span>
              </div>
              <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                {canMoveTag ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <TooltipButton
                        icon={<Tag className="size-4" />}
                        tooltipText={t('record.mark.toolbar.moveTag')}
                        variant="ghost"
                        size="sm"
                        buttonClassName={detailToolbarIconButtonClass}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {filteredTags.map((tagItem) => (
                        <DropdownMenuItem key={tagItem.id} onClick={() => void handleTransfer(tagItem.id)}>
                          {tagItem.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {isTrashMark ? (
                  <TooltipButton
                    icon={<RotateCcw className="size-4" />}
                    tooltipText={t('record.mark.toolbar.restore')}
                    variant="ghost"
                    size="sm"
                    buttonClassName={detailToolbarIconButtonClass}
                    onClick={handleRestore}
                  />
                ) : null}
                {canCopyLink ? (
                  <TooltipButton
                    icon={<Link className="size-4" />}
                    tooltipText={t('record.mark.toolbar.copyLink')}
                    variant="ghost"
                    size="sm"
                    buttonClassName={detailToolbarIconButtonClass}
                    onClick={handleCopyLink}
                  />
                ) : null}
                {canRegenerateDesc ? (
                  <TooltipButton
                    icon={isRegeneratingDesc ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    tooltipText={t('record.mark.toolbar.regenerateDesc')}
                    variant="ghost"
                    size="sm"
                    buttonClassName={detailToolbarIconButtonClass}
                    disabled={isRegeneratingDesc}
                    onClick={handleRegenerateDesc}
                  />
                ) : null}
                {canOpenSource ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <TooltipButton
                        icon={<FolderOpen className="size-4" />}
                        tooltipText={t('record.mark.toolbar.viewFolder')}
                        variant="ghost"
                        size="sm"
                        buttonClassName={detailToolbarIconButtonClass}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => void handleOpenSource('folder')}>
                          <FolderOpen />
                          {t('record.mark.toolbar.viewFolder')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleOpenSource('file')}>
                          <FileText />
                          {t('record.mark.toolbar.viewFile')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {!isTrashMark ? (
                  <TooltipButton
                    icon={<NotebookPen className="size-4" />}
                    tooltipText={t('record.mark.toolbar.convertToNote')}
                    variant="ghost"
                    size="sm"
                    buttonClassName={detailToolbarIconButtonClass}
                    onClick={() => void handleConvertToNote()}
                  />
                ) : null}
                <TooltipButton
                  icon={<Trash2 className="size-4" />}
                  tooltipText={isTrashMark ? t('record.mark.toolbar.deleteForever') : t('record.mark.toolbar.delete')}
                  variant="ghost"
                  size="sm"
                  buttonClassName={cn(detailToolbarIconButtonClass, "text-destructive hover:text-destructive")}
                  onClick={() => setDestructiveAction(isTrashMark ? 'deleteForever' : 'delete')}
                />
              </div>
            </div>
            {shouldShowTitleInput ? (
              <div className="flex h-8 min-w-0 items-center">
                <input
                  value={titleValue}
                  onChange={(event) => void handleTitleChange(event)}
                  disabled={isTrashMark}
                  aria-label={fallbackTitle}
                  className="h-5 w-full min-w-0 bg-transparent p-0 text-xs font-normal leading-5 text-muted-foreground outline-none placeholder:text-muted-foreground/40 focus:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : todoData ? (
              <TodoMetaControls
                todoData={todoData}
                disabled={isTrashMark}
                onChange={handleTodoMetaChange}
              />
            ) : mark.type === 'text' ? (
              <TextRecordMeta content={mark.content || ''} />
            ) : (
              <div className="h-8" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
      <AlertDialog open={destructiveAction !== null} onOpenChange={(open) => !open && setDestructiveAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{destructiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>{destructiveDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MarkMissingState({ onClose }: { onClose: () => void }) {
  const t = useTranslations()

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>{t('record.mark.empty')}</EmptyTitle>
          <EmptyDescription>{t('record.mark.loading')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function TodoDetailEditor({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const { updateMark } = useMarkStore()
  const { fetchTags, getCurrentTag } = useTagStore()
  const [todoData, setTodoData] = useState<TodoData>(() => parseTodoMarkContent(mark))

  useEffect(() => {
    setTodoData(parseTodoMarkContent(mark))
  }, [mark])

  const persistTodoData = useCallback(async (nextTodoData: TodoData) => {
    setTodoData(nextTodoData)
    await updateMark({
      ...mark,
      desc: nextTodoData.title.trim(),
      content: JSON.stringify(nextTodoData),
    })
    await fetchTags()
    getCurrentTag()
  }, [fetchTags, getCurrentTag, mark, updateMark])

  const handleDescriptionChange = useCallback((description: string) => {
    void persistTodoData({ ...todoData, description })
  }, [persistTodoData, todoData])

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden divide-y">
      <SectionBlock title="标题">
        <Input
          id="record-detail-todo-title"
          value={todoData.title}
          onChange={(event) => void persistTodoData({ ...todoData, title: event.target.value })}
          placeholder={t('record.mark.todo.titlePlaceholder')}
          className="w-full min-w-0 max-w-full"
        />
      </SectionBlock>
      <SectionBlock title="内容" contentClassName="overflow-visible">
        <div
          id="record-detail-todo-description"
          className="record-detail-markdown-editor min-h-32 w-full min-w-0 max-w-full overflow-visible bg-background"
        >
          <TipTapEditor
            initialContent={todoData.description}
            onChange={handleDescriptionChange}
            activeFilePath={getRecordTabPath(mark.id)}
            placeholder={t('record.mark.todo.descriptionPlaceholder')}
            editable={mark.deleted !== 1}
            showFooterBar={false}
            scrollable={false}
          />
        </div>
      </SectionBlock>
    </div>
  )
}

function MarkDetailBody({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const markT = useTranslations('record.mark')
  const { updateMark } = useMarkStore()
  const { primaryModel } = useSettingStore()
  const [value, setValue] = useState('')
  const [isRecognizingImage, setIsRecognizingImage] = useState(false)
  const [recognizingStage, setRecognizingStage] = useState<ImageRecognitionStage | null>(null)
  const [detailImagePreviewSrc, setDetailImagePreviewSrc] = useState('')
  const imageSrc = getImageSrc(mark)

  useEffect(() => {
    setValue(mark.content || '')
  }, [mark])

  useEffect(() => {
    setDetailImagePreviewSrc(isHttpUrl(mark.url) ? mark.url : '')
  }, [mark.url])

  const handleContentChange = useCallback(async (nextContent: string) => {
    setValue(nextContent)
    await updateMark({
      ...mark,
      content: nextContent,
      desc: mark.type === 'text'
        ? nextContent
        : mark.type === 'recording'
          ? nextContent.trim().slice(0, 100)
          : mark.desc,
    })
  }, [mark, updateMark])

  const handleRecognizeImage = useCallback(async () => {
    if (mark.type !== 'image' && mark.type !== 'scan') {
      return
    }

    setIsRecognizingImage(true)
    setRecognizingStage(null)

    try {
      const localImagePath = getLocalImagePath(mark)
      let imageUrl = mark.url

      if (localImagePath) {
        const bytes = await readFile(localImagePath, { baseDir: BaseDirectory.AppData })
        imageUrl = `data:${getImageMimeType(mark.url)};base64,${bytesToBase64(bytes)}`
      }

      const result = await recognizeImageWithFallback({
        imagePath: localImagePath,
        base64: imageUrl,
        shouldGenerateDescription: Boolean(primaryModel),
        onProgress: setRecognizingStage,
      })

      await updateMark({
        ...mark,
        content: result.content,
        desc: result.desc || result.content || t('record.capture.screenshotNoText'),
      })
      toast({
        title: t('recording.success'),
        description: t('record.capture.screenshotRecognizeAgain'),
      })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('record.capture.screenshotRecognitionFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsRecognizingImage(false)
      setRecognizingStage(null)
    }
  }, [mark, primaryModel, t, updateMark])

  if (mark.type === 'todo') {
    return <TodoDetailEditor mark={mark} />
  }

  const contentPlaceholder = imageSrc ? t('record.capture.screenshotOcrContent') : markT('content')
  const editorHeightClass = mark.type === 'text' ? 'min-h-[520px]' : 'min-h-[320px]'
  const recordEditorPath = getRecordTabPath(mark.id)

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden divide-y">
      {mark.type === 'recording' && mark.url ? (
        <SectionBlock title={t('record.mark.type.recording')}>
          <div className="w-full min-w-0 max-w-full overflow-hidden">
            <AudioPlayer audioPath={mark.url} />
          </div>
        </SectionBlock>
      ) : null}
      {imageSrc ? (
        <SectionBlock
          title={t(`record.mark.type.${mark.type}`)}
          actions={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRecognizeImage}
              disabled={isRecognizingImage}
            >
              <RefreshCw className={cn(isRecognizingImage && "animate-spin")} />
              {isRecognizingImage
                ? recognizingStage
                  ? getImageRecognitionProgressText(t, recognizingStage)
                  : t('record.capture.screenshotRecognizing')
                : t('record.capture.screenshotRecognizeAgain')}
            </Button>
          )}
        >
          <div className="flex min-h-64 w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-md bg-muted/20 p-2">
            <PhotoView src={detailImagePreviewSrc}>
              <button type="button" className="block w-full cursor-zoom-in">
                <LocalImage
                  src={imageSrc}
                  alt=""
                  onResolvedSrc={setDetailImagePreviewSrc}
                  className="max-h-[54vh] w-full max-w-full object-contain"
                />
              </button>
            </PhotoView>
          </div>
        </SectionBlock>
      ) : null}
      {mark.type === 'link' && mark.url ? (
        <SectionBlock title={t('record.mark.type.link')}>
          <a
            href={mark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-full break-all text-primary underline-offset-4 hover:underline"
          >
            {mark.url}
          </a>
        </SectionBlock>
      ) : null}
      <SectionBlock className="px-0 py-0" contentClassName="overflow-visible">
        <div
          id="record-detail-content"
          className={cn(editorHeightClass, "record-detail-markdown-editor w-full min-w-0 max-w-full overflow-visible bg-background")}
        >
          <TipTapEditor
            initialContent={value}
            onChange={handleContentChange}
            activeFilePath={recordEditorPath}
            placeholder={contentPlaceholder}
            editable={mark.deleted !== 1}
            showFooterBar={false}
            scrollable={false}
          />
        </div>
      </SectionBlock>
    </div>
  )
}

function MarkDetailView({ mark, onClose }: { mark: Mark; onClose: () => void }) {
  return (
    <PhotoPreviewProvider>
      <div className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-background">
        <MarkDetailToolbar mark={mark} onClose={onClose} />
        <ScrollArea className="h-full w-full min-w-0 flex-1">
          <div className="min-w-full max-w-full overflow-hidden">
            <MarkDetailBody mark={mark} />
          </div>
        </ScrollArea>
      </div>
    </PhotoPreviewProvider>
  )
}

export function MarkDetailPanel({ markId, onClose }: { markId: number; onClose: () => void }) {
  const { marks, allMarks, fetchAllMarks } = useMarkStore()
  const mark = useMemo(
    () => marks.find((item) => item.id === markId) ?? allMarks.find((item) => item.id === markId) ?? null,
    [allMarks, markId, marks]
  )

  useEffect(() => {
    if (!mark) {
      void fetchAllMarks()
    }
  }, [fetchAllMarks, mark])

  if (!mark) {
    return <MarkMissingState onClose={onClose} />
  }

  return <MarkDetailView mark={mark} onClose={onClose} />
}
