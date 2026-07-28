'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { IdCard } from 'lucide-react'
import { Input } from '@/components/ui/input'
import useSettingStore from '@/stores/setting'
import { useEffect, useState } from 'react'

/**
 * 首页欢迎条称呼设置（2.1）：自定义首页"早上好/下午好/晚上好"后面的名字，
 * 留空则按界面语言显示产品名。失焦或回车时保存（避免每按键都写盘）。
 */
export function DisplayNameSettings() {
  const t = useTranslations('settings.general.interface')
  const userDisplayName = useSettingStore((s) => s.userDisplayName)
  const setUserDisplayName = useSettingStore((s) => s.setUserDisplayName)
  const [draft, setDraft] = useState(userDisplayName)

  // 外部变化（如其他设备同步）时同步草稿
  useEffect(() => {
    setDraft(userDisplayName)
  }, [userDisplayName])

  const commit = () => {
    if (draft.trim() !== userDisplayName) {
      void setUserDisplayName(draft)
    }
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><IdCard className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('displayName.title')}</ItemTitle>
        <ItemDescription>{t('displayName.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          placeholder={t('displayName.placeholder')}
          className="w-[200px]"
          maxLength={20}
        />
      </ItemActions>
    </Item>
  )
}
