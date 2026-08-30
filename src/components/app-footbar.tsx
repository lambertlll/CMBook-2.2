'use client'

import { Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"

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
 * 桌面端底部状态栏：左侧工作区名，右侧会议纪要模型状态（友好名，禁止技术型号）
 */
export function AppStatusBar() {
  const t = useTranslations()
  const workspacePath = useSettingStore((s) => s.workspacePath)
  const primaryModel = useSettingStore((s) => s.primaryModel)
  const aiModelList = useSettingStore((s) => s.aiModelList)

  // 工作区显示名：自定义工作区取目录名，默认工作区显示友好占位名
  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath
    : t('navigation.statusBar.defaultWorkspace')

  // 模型状态：友好名「会议纪要模型」+ 槽位显示名；未配置时提示未配置
  const modelSlotTitle = resolvePrimaryModelSlotTitle(aiModelList, primaryModel)
  const modelReady = Boolean(modelSlotTitle)

  return (
    <footer className="flex h-[30px] w-full shrink-0 items-center gap-3.5 border-t bg-background px-3.5 text-xs text-muted-foreground select-none">
      <span className="flex items-center gap-1.5 truncate">
        <Folder className="size-3 shrink-0" />
        <span className="truncate">{workspaceName}</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <span className={cn('size-[7px] rounded-full', modelReady ? 'bg-success' : 'bg-warning')} />
        {t('navigation.statusBar.meetingSummaryModel')} · {modelReady ? modelSlotTitle : t('navigation.statusBar.modelNotConfigured')}
      </span>
    </footer>
  )
}
