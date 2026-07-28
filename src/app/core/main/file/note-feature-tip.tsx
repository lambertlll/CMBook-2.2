'use client'

import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Lightbulb, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import useArticleStore from '@/stores/article'

// 小贴士卡片关闭状态持久化 key（store.json，与向量开关等界面偏好的存储方式一致）
const TIP_DISMISSED_KEY = 'noteToCustomerTipDismissed'

/**
 * 文件侧边栏顶部的可关闭小贴士（2.3-C 可发现性提醒）：
 * 提示用户右键笔记可「归入客户知识库 / 提取待办」。
 * 关闭状态持久化到 store.json，重启不再显示；仅文件列表非空时展示。
 */
export function NoteFeatureTip() {
  const t = useTranslations('article.noteToCustomer')
  const fileTree = useArticleStore((s) => s.fileTree)
  // null = 偏好尚未加载完成，此期间不渲染，避免首次进入时闪烁
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    Store.load('store.json')
      .then((store) => store.get<boolean>(TIP_DISMISSED_KEY))
      .then((value) => {
        if (!cancelled) setDismissed(value === true)
      })
      .catch((err) => {
        console.warn('[NoteFeatureTip] 读取小贴士偏好失败:', err)
        if (!cancelled) setDismissed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDismiss() {
    // 先本地隐藏，持久化失败也只告警不打扰
    setDismissed(true)
    try {
      const store = await Store.load('store.json')
      await store.set(TIP_DISMISSED_KEY, true)
    } catch (err) {
      console.warn('[NoteFeatureTip] 保存小贴士偏好失败:', err)
    }
  }

  // 偏好未加载/已关闭/文件列表为空时不显示
  if (dismissed !== false || fileTree.length === 0) return null

  return (
    <div className="mx-2 mt-2 flex items-start gap-2 rounded-md border bg-muted/50 px-2.5 py-2">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
        {t('tip')}
      </p>
      <button
        type="button"
        aria-label={t('dismissTip')}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={handleDismiss}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
