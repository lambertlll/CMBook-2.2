'use client'
import { Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_OUTLINE_POSITION, normalizeOutlinePosition, type OutlinePosition } from '@/lib/outline-preferences'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"


export default function Outline() {
  const t = useTranslations('settings.editor');
  const [enableOutline, setEnableOutline] = useState(false)
  const [outlinePosition, setOutlinePosition] = useState<OutlinePosition>(DEFAULT_OUTLINE_POSITION)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const outlinePosition = normalizeOutlinePosition(await store.get('outlinePosition'))
      const enableOutline = await store.get<boolean>('enableOutline') || false
      setEnableOutline(enableOutline)
      setOutlinePosition(outlinePosition)
    }
    init()
  }, [])

  async function setPositionHandler(state: OutlinePosition) {
    const store = await Store.load('store.json');
    await store.set('outlinePosition', state)
    setOutlinePosition(state)
  }

  async function setEnableOutlineHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('enableOutline', state)
    setEnableOutline(state)
  }

  return <ItemGroup className="gap-4">
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlineEnable')}</ItemTitle>
        <ItemDescription>{t('outlineEnableDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={enableOutline}
          onCheckedChange={setEnableOutlineHandler}
        />
      </ItemActions>
    </Item>
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('outlinePosition')}</ItemTitle>
        <ItemDescription>{t('outlinePositionDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Tabs defaultValue={DEFAULT_OUTLINE_POSITION} value={outlinePosition} onValueChange={(value) => setPositionHandler(normalizeOutlinePosition(value))}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="left">{t('outlinePositionOptions.left')}</TabsTrigger>
            <TabsTrigger value="right">{t('outlinePositionOptions.right')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </ItemActions>
    </Item>
  </ItemGroup>
}
