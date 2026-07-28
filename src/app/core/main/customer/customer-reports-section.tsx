'use client'

import { useCallback, useEffect, useState } from 'react'
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'
import { openPath } from '@tauri-apps/plugin-opener'
import {
  getDefaultArticleAbsolutePath,
  getFilePathOptions,
} from '@/lib/workspace'
import { useSidebarStore } from '@/stores/sidebar'
import useArticleStore from '@/stores/article'
import type { CustomerRecord } from '@/db/customers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileBarChart, FileDown, FileText, Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import {
  consumeRecentlyFinished,
  requestVisitGeneration,
  useVisitGenerateStore,
  type VisitGenerateKind,
} from './visit-generate-manager'
import {
  GeneratePrecheckDialog,
  runGeneratePrecheck,
  type PrecheckMissing,
} from './generate-precheck'
import { CollapsibleCustomerSection } from './customer-collapsible-section'

/** 访后产物子目录名（与客户文件夹约定一致；报告提升到客户级后仍写入该目录） */
const POSTVISIT_SUBFOLDER = '访后'

/** 本区块的生成类型：财报分析 / 审贷会材料（客户级任务，模块级队列串行执行） */
type GenerateKind = Extract<VisitGenerateKind, 'financial' | 'credit'>

interface ReportDoc {
  name: string // 文件名
  path: string // 工作区相对路径
  modifiedAt: number // 修改时间戳（读取失败时为 0）
  isMarkdown: boolean // .md 进编辑器打开，.docx 用系统方式打开
}

/** 本地日期时间 YYYY-MM-DD HH:mm */
function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

/** 把工作区相对路径解析为绝对路径（pandoc 与系统打开需要；自定义工作区本身即绝对路径） */
async function resolveAbsolutePath(relativePath: string): Promise<string> {
  const options = await getFilePathOptions(relativePath)
  if (!options.baseDir) {
    return options.path
  }
  return await getDefaultArticleAbsolutePath(relativePath)
}

/**
 * 客户级"客户报告"区块（已选客户视图，档案卡/任务横条之下、拜访时间线之上）：
 * - 「生成财报分析」「生成审贷会材料」：客户级生成任务交给模块级 visit-generate-manager
 *   排队串行执行（任务 key 为 `${customerId}:${kind}`，visitId 为空），组件卸载不中断；
 *   完成/失败由管理器 toast 并发事件，这里监听事件刷新列表
 * - 列出 `<客户文件夹>/访后/` 下全部报告文件（.md 点击在编辑器打开，.docx 用系统方式打开）
 * - 每行 .md 报告带「导出 Word」按钮：检测 pandoc 后用 pandoc 转换，无 pandoc 时明确提示
 */
export function CustomerReportsSection({
  customer,
}: {
  customer: CustomerRecord
}) {
  const t = useTranslations('customer')
  const [docs, setDocs] = useState<ReportDoc[]>([])
  // 当前客户的两类生成任务（模块级队列；running 进行中 / queued 排队中）
  const financialTask = useVisitGenerateStore((s) =>
    s.tasks.find((task) => task.key === `${customer.id}:financial`)
  )
  const creditTask = useVisitGenerateStore((s) =>
    s.tasks.find((task) => task.key === `${customer.id}:credit`)
  )
  // 正在导出 Word 的文件路径（按钮 loading）
  const [exportingPath, setExportingPath] = useState<string | null>(null)
  // A5 完成提醒：本区块两类任务任一刚完成时显示"新"徽标 + 高亮（消费后清除）
  const recentlyFinished = useVisitGenerateStore((s) =>
    s.recentlyFinishedKeys.some(
      (key) =>
        key === `${customer.id}:financial` || key === `${customer.id}:credit`
    )
  )
  // A3 生成前置预检状态（pendingKind 记录预检通过/放行后要生成的类型）
  const [checking, setChecking] = useState(false)
  const [precheckMissing, setPrecheckMissing] = useState<PrecheckMissing[]>([])
  const [precheckOpen, setPrecheckOpen] = useState(false)
  const [pendingKind, setPendingKind] = useState<GenerateKind | null>(null)

  // A5："新"徽标 30 秒后自动消费（用户点击文档时也会立即消费，见 openDoc）
  useEffect(() => {
    if (!recentlyFinished) return
    const timer = setTimeout(() => {
      consumeRecentlyFinished(`${customer.id}:financial`)
      consumeRecentlyFinished(`${customer.id}:credit`)
    }, 30000)
    return () => clearTimeout(timer)
  }, [recentlyFinished, customer.id])

  const postvisitDir = `${customer.folderPath}/${POSTVISIT_SUBFOLDER}`

  /** 读取访后目录下的 .md/.docx 报告列表（按修改时间倒序） */
  const loadDocs = useCallback(async () => {
    try {
      const dirOptions = await getFilePathOptions(postvisitDir)
      const entries = await readDir(
        dirOptions.path,
        dirOptions.baseDir ? { baseDir: dirOptions.baseDir } : undefined
      )
      const docEntries = entries.filter(
        (e) => e.isFile && (e.name.endsWith('.md') || e.name.endsWith('.docx'))
      )
      const docsWithTime = await Promise.all(
        docEntries.map(async (e): Promise<ReportDoc> => {
          const path = `${postvisitDir}/${e.name}`
          let modifiedAt = 0
          try {
            const fileOptions = await getFilePathOptions(path)
            const info = await stat(
              fileOptions.path,
              fileOptions.baseDir ? { baseDir: fileOptions.baseDir } : undefined
            )
            modifiedAt = info.mtime ? new Date(info.mtime).getTime() : 0
          } catch {
            // stat 失败不阻塞列表展示
          }
          return {
            name: e.name,
            path,
            modifiedAt,
            isMarkdown: e.name.endsWith('.md'),
          }
        })
      )
      docsWithTime.sort((a, b) => b.modifiedAt - a.modifiedAt)
      setDocs(docsWithTime)
    } catch {
      // 目录不存在（被手动删除等）按空列表处理
      setDocs([])
    }
  }, [postvisitDir])

  // 初次加载 + 该客户生成完成事件刷新（管理器后台完成后通知；客户级任务 visitId 为空）
  useEffect(() => {
    loadDocs()
    const onGenerated = (event: unknown) => {
      const data = event as { customerId?: string } | undefined
      if (data?.customerId === customer.id) {
        void loadDocs()
      }
    }
    emitter.on('customer-visit-doc-generated', onGenerated)
    return () => {
      emitter.off('customer-visit-doc-generated', onGenerated)
    }
  }, [loadDocs, customer.id])

  /** 打开报告：.md 进编辑器（复用文件模块的打开方式），.docx 用系统默认程序 */
  const openDoc = async (doc: ReportDoc) => {
    // A5：用户已查看产物，消费掉"新"徽标
    consumeRecentlyFinished(`${customer.id}:financial`)
    consumeRecentlyFinished(`${customer.id}:credit`)
    try {
      if (doc.isMarkdown) {
        const sidebar = useSidebarStore.getState()
        if (!sidebar.leftSidebarVisible) {
          await sidebar.toggleLeftSidebar()
        }
        await useSidebarStore.getState().setLeftSidebarTab('files')
        await useArticleStore.getState().setActiveFilePath(doc.path)
      } else {
        await openPath(await resolveAbsolutePath(doc.path))
      }
    } catch (err) {
      console.error('[CustomerReportsSection] 打开报告失败:', err)
      toast({ description: t('reportsOpenFailed'), variant: 'destructive' })
    }
  }

  /** 实际发起生成：客户级任务交给模块级管理器排队执行（失败/完成由管理器反馈） */
  const proceedGenerate = async (kind: GenerateKind) => {
    // 确保右栏可见（当前在客户 Tab，右栏即 Chat 面板）
    const sidebar = useSidebarStore.getState()
    if (!sidebar.rightSidebarVisible) {
      await sidebar.toggleRightSidebar()
    }

    const result = requestVisitGeneration({ customer, kind })
    if (result === 'started') {
      toast({ description: t('reportsSentToast') })
    } else if (result === 'queued') {
      toast({ description: t('generateQueuedToast') })
    }
  }

  /** 生成报告：先本地预检（A3），缺项弹确认对话框（可放行），全部就绪直接生成 */
  const handleGenerate = async (kind: GenerateKind) => {
    if (checking) return
    setChecking(true)
    try {
      const missing = await runGeneratePrecheck()
      if (missing.length > 0) {
        setPendingKind(kind)
        setPrecheckMissing(missing)
        setPrecheckOpen(true)
        return
      }
      await proceedGenerate(kind)
    } finally {
      setChecking(false)
    }
  }

  /** 导出 Word：检测 pandoc 后把 .md 报告转换为同名 .docx */
  const handleExportWord = async (doc: ReportDoc) => {
    if (exportingPath) return
    setExportingPath(doc.path)
    try {
      // 先检测 pandoc（走 skills 放开的 bash -c 通道）
      let pandocAvailable = false
      try {
        const check = await Command.create('bash', [
          '-c',
          'pandoc --version',
        ]).execute()
        pandocAvailable = check.code === 0
      } catch {
        pandocAvailable = false
      }
      if (!pandocAvailable) {
        toast({ description: t('reportsNoPandoc') })
        return
      }

      // 绝对路径给 pandoc 使用；统一转成 / 分隔，避免 Git Bash 下反斜杠转义问题
      const absMd = (await resolveAbsolutePath(doc.path)).replace(/\\/g, '/')
      const docxPath = doc.path.replace(/\.md$/, '.docx')
      const absDocx = (await resolveAbsolutePath(docxPath)).replace(
        /\\/g,
        '/'
      )

      const result = await Command.create('bash', [
        '-c',
        `pandoc "${absMd}" -o "${absDocx}" --from markdown --to docx`,
      ]).execute()
      if (result.code !== 0) {
        const reason =
          (result.stderr || result.stdout || '')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) || `exit code ${result.code}`
        toast({
          description: t('reportsExportFailed', { error: reason }),
          variant: 'destructive',
        })
        return
      }
      await loadDocs()
      toast({ description: t('reportsExportDone') })
    } catch (err) {
      console.error('[CustomerReportsSection] 导出 Word 失败:', err)
      toast({
        description: t('reportsExportFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        variant: 'destructive',
      })
    } finally {
      setExportingPath(null)
    }
  }

  /** 生成按钮的可用状态与文案（任务存在即禁用，区分排队/生成中） */
  const renderGenerateButton = (kind: GenerateKind) => {
    const task = kind === 'financial' ? financialTask : creditTask
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 flex-1 text-sm px-1"
        disabled={!!task || checking}
        onClick={() => handleGenerate(kind)}
      >
        {task || checking ? (
          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 mr-1" />
        )}
        {task
          ? task.status === 'queued'
            ? t('generateQueued')
            : t('reportsGenerating')
          : kind === 'financial'
            ? t('reportsGenerateFinancial')
            : t('reportsGenerateCredit')}
      </Button>
    )
  }

  return (
    // 可折叠区块（C1）：标题行常驻（图标衬底+标题+报告数摘要+chevron），折叠状态按区块全局持久化
    <CollapsibleCustomerSection
      sectionId="reports"
      icon={
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <FileBarChart className="w-3.5 h-3.5 text-primary" />
        </span>
      }
      title={t('reportsTitle')}
      summary={t('summaryReportCount', { count: docs.length })}
      headerExtra={
        <div className="flex shrink-0 items-center gap-1.5">
          {recentlyFinished && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              {t('newBadge')}
            </Badge>
          )}
          {renderGenerateButton('financial')}
          {renderGenerateButton('credit')}
        </div>
      }
      className={
        recentlyFinished
          ? 'border-primary/50 ring-1 ring-primary/30'
          : undefined
      }
    >
      {/* 报告文件列表（.md 进编辑器，.docx 系统打开；.md 行带导出 Word 按钮） */}
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">
          {t('reportsEmptyCoach')}
        </p>
      ) : (
        <div className="flex flex-col mt-2">
          {docs.map((doc) => (
            <div
              key={doc.path}
              className="group flex items-center rounded hover:bg-accent"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left"
                onClick={() => openDoc(doc)}
                title={doc.path}
              >
                <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm text-primary truncate">
                    {doc.name}
                  </span>
                  {doc.modifiedAt > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(doc.modifiedAt)}
                    </span>
                  )}
                </span>
              </button>
              {doc.isMarkdown && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 mr-0.5"
                  title={t('reportsExportWord')}
                  disabled={exportingPath !== null}
                  onClick={() => handleExportWord(doc)}
                >
                  {exportingPath === doc.path ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* A3 预检缺项确认对话框（「去配置」直达设置页 /「仍要生成」放行） */}
      <GeneratePrecheckDialog
        open={precheckOpen}
        missing={precheckMissing}
        onOpenChange={setPrecheckOpen}
        onProceed={() => {
          if (pendingKind) void proceedGenerate(pendingKind)
          setPendingKind(null)
        }}
      />
    </CollapsibleCustomerSection>
  )
}
