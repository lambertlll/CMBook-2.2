'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleAlert } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { getConfigHealthStatus, type ConfigHealthItem } from '@/lib/config-health'

/** A3 生成前置预检的缺项：webSearch 联网搜索 | embedding 知识库学习模型 */
export interface PrecheckMissing {
  key: 'webSearch' | 'embedding'
  // “去配置”跳转目标（与设置页 D3 健康检查横幅的跳转规则一致，共用共享函数的类型）
  target: ConfigHealthItem['target']
}

/**
 * 生成前置本地预检（A3）：
 * - 配置级判定复用共享的 getConfigHealthStatus（与设置页 D3 横幅同口径）
 * - embedding 额外做"真实可用性"试算（配置存在但 API 不可用也视为缺项）
 * 返回缺项列表，空数组表示全部就绪。
 */
export async function runGeneratePrecheck(): Promise<PrecheckMissing[]> {
  const missing: PrecheckMissing[] = []

  // 配置级检查（聊天主模型对生成不是硬依赖，这里只关心 webSearch / embedding 两项）
  const health = getConfigHealthStatus()
  const webSearchItem = health.find((h) => h.key === 'webSearch')
  if (webSearchItem && !webSearchItem.ok) {
    missing.push({ key: 'webSearch', target: webSearchItem.target })
  }

  // embedding：配置级 + 真实试算双重检查（试算失败可能是 key 失效/网络问题）
  const embeddingItem = health.find((h) => h.key === 'embeddingModel')
  if (!embeddingItem?.ok) {
    missing.push({ key: 'embedding', target: '/core/setting/rag' })
  } else {
    try {
      const { checkEmbeddingModelAvailable } = await import('@/lib/rag')
      const embeddingAvailable = await checkEmbeddingModelAvailable()
      if (!embeddingAvailable) {
        missing.push({ key: 'embedding', target: '/core/setting/rag' })
      }
    } catch {
      missing.push({ key: 'embedding', target: '/core/setting/rag' })
    }
  }

  return missing
}

/**
 * 预检缺项提示对话框（A3）：说明缺什么 + 每项「去配置」直达对应设置页 +
 * 「仍要生成」放行（不硬阻断）/「取消」。
 */
export function GeneratePrecheckDialog({
  open,
  missing,
  onOpenChange,
  onProceed,
}: {
  open: boolean
  missing: PrecheckMissing[]
  onOpenChange: (open: boolean) => void
  onProceed: () => void
}) {
  const t = useTranslations('customer')
  const router = useRouter()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('precheckTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('precheckDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* 缺项列表：每项一行，右侧「去配置」直达对应设置页 */}
        <ul className="flex flex-col gap-2">
          {missing.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="flex items-center gap-2 min-w-0">
                <CircleAlert className="w-4 h-4 shrink-0 text-warning" />
                <span className="truncate">
                  {item.key === 'webSearch'
                    ? t('precheckMissingWebSearch')
                    : t('precheckMissingEmbedding')}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  onOpenChange(false)
                  router.push(item.target)
                }}
              >
                {t('precheckGoConfig')}
              </Button>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false)
              onProceed()
            }}
          >
            {t('precheckProceed')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
