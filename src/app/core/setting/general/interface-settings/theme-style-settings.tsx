'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { SwatchBook } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUiThemeStore, type UiTheme } from '@/stores/ui-theme'

/**
 * 界面风格选择（2.1）：经典商务蓝（现有明暗）/ 商务藏青 / 曜石暗黑 / 东方纸韵。
 * 切换即时生效（CSS 变量），持久化在 store.json 的 uiTheme 键。
 */
export function ThemeStyleSettings() {
  const t = useTranslations('settings.general.interface')
  const uiTheme = useUiThemeStore((s) => s.uiTheme)
  const setUiTheme = useUiThemeStore((s) => s.setUiTheme)

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><SwatchBook className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('themeStyle.title')}</ItemTitle>
        <ItemDescription>{t('themeStyle.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select
          value={uiTheme}
          onValueChange={(value) => setUiTheme(value as UiTheme)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="classic">{t('themeStyle.classic')}</SelectItem>
            <SelectItem value="navy">{t('themeStyle.navy')}</SelectItem>
            <SelectItem value="obsidian">{t('themeStyle.obsidian')}</SelectItem>
            <SelectItem value="paper">{t('themeStyle.paper')}</SelectItem>
          </SelectContent>
        </Select>
      </ItemActions>
    </Item>
  )
}
