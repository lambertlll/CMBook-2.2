'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Type } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  APP_FONT_GENERIC_FAMILIES,
  APP_FONT_SYSTEM_VALUE,
  getAppFontFamilyCss,
  loadSystemFontFamilies,
} from '@/lib/font-settings'
import useSettingStore from '@/stores/setting'

interface FontOption {
  value: string
  label: string
  previewFamily: string
}

const STATUS_OPTION_LOADING = '__notegen_font_loading__'
const STATUS_OPTION_UNAVAILABLE = '__notegen_font_unavailable__'

export function FontFamilySettings() {
  const t = useTranslations('settings.general.interface')
  const { appFontFamily, setAppFontFamily } = useSettingStore()
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadFonts() {
      setIsLoading(true)
      const fonts = await loadSystemFontFamilies()

      if (!cancelled) {
        setSystemFonts(fonts)
        setIsLoading(false)
      }
    }

    void loadFonts()

    return () => {
      cancelled = true
    }
  }, [])

  const defaultOptions = useMemo<FontOption[]>(() => [
    {
      value: APP_FONT_SYSTEM_VALUE,
      label: t('fontFamily.options.system'),
      previewFamily: getAppFontFamilyCss(APP_FONT_SYSTEM_VALUE),
    },
  ], [t])

  const genericOptions = useMemo<FontOption[]>(() => (
    APP_FONT_GENERIC_FAMILIES.map((family) => ({
      value: family,
      label: t(`fontFamily.options.${family === 'sans-serif' ? 'sansSerif' : family}`),
      previewFamily: getAppFontFamilyCss(family),
    }))
  ), [t])

  const systemOptions = useMemo<FontOption[]>(() => {
    const options = systemFonts.map((family) => ({
      value: family,
      label: family,
      previewFamily: getAppFontFamilyCss(family),
    }))

    const knownValues = new Set([
      ...defaultOptions.map((option) => option.value),
      ...genericOptions.map((option) => option.value),
      ...options.map((option) => option.value),
    ])

    if (appFontFamily !== APP_FONT_SYSTEM_VALUE && !knownValues.has(appFontFamily)) {
      options.unshift({
        value: appFontFamily,
        label: appFontFamily,
        previewFamily: getAppFontFamilyCss(appFontFamily),
      })
    }

    return options
  }, [appFontFamily, defaultOptions, genericOptions, systemFonts])

  const handleFontChange = (fontFamily: string) => {
    void setAppFontFamily(fontFamily)
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Type /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('fontFamily.title')}</ItemTitle>
        <ItemDescription>{t('fontFamily.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select value={appFontFamily} onValueChange={handleFontChange}>
          <SelectTrigger className="w-[220px] max-w-full">
            <SelectValue placeholder={t('fontFamily.placeholder')} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectGroup>
              <SelectLabel>{t('fontFamily.groups.default')}</SelectLabel>
              {defaultOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="block truncate" style={{ fontFamily: option.previewFamily }}>
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{t('fontFamily.groups.generic')}</SelectLabel>
              {genericOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="block truncate" style={{ fontFamily: option.previewFamily }}>
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{t('fontFamily.groups.system')}</SelectLabel>
              {isLoading ? (
                <SelectItem value={STATUS_OPTION_LOADING} disabled>
                  {t('fontFamily.loading')}
                </SelectItem>
              ) : null}
              {!isLoading && systemOptions.length === 0 ? (
                <SelectItem value={STATUS_OPTION_UNAVAILABLE} disabled>
                  {t('fontFamily.noSystemFonts')}
                </SelectItem>
              ) : null}
              {systemOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="block truncate" style={{ fontFamily: option.previewFamily }}>
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </ItemActions>
    </Item>
  )
}
