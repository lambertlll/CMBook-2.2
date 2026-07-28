'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Library,
  Upload,
  RefreshCw,
  MessageCircleQuestion,
  FileText,
  FolderOpen,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import type { CustomerRecord } from '@/db/customers'
import {
  askWithCustomerKnowledge,
  CustomerKnowledgeGroup,
  isFileIndexed,
  isKnowledgeFileIndexable,
  isKnowledgeUploadSupported,
  listCustomerKnowledgeFiles,
  getIndexedFilenameSet,
  reindexCustomerKnowledge,
  reindexSingleKnowledgeFile,
  uploadCustomerMaterialFiles,
  uploadCustomerMaterials,
  type UploadMaterialsResult,
} from '@/lib/customer-knowledge'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'
import { CollapsibleCustomerSection } from './customer-collapsible-section'

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 格式化修改时间（YYYY-MM-DD HH:mm）
function formatTime(mtime: number | null): string {
  if (!mtime) return ''
  const d = new Date(mtime)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface CustomerKnowledgeProps {
  customer: CustomerRecord
}

export function CustomerKnowledge({ customer }: CustomerKnowledgeProps) {
  const t = useTranslations('customer')
  // 失败提示统一为「步骤+原因」：步骤名复用 meeting 命名空间的导出步骤文案
  const tMeeting = useTranslations('meeting')
  const [groups, setGroups] = useState<CustomerKnowledgeGroup[]>([])
  const [indexedSet, setIndexedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [progressText, setProgressText] = useState('')
  // 正在单独重建索引的文件路径（显示行内 loading）
  const [reindexingFile, setReindexingFile] = useState<string | null>(null)
  // 拖拽上传悬停态（深度计数避免子元素间 enter/leave 抖动，与 chat-input 同思路）
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  // B1："知识库管理"折叠区（默认收起）：全部重建索引 + 单文件重建入口
  const [manageOpen, setManageOpen] = useState(false)

  // 加载文件列表与向量索引状态（客户切换时自动刷新）
  const refresh = useCallback(async () => {
    if (!customer.folderPath) {
      setGroups([])
      setIndexedSet(new Set())
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [fileGroups, indexed] = await Promise.all([
        listCustomerKnowledgeFiles(customer.folderPath),
        getIndexedFilenameSet(),
      ])
      setGroups(fileGroups)
      setIndexedSet(indexed)
    } catch (err) {
      console.error('[CustomerKnowledge] 加载知识库文件失败:', err)
      toast({ title: t('knowledgeLoadFailed'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [customer.folderPath, t])

  useEffect(() => {
    void refresh()
  }, [refresh, customer.id])

  // 拜访产物生成完成、会议纪要导出完成时自动刷新文件列表与索引徽标
  useEffect(() => {
    const customerId = customer.id
    const onGenerated = (event: unknown) => {
      const data = event as { customerId?: string } | undefined
      if (data?.customerId === customerId) {
        void refresh()
      }
    }
    emitter.on('customer-visit-doc-generated', onGenerated)
    emitter.on('customer-meeting-exported', onGenerated)
    return () => {
      emitter.off('customer-visit-doc-generated', onGenerated)
      emitter.off('customer-meeting-exported', onGenerated)
    }
  }, [customer.id, refresh])

  // 索引覆盖统计（仅统计可索引的 .md/.txt 文件；memo 避免每次渲染重复展开/过滤）
  const indexableFiles = useMemo(
    () => groups.flatMap((g) => g.files).filter((f) => isKnowledgeFileIndexable(f.name)),
    [groups]
  )
  const indexedCount = useMemo(
    () => indexableFiles.filter((f) => isFileIndexed(indexedSet, f.relativePath)).length,
    [indexableFiles, indexedSet]
  )
  // 材料总数（C1 折叠标题行的数量摘要）
  const totalFileCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.files.length, 0),
    [groups]
  )

  // 打开文件到编辑器（切到文件页 + 设为活动文件，由 editor-layout 自动建 tab）
  async function openInEditor(relativePath: string) {
    const sidebar = useSidebarStore.getState()
    await sidebar.setLeftSidebarTab('files')
    await sidebar.showCenterPanel()
    await useArticleStore.getState().setActiveFilePath(relativePath)
  }

  // 上传结果反馈（对话框上传与拖拽上传共用）
  function notifyUploadResult(result: UploadMaterialsResult) {
    if (result.canceled) return
    if (!result.embeddingAvailable && result.saved.length > 0) {
      // 已保存但未索引：提示配置 embedding 模型，不阻断
      toast({
        title: t('knowledgeUploadDone', { count: result.saved.length }),
        description: t('knowledgeUploadSavedNoEmbedding'),
      })
    } else if (result.saved.length > 0) {
      toast({ title: t('knowledgeUploadDone', { count: result.saved.length }) })
    }
    for (const failure of result.failed) {
      toast({
        title: t('knowledgeUploadFailed', { name: failure.name, error: failure.error }),
        variant: 'destructive',
      })
    }
  }

  // 上传资料
  async function handleUpload() {
    if (uploading || !customer.folderPath) return
    setUploading(true)
    setProgressText('')
    try {
      const result = await uploadCustomerMaterials(
        customer.folderPath,
        t('knowledgeUploadFilter'),
        (current, total, name) => {
          setProgressText(t('knowledgeUploading', { current, total, name }))
        }
      )
      notifyUploadResult(result)
      if (!result.canceled) await refresh()
    } catch (err) {
      console.error('[CustomerKnowledge] 上传资料失败:', err)
      toast({
        title: t('knowledgeUploadFailed', { name: '', error: String(err) }),
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      setProgressText('')
    }
  }

  // 拖拽上传（C5）：HTML5 DnD，与 file-manager/chat-input 同范式
  // （tauri.conf.json 已置 dragDropEnabled: false，OS 拖入走标准 HTML5 事件）
  function hasFileTransfer(dataTransfer: DataTransfer) {
    const items = Array.from(dataTransfer.items || [])
    return (
      items.some((item) => item.kind === 'file') ||
      (dataTransfer.files?.length ?? 0) > 0
    )
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileTransfer(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileTransfer(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileTransfer(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragOver(false)
    }
  }

  // 拖放落地：文件夹按不支持处理（不递归），不支持的扩展名 toast 提示，其余走上传管线
  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileTransfer(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)
    if (busy || !customer.folderPath) return

    const accepted: File[] = []
    const rejected: string[] = []
    const items = Array.from(e.dataTransfer.items || [])
    if (items.length > 0) {
      for (const item of items) {
        if (item.kind !== 'file') continue
        // webkitGetAsEntry 可识别拖入的是否为文件夹（Chromium/WKWebView 均支持）
        const entry = item.webkitGetAsEntry?.()
        if (entry && entry.isDirectory) {
          rejected.push(entry.name)
          continue
        }
        const file = item.getAsFile()
        if (!file) continue
        if (isKnowledgeUploadSupported(file.name)) {
          accepted.push(file)
        } else {
          rejected.push(file.name)
        }
      }
    } else {
      for (const file of Array.from(e.dataTransfer.files || [])) {
        if (isKnowledgeUploadSupported(file.name)) {
          accepted.push(file)
        } else {
          rejected.push(file.name)
        }
      }
    }

    if (rejected.length > 0) {
      toast({
        title: t('knowledgeDropUnsupported', { names: rejected.join(', ') }),
        variant: 'destructive',
      })
    }
    if (accepted.length === 0) return

    setUploading(true)
    setProgressText('')
    try {
      const result = await uploadCustomerMaterialFiles(
        customer.folderPath,
        accepted,
        (current, total, name) => {
          setProgressText(t('knowledgeUploading', { current, total, name }))
        }
      )
      notifyUploadResult(result)
      await refresh()
    } catch (err) {
      console.error('[CustomerKnowledge] 拖拽上传失败:', err)
      toast({
        title: t('knowledgeUploadFailed', { name: '', error: String(err) }),
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      setProgressText('')
    }
  }

  // 全部重建索引
  async function handleReindexAll() {
    if (reindexing || !customer.folderPath) return
    setReindexing(true)
    setProgressText('')
    try {
      const result = await reindexCustomerKnowledge(customer.folderPath, (completed, total) => {
        setProgressText(t('knowledgeReindexing', { current: completed, total }))
      })
      if (!result.embeddingAvailable) {
        toast({ title: t('knowledgeNoEmbedding'), variant: 'destructive' })
        return
      }
      toast({
        title: t('knowledgeReindexDone', { success: result.success, failed: result.failed }),
        variant: result.failed > 0 ? 'destructive' : 'default',
      })
      await refresh()
    } finally {
      setReindexing(false)
      setProgressText('')
    }
  }

  // 单文件重建索引（即导出管线 vectorize 步骤的失败重试入口；
  // 失败提示与导出 failures 语义对齐为「步骤+原因」）
  async function handleReindexFile(relativePath: string) {
    if (reindexingFile) return
    setReindexingFile(relativePath)
    try {
      const status = await reindexSingleKnowledgeFile(relativePath)
      if (status === 'no-embedding') {
        toast({ title: t('knowledgeNoEmbedding'), variant: 'destructive' })
      } else if (status === 'failed') {
        toast({
          title: t('knowledgeReindexFileFailed'),
          description: `${tMeeting('syncStepVectorize')}: ${tMeeting('syncStepGenericFailure')}`,
          variant: 'destructive',
        })
      }
      await refresh()
    } catch (err) {
      toast({
        title: t('knowledgeReindexFileFailed'),
        description: `${tMeeting('syncStepVectorize')}: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'destructive',
      })
    } finally {
      setReindexingFile(null)
    }
  }

  // 基于知识库提问：设置聊天关联文件夹并预填提示词
  async function handleAsk() {
    if (!customer.folderPath) return
    try {
      await askWithCustomerKnowledge(
        { name: customer.name, folderPath: customer.folderPath },
        t('knowledgeAskPrompt', { name: customer.name })
      )
    } catch (err) {
      console.error('[CustomerKnowledge] 基于知识库提问失败:', err)
    }
  }

  const busy = uploading || reindexing

  return (
    // 可折叠区块（C1）：标题行常驻（图标衬底+标题+材料数摘要+覆盖徽标+chevron），折叠状态按区块全局持久化；
    // 拖拽上传的 drag 事件与悬停浮层挂在折叠容器根节点上（行为与原来一致）
    <CollapsibleCustomerSection
      sectionId="knowledge"
      icon={
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Library className="w-3.5 h-3.5 text-primary" />
        </span>
      }
      title={t('knowledgeTitle')}
      summary={t('summaryMaterialCount', { count: totalFileCount })}
      headerExtra={
        indexableFiles.length > 0 ? (
          <Badge variant="secondary" className="shrink-0">
            {t('knowledgeCoverage', { indexed: indexedCount, total: indexableFiles.length })}
          </Badge>
        ) : undefined
      }
      overlay={
        // 拖拽悬停提示遮罩（pointer-events-none 不干扰 dragleave 判定）
        isDragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70">
            <p className="text-sm font-medium text-primary">
              {t('knowledgeDropHint')}
            </p>
          </div>
        ) : undefined
      }
      className={cn(
        isDragOver && 'border-dashed border-primary ring-2 ring-primary/40'
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 操作行：上传资料 / 基于知识库提问（一级）；重建索引收进下方"知识库管理"折叠区（B1） */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button size="sm" variant="outline" onClick={handleUpload} disabled={busy}>
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5 mr-1" />
          )}
          {t('knowledgeUpload')}
        </Button>
        <Button size="sm" variant="outline" onClick={handleAsk} disabled={busy}>
          <MessageCircleQuestion className="w-3.5 h-3.5 mr-1" />
          {t('knowledgeAsk')}
        </Button>
      </div>

      {/* B1 知识库管理折叠区（默认收起）：全部重建索引；展开后文件行内出现单文件重建按钮 */}
      <div className="mt-2">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setManageOpen((open) => !open)}
        >
          {manageOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          {t('knowledgeManage')}
        </button>
        {manageOpen && (
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleReindexAll}
              disabled={busy || indexableFiles.length === 0}
            >
              {reindexing ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
              )}
              {t('knowledgeReindexAll')}
            </Button>
          </div>
        )}
      </div>

      {/* 进度反馈 */}
      {progressText && (
        <p className="text-sm text-muted-foreground mt-2">{progressText}</p>
      )}

      {/* 文件分组列表 */}
      <div className="mt-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{t('knowledgeLoading')}</span>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t('knowledgeEmpty')}</p>
        ) : (
          groups.map((group) => (
            <div key={group.subfolder || '__root__'} className="mb-3 last:mb-0">
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {group.subfolder || t('knowledgeGroupRoot')}
              </p>
              <div className="flex flex-col">
                {group.files.map((file) => {
                  const indexable = isKnowledgeFileIndexable(file.name)
                  const indexed = indexable && isFileIndexed(indexedSet, file.relativePath)
                  return (
                    // B4 文件列表降噪：行内只留"文件名+修改日期"，相对路径/大小收进 title 悬浮提示
                    <div
                      key={file.relativePath}
                      className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-accent/50 group"
                      title={`${file.relativePath.slice(customer.folderPath.length + 1)} · ${formatSize(file.size)}`}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate leading-tight">{file.name}</p>
                        {file.mtime && (
                          <p className="text-xs text-muted-foreground truncate leading-tight">
                            {formatTime(file.mtime)}
                          </p>
                        )}
                      </div>
                      {indexable && (
                        <Badge
                          variant={indexed ? 'default' : 'outline'}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {indexed ? t('knowledgeIndexed') : t('knowledgeNotIndexed')}
                        </Badge>
                      )}
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-6 h-6"
                          title={t('knowledgeOpen')}
                          onClick={() => openInEditor(file.relativePath)}
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </Button>
                        {/* B1：单文件重建按钮随"知识库管理"折叠区展开后才显示 */}
                        {indexable && manageOpen && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-6 h-6"
                            title={t('knowledgeReindex')}
                            disabled={reindexingFile !== null || busy}
                            onClick={() => handleReindexFile(file.relativePath)}
                          >
                            {reindexingFile === file.relativePath ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </CollapsibleCustomerSection>
  )
}
