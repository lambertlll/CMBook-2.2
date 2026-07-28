'use client'

import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import { BellRing } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'

// 通知设置（B2-7）：待办到期系统提醒总开关。
// 开关状态与检查逻辑见 src/lib/todo-notify.ts（关闭时完全跳过检查与通知）。
export function NotifySettings() {
  const t = useTranslations('notify')
  // selector 精确订阅（AGENTS.md 约定，禁止全量订阅）
  const notifyTodoEnabled = useSettingStore((s) => s.notifyTodoEnabled)
  const setNotifyTodoEnabled = useSettingStore((s) => s.setNotifyTodoEnabled)

  return (
    <ItemGroup className="gap-4">
      <Item variant="outline">
        <ItemMedia variant="icon"><BellRing className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('todoSwitch')}</ItemTitle>
          <ItemDescription>{t('todoSwitchDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch checked={notifyTodoEnabled} onCheckedChange={setNotifyTodoEnabled} />
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
