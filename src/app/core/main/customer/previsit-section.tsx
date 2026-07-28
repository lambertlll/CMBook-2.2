'use client'

import { useCallback, useEffect, useState } from 'react'
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { useSidebarStore } from '@/stores/sidebar'
import useArticleStore from '@/stores/article'
import type { CustomerRecord } from '@/db/customers'
import type { VisitRecord } from '@/db/visits'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, FileText, Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import {
  consumeRecentlyFinished,
  requestVisitGeneration,
  useVisitGenerateStore,
} from './visit-generate-manager'
import {
  GeneratePrecheckDialog,
  runGeneratePrecheck,
  type PrecheckMissing,
} from './generate-precheck'

/** 访前产物子目录名（与客户文件夹约定一致） */
const PREVISIT_SUBFOLDER = '访前'

interface PrevisitDoc {
  name: string // 文件名
  path: string // 工作区相对路径
  modifiedAt: number // 修改时间戳（读取失败时为 0）
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

/**
 * 拜访卡片的"访前"区块：
 * - 列出 `<客户文件夹>/访前/` 下的 .md 文件（点击在编辑器打开）
 * - 「生成访前材料」按钮：生成任务交给模块级 visit-generate-manager 排队执行
 *   （组件卸载不中断；完成/失败由管理器 toast 并发事件，这里监听事件刷新列表）
 */
export function PrevisitSection({
  customer,
  visit,
}: {
  customer: CustomerRecord
  visit: VisitRecord
}) {
  const t = useTranslations('customer')
  const [docs, setDocs] = useState<PrevisitDoc[]>([])
  // 当前拜访的访前生成任务（模块级队列；running 进行中 / queued 排队中）
  const taskKey = `${visit.id}:previsit`
  const task = useVisitGenerateStore((s) =>
    s.tasks.find((task) => task.key === taskKey)
  )
  // A5 完成提醒：本区块任务刚完成时显示"新"徽标 + 高亮（消费后清除）
  const recentlyFinished = useVisitGenerateStore((s) =>
    s.recentlyFinishedKeys.includes(taskKey)
  )
  // A3 生成前置预检状态（checking 期间按钮 loading，缺项时弹确认对话框）
  const [checking, setChecking] = useState(false)
  const [precheckMissing, setPrecheckMissing] = useState<PrecheckMissing[]>([])
  const [precheckOpen, setPrecheckOpen] = useState(false)

  // A5："新"徽标 30 秒后自动消费（用户点击文档时也会立即消费，见 openDoc）
  useEffect(() => {
    if (!recentlyFinished) return
    const timer = setTimeout(() => consumeRecentlyFinished(taskKey), 30000)
    return () => clearTimeout(timer)
  }, [recentlyFinished, taskKey])

  const previsitDir = `${customer.folderPath}/${PREVISIT_SUBFOLDER}`

  /** 读取访前目录下的 .md 文件列表（按修改时间倒序） */
  const loadDocs = useCallback(async () => {
    try {
      const dirOptions = await getFilePathOptions(previsitDir)
      const entries = await readDir(
        dirOptions.path,
        dirOptions.baseDir ? { baseDir: dirOptions.baseDir } : undefined
      )
      const mdEntries = entries.filter(
        (e) => e.isFile && e.name.endsWith('.md')
      )
      const docsWithTime = await Promise.all(
        mdEntries.map(async (e): Promise<PrevisitDoc> => {
          const path = `${previsitDir}/${e.name}`
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
          return { name: e.name, path, modifiedAt }
        })
      )
      docsWithTime.sort((a, b) => b.modifiedAt - a.modifiedAt)
      setDocs(docsWithTime)
    } catch {
      // 目录不存在（被手动删除等）按空列表处理
      setDocs([])
    }
  }, [previsitDir])

  // 初次加载 + 生成完成事件刷新（管理器后台完成后通知）
  useEffect(() => {
    loadDocs()
    const onGenerated = (event: unknown) => {
      const data = event as { visitId?: string } | undefined
      if (data?.visitId === visit.id) {
        void loadDocs()
      }
    }
    emitter.on('customer-visit-doc-generated', onGenerated)
    return () => {
      emitter.off('customer-visit-doc-generated', onGenerated)
    }
  }, [loadDocs, visit.id])

  /** 在编辑器中打开访前文档（切到文件 Tab 复用文件模块的打开方式） */
  const openDoc = async (path: string) => {
    // A5：用户已查看产物，消费掉"新"徽标
    consumeRecentlyFinished(taskKey)
    try {
      const sidebar = useSidebarStore.getState()
      if (!sidebar.leftSidebarVisible) {
        await sidebar.toggleLeftSidebar()
      }
      await useSidebarStore.getState().setLeftSidebarTab('files')
      await useArticleStore.getState().setActiveFilePath(path)
    } catch (err) {
      console.error('[PrevisitSection] 打开访前文档失败:', err)
      toast({ description: t('previsitOpenFailed'), variant: 'destructive' })
    }
  }

  /** 实际发起生成：任务交给模块级管理器排队执行（失败/完成由管理器反馈） */
  const proceedGenerate = async () => {
    // 确保右栏可见（当前在客户 Tab，右栏即 Chat 面板）
    const sidebar = useSidebarStore.getState()
    if (!sidebar.rightSidebarVisible) {
      await sidebar.toggleRightSidebar()
    }

    const result = requestVisitGeneration({ customer, visit, kind: 'previsit' })
    if (result === 'started') {
      toast({ description: t('previsitSentToast') })
    } else if (result === 'queued') {
      toast({ description: t('generateQueuedToast') })
    }
  }

  /** 生成访前材料：先本地预检（A3），缺项弹确认对话框（可放行），全部就绪直接生成 */
  const handleGenerate = async () => {
    if (checking) return
    setChecking(true)
    try {
      const missing = await runGeneratePrecheck()
      if (missing.length > 0) {
        setPrecheckMissing(missing)
        setPrecheckOpen(true)
        return
      }
      await proceedGenerate()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      className={
        recentlyFinished
          ? 'rounded border border-primary/50 bg-card p-2 ring-1 ring-primary/30'
          : 'rounded border bg-card p-2'
      }
    >
      <div className="flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5 text-primary" />
        <span className="text-sm font-medium">{t('stagePreTitle')}</span>
        {recentlyFinished && (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
            {t('newBadge')}
          </Badge>
        )}
      </div>

      {/* 访前文档列表（点击在编辑器打开） */}
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-1">
          {t('previsitEmptyCoach')}
        </p>
      ) : (
        <div className="flex flex-col mt-1">
          {docs.map((doc) => (
            <button
              key={doc.path}
              type="button"
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent"
              onClick={() => openDoc(doc.path)}
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
          ))}
        </div>
      )}

      {/* 生成访前材料（生成期间 loading，排队时显示排队态；完成/失败由管理器处理）。
          仅计划型拜访（尚未有会议/笔记归档）显示：归档型拜访已完成拜访，无需访前材料 */}
      {!visit.meetingId && !visit.noteDocPath && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 h-7 w-full text-sm"
          disabled={!!task || checking}
          onClick={handleGenerate}
        >
          {task || checking ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 mr-1" />
          )}
          {task
            ? task.status === 'queued'
              ? t('generateQueued')
              : t('previsitGenerating')
            : t('previsitGenerate')}
        </Button>
      )}

      {/* A3 预检缺项确认对话框（「去配置」直达设置页 /「仍要生成」放行） */}
      <GeneratePrecheckDialog
        open={precheckOpen}
        missing={precheckMissing}
        onOpenChange={setPrecheckOpen}
        onProceed={proceedGenerate}
      />
    </div>
  )
}
