import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { Globe, KeyRound, Link2, ListOrdered, Power, Timer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import useSettingStore from "@/stores/setting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEB_SEARCH_DEFAULT_BASE_URLS,
  WEB_SEARCH_MAX_RESULTS_LIMIT,
  WEB_SEARCH_MIN_TIMEOUT_SECONDS,
  WEB_SEARCH_MAX_TIMEOUT_SECONDS,
} from "@/lib/web/config";
import type { WebSearchProviderId } from "@/lib/web/types";

const PROVIDERS: WebSearchProviderId[] = ['tavily', 'bocha']

export function Setting() {
  const t = useTranslations('settings.websearch');
  const tCommon = useTranslations('common');
  // selector 精确订阅（AGENTS.md 约定，禁止全量订阅）
  const webSearchEnabled = useSettingStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useSettingStore((s) => s.setWebSearchEnabled);
  const webSearchProvider = useSettingStore((s) => s.webSearchProvider);
  const setWebSearchProvider = useSettingStore((s) => s.setWebSearchProvider);
  const webSearchApiKeys = useSettingStore((s) => s.webSearchApiKeys);
  const setWebSearchApiKey = useSettingStore((s) => s.setWebSearchApiKey);
  const webSearchBaseUrls = useSettingStore((s) => s.webSearchBaseUrls);
  const setWebSearchBaseUrl = useSettingStore((s) => s.setWebSearchBaseUrl);
  const webSearchMaxResults = useSettingStore((s) => s.webSearchMaxResults);
  const setWebSearchMaxResults = useSettingStore((s) => s.setWebSearchMaxResults);
  const webSearchTimeoutMs = useSettingStore((s) => s.webSearchTimeoutMs);
  const setWebSearchTimeoutMs = useSettingStore((s) => s.setWebSearchTimeoutMs);

  // API Key 输入草稿：不回显已保存的密钥明文；已配置时通过占位符提示。
  // 草稿只在失焦或点击保存时提交（加密落盘），避免每次按键都触发加密写盘
  const [keyDraft, setKeyDraft] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  // 切换 provider 时重置草稿，避免把上一个 provider 的输入带过来
  useEffect(() => {
    setKeyDraft('')
    setKeyDirty(false)
  }, [webSearchProvider])

  const savedKey = webSearchApiKeys?.[webSearchProvider] || ''
  const baseUrl = webSearchBaseUrls?.[webSearchProvider] || ''

  // 提交 API Key 草稿：仅在有改动时落盘；trim 后为空串表示清除该 provider 的密钥
  const commitKeyDraft = () => {
    if (!keyDirty) return
    setKeyDirty(false)
    void setWebSearchApiKey(webSearchProvider, keyDraft.trim())
  }

  const handleMaxResultsChange = (value: string) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return
    setWebSearchMaxResults(Math.max(1, Math.min(Math.floor(num), WEB_SEARCH_MAX_RESULTS_LIMIT)))
  }

  const handleTimeoutChange = (value: string) => {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) return
    const clamped = Math.max(WEB_SEARCH_MIN_TIMEOUT_SECONDS, Math.min(Math.floor(seconds), WEB_SEARCH_MAX_TIMEOUT_SECONDS))
    setWebSearchTimeoutMs(clamped * 1000)
  }

  return (
    <ItemGroup className="gap-4">
      <Item variant="outline">
        <ItemMedia variant="icon"><Power className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enable')}</ItemTitle>
          <ItemDescription>{t('enableDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch checked={webSearchEnabled} onCheckedChange={setWebSearchEnabled} />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><Globe className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('provider')}</ItemTitle>
          <ItemDescription>{t('providerDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={webSearchProvider} onValueChange={(value) => setWebSearchProvider(value as WebSearchProviderId)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {provider === 'tavily' ? 'Tavily' : t('bocha')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><KeyRound className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('apiKey')}</ItemTitle>
          <ItemDescription>
            {savedKey ? t('apiKeyConfigured') : t('apiKeyNotConfigured')}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Input
            type="password"
            value={keyDraft}
            onChange={(e) => {
              setKeyDraft(e.target.value)
              setKeyDirty(true)
            }}
            onBlur={commitKeyDraft}
            placeholder={savedKey ? t('apiKeyReplacePlaceholder') : t('apiKeyPlaceholder')}
            className="w-[280px]"
          />
          <Button size="sm" disabled={!keyDirty} onClick={commitKeyDraft}>
            {tCommon('save')}
          </Button>
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><Link2 className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('baseUrl')}</ItemTitle>
          <ItemDescription>{t('baseUrlDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Input
            value={baseUrl}
            onChange={(e) => setWebSearchBaseUrl(webSearchProvider, e.target.value)}
            placeholder={WEB_SEARCH_DEFAULT_BASE_URLS[webSearchProvider]}
            className="w-[280px]"
          />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><ListOrdered className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('maxResults')}</ItemTitle>
          <ItemDescription>{t('maxResultsDesc', { max: WEB_SEARCH_MAX_RESULTS_LIMIT })}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Input
            type="number"
            min={1}
            max={WEB_SEARCH_MAX_RESULTS_LIMIT}
            value={webSearchMaxResults}
            onChange={(e) => handleMaxResultsChange(e.target.value)}
            className="w-[120px]"
          />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><Timer className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('timeout')}</ItemTitle>
          <ItemDescription>
            {t('timeoutDesc', { min: WEB_SEARCH_MIN_TIMEOUT_SECONDS, max: WEB_SEARCH_MAX_TIMEOUT_SECONDS })}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Input
            type="number"
            min={WEB_SEARCH_MIN_TIMEOUT_SECONDS}
            max={WEB_SEARCH_MAX_TIMEOUT_SECONDS}
            value={Math.round(webSearchTimeoutMs / 1000)}
            onChange={(e) => handleTimeoutChange(e.target.value)}
            className="w-[120px]"
          />
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
