// 联网搜索配置读取：
// 从 setting store 读取当前 provider、密钥（内存中为解密值）、baseURL、超时与结果条数。
// 密钥在 store.json 中以 webSearchApiKey.<provider> 加密存储（见 stores/setting.ts），
// 本模块只读内存态，不接触密文。

import useSettingStore from '@/stores/setting'
import { WebToolError, type WebSearchProviderId } from './types'

export const WEB_SEARCH_DEFAULT_BASE_URLS: Record<WebSearchProviderId, string> = {
  tavily: 'https://api.tavily.com',
  bocha: 'https://api.bochaai.com',
}

export const WEB_SEARCH_DEFAULT_MAX_RESULTS = 10
export const WEB_SEARCH_MAX_RESULTS_LIMIT = 20
export const WEB_SEARCH_DEFAULT_TIMEOUT_MS = 20000
// 超时可配置范围（秒）：防止误设过小导致频繁超时、过大导致请求长时间挂起
export const WEB_SEARCH_MIN_TIMEOUT_SECONDS = 5
export const WEB_SEARCH_MAX_TIMEOUT_SECONDS = 120

export interface ResolvedWebSearchConfig {
  provider: WebSearchProviderId
  apiKey: string
  baseURL: string
  timeoutMs: number
  maxResults: number
}

// 归一化结果条数：默认 10，上限 20
export function normalizeMaxResults(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return WEB_SEARCH_DEFAULT_MAX_RESULTS
  }
  return Math.min(Math.floor(num), WEB_SEARCH_MAX_RESULTS_LIMIT)
}

// 读取并校验当前联网搜索配置；未启用/未配置 key 时抛出带引导文案的 WebToolError
export function getWebSearchConfig(): ResolvedWebSearchConfig {
  const state = useSettingStore.getState()

  if (!state.webSearchEnabled) {
    throw new WebToolError(
      'disabled',
      '联网搜索功能未启用。请前往「设置 → 联网搜索」开启并配置搜索 API Key 后重试。'
    )
  }

  const provider = state.webSearchProvider
  const apiKey = (state.webSearchApiKeys?.[provider] || '').trim()
  if (!apiKey) {
    throw new WebToolError(
      'not-configured',
      `尚未配置 ${provider === 'tavily' ? 'Tavily' : '博查'} 的搜索 API Key。请前往「设置 → 联网搜索」配置后重试。`
    )
  }

  const customBaseURL = (state.webSearchBaseUrls?.[provider] || '').trim()
  const baseURL = (customBaseURL || WEB_SEARCH_DEFAULT_BASE_URLS[provider]).replace(/\/+$/, '')

  const timeoutMs =
    state.webSearchTimeoutMs && state.webSearchTimeoutMs > 0
      ? state.webSearchTimeoutMs
      : WEB_SEARCH_DEFAULT_TIMEOUT_MS

  return {
    provider,
    apiKey,
    baseURL,
    timeoutMs,
    maxResults: normalizeMaxResults(state.webSearchMaxResults),
  }
}

// 网页抓取超时（与搜索共用同一超时配置）
export function getWebFetchTimeoutMs(): number {
  const state = useSettingStore.getState()
  return state.webSearchTimeoutMs && state.webSearchTimeoutMs > 0
    ? state.webSearchTimeoutMs
    : WEB_SEARCH_DEFAULT_TIMEOUT_MS
}
