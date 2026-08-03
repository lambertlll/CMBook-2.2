'use client'

import { Folder, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"
import { useEffect, useState } from "react"
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'
type DesktopSyncStatus = 'synced' | 'syncing' | 'failed' | 'waiting' | 'disabled'

// 同步状态映射：复用自动同步队列状态，规则与移动端指示点一致
function getDesktopSyncStatus(
  autoDataSyncEnabled: boolean,
  autoDataSyncState: AutoDataSyncState
): DesktopSyncStatus {
  if (!autoDataSyncEnabled) {
    return 'disabled'
  }
  if (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict') {
    return 'failed'
  }
  if (autoDataSyncState.phase === 'waiting_provider') {
    return 'waiting'
  }
  if (
    autoDataSyncState.isSyncing ||
    autoDataSyncState.phase === 'checking_remote' ||
    autoDataSyncState.phase === 'uploading' ||
    autoDataSyncState.phase === 'downloading'
  ) {
    return 'syncing'
  }
  return 'synced'
}

// 由 primaryModel 反查所属 AI 配置的用户友好槽位名（title），匹配规则与 lib/ai/utils.getAISettings 一致
function resolvePrimaryModelSlotTitle(aiModelList: { key: string; title: string; models?: { id: string }[] }[], primaryModel: string): string {
  if (!primaryModel) return ''
  for (const config of aiModelList) {
    if (config.models && config.models.length > 0) {
      let targetModel = config.models.find((model) => model.id === primaryModel)
      if (!targetModel && primaryModel.startsWith(`${config.key}-`)) {
        const originalModelId = primaryModel.substring(config.key.length + 1)
        targetModel = config.models.find((model) => model.id === originalModelId)
      }
      if (targetModel) return config.title
    } else if (config.key === primaryModel) {
      return config.title
    }
  }
  return ''
}

/**
 * 桌面端底部状态栏：左侧工作区名 + 同步状态，右侧会议纪要模型状态（友好名，禁止技术型号）
 */
export function AppStatusBar() {
  const t = useTranslations()
  const workspacePath = useSettingStore((s) => s.workspacePath)
  const autoDataSyncEnabled = useSettingStore((s) => s.autoDataSyncEnabled)
  const primaryModel = useSettingStore((s) => s.primaryModel)
  const aiModelList = useSettingStore((s) => s.aiModelList)
  const [autoDataSyncState, setAutoDataSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())

  useEffect(() => subscribeAutoDataSyncState(setAutoDataSyncState), [])

  // 工作区显示名：自定义工作区取目录名，默认工作区显示友好占位名
  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath
    : t('navigation.statusBar.defaultWorkspace')

  const syncStatus = getDesktopSyncStatus(autoDataSyncEnabled, autoDataSyncState)
  const syncText = t(`navigation.statusBar.${syncStatus === 'failed' ? 'syncFailed' : syncStatus === 'waiting' ? 'syncWaiting' : syncStatus === 'syncing' ? 'syncing' : syncStatus === 'disabled' ? 'syncDisabled' : 'synced'}`)
  const syncTextClass =
    syncStatus === 'failed' ? 'text-danger' : syncStatus === 'waiting' ? 'text-warning' : ''

  // 模型状态：友好名「会议纪要模型」+ 槽位显示名；未配置时提示未配置
  const modelSlotTitle = resolvePrimaryModelSlotTitle(aiModelList, primaryModel)
  const modelReady = Boolean(modelSlotTitle)

  return (
    <footer className="flex h-[30px] w-full shrink-0 items-center gap-3.5 border-t bg-background px-3.5 text-xs text-muted-foreground select-none">
      <span className="flex items-center gap-1.5 truncate">
        <Folder className="size-3 shrink-0" />
        <span className="truncate">{workspaceName}</span>
      </span>
      <span className={cn('flex items-center gap-1.5 shrink-0', syncTextClass)}>
        <RefreshCw className={cn('size-3 shrink-0', syncStatus === 'syncing' && 'animate-spin')} />
        {syncText}
      </span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <span className={cn('size-[7px] rounded-full', modelReady ? 'bg-success' : 'bg-warning')} />
        {t('navigation.statusBar.meetingSummaryModel')} · {modelReady ? modelSlotTitle : t('navigation.statusBar.modelNotConfigured')}
      </span>
    </footer>
  )
}