'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import { getConfigHealthStatus } from '@/lib/config-health'

// D3 配置健康检查横幅：三项核心配置（聊天主模型 / 知识库学习模型 / 联网搜索 key）
// 全部已配时不渲染；存在未配项时展示状态行并提供“去配置”直达入口
export function ConfigHealthBanner() {
  const t = useTranslations('settings.health')
  const router = useRouter()
  // 订阅相关字段保证配置变化时重渲染；状态判定统一走共享的 getConfigHealthStatus（与 A3 生成预检同口径）
  useSettingStore((s) => s.primaryModel)
  useSettingStore((s) => s.embeddingModel)
  useSettingStore((s) => s.webSearchEnabled)
  useSettingStore((s) => s.webSearchProvider)
  useSettingStore((s) => s.webSearchApiKeys)

  const items = getConfigHealthStatus()

  // 全部已配时横幅收起不显示
  if (items.every((item) => item.ok)) return null

  return (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Settings2 className="size-4 text-warning" />
        <h3 className="text-sm font-semibold">{t('title')}</h3>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              {item.ok ? (
                <CircleCheck className="size-4 shrink-0 text-success" />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-warning" />
              )}
              <span className="truncate">{t(`items.${item.key}`)}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {item.ok ? t('configured') : t('notConfigured')}
              </span>
            </span>
            {!item.ok && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => router.push(item.target)}
              >
                {t('goConfig')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
