'use client';

import { LayoutTemplate } from "lucide-react"
import { SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from "next-intl";
import useShortcutStore from "@/stores/shortcut";
import ShortcutsInput from "./shorcut-input";
import { EditorShortcutsSection } from "./editor-shortcuts-section";

export default function ShortcutsPage() {
  const t = useTranslations('settings.shortcuts');
  const { shortcuts } = useShortcutStore()

  return <SettingType id="shortcuts" title={t('title')} desc={t('desc')} icon={<LayoutTemplate />}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold">{t('globalShortcuts.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('globalShortcuts.desc')}</p>
        </div>
        <ItemGroup className="gap-4">
          {
            shortcuts.map((shortcut) => (
              <Item key={shortcut.key} variant="outline">
                <ItemContent>
                  <ItemTitle>{t(`shortcuts.${shortcut.key}.title`)}</ItemTitle>
                  <ItemDescription>{t(`shortcuts.${shortcut.key}.desc`)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ShortcutsInput name={shortcut.key} />
                </ItemActions>
              </Item>
            ))
          }
        </ItemGroup>
      </div>
      <EditorShortcutsSection />
    </div>
  </SettingType>
}
