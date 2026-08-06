// 联网搜索 provider 抽象层：
// - SearchProvider 接口统一 search(query, options) → 归一化结果列表
// - 内置 Tavily / 博查（Bocha）两家实现，baseURL 均可覆盖
//   （后续接入"行内统一搜索网关"时新增一个 provider 实现即可，见 docs/cmbook-2.0-plan.md 待办 B1）
// 网络请求沿用仓库习惯的 @tauri-apps/plugin-http（桌面/移动端一致，绕过 WebView CORS 限制）。
//
// API 形态（2025 年核实）：
// - Tavily：POST {baseURL}/search，Authorization: Bearer <key>，body { query, max_results, search_depth }
//   响应 { results: [{ title, url, content, published_date? }] }
// - 博查：POST {baseURL}/v1/web-search，Authorization: Bearer <key>，body { query, count, freshness, summary }
//   响应 { code: 200, data: { webPages: { value: [{ name, url, snippet, datePublished? }] } } }

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import {
  WebToolError,
  errorFromStatus,
  toWebToolError,
  type WebSearchProviderId,
  type WebSearchResultItem,
} from './types'
import { getWebSearchConfig, normalizeMaxResults, type ResolvedWebSearchConfig } from './config'
import { useNetworkStore } from '@/stores/network'

export interface SearchOptions {
  apiKey: string
  baseURL: string
  timeoutMs: number
  maxResults: number
}

export interface SearchProvider {
  id: WebSearchProviderId
  label: string
  search: (query: string, options: SearchOptions) => Promise<WebSearchResultItem[]>
}

// 带超时的 POST JSON 请求；按状态码做错误分类
async function postJson(url: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await tauriFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      connectTimeout: timeoutMs,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw errorFromStatus(response.status, detail.slice(0, 200))
    }

    try {
      return await response.json()
    } catch {
      throw new WebToolError('invalid-response', '搜索服务返回了非 JSON 响应，请检查 baseURL 配置。')
    }
  } catch (error) {
    throw toWebToolError(error, '无法连接搜索服务，请检查网络或 baseURL 配置')
  } finally {
    clearTimeout(timer)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Tavily：https://docs.tavily.com/documentation/api-reference/endpoint/search
const tavilyProvider: SearchProvider = {
  id: 'tavily',
  label: 'Tavily',
  async search(query, options) {
    const payload = asRecord(
      await postJson(`${options.baseURL}/search`, options.apiKey, {
        query,
        max_results: options.maxResults,
        search_depth: 'basic',
      }, options.timeoutMs)
    )

    const results = Array.isArray(payload?.results) ? payload.results : []
    return results
      .map((item) => {
        const record = asRecord(item)
        return {
          title: asString(record?.title),
          url: asString(record?.url),
          snippet: asString(record?.content),
          publishedDate: asString(record?.published_date) || undefined,
        }
      })
      .filter((item) => item.title && item.url)
  },
}

// 博查：https://api.bochaai.com/v1/web-search
const bochaProvider: SearchProvider = {
  id: 'bocha',
  label: '博查',
  async search(query, options) {
    const payload = asRecord(
      await postJson(`${options.baseURL}/v1/web-search`, options.apiKey, {
        query,
        count: options.maxResults,
        freshness: 'noLimit',
        summary: false,
      }, options.timeoutMs)
    )

    // 博查业务错误码：code 非 200 时 message 给出原因（如余额不足、参数错误）
    if (typeof payload?.code === 'number' && payload.code !== 200) {
      const message = asString(payload.message) || asString(payload.msg)
      if (payload.code === 401 || payload.code === 403) {
        throw new WebToolError('auth', `博查 API Key 鉴权失败，请检查设置中的搜索 API Key。${message}`)
      }
      if (payload.code === 429) {
        throw new WebToolError('rate-limit', `博查搜索服务限流，请稍后重试。${message}`)
      }
      throw new WebToolError('http', `博查搜索失败（code ${payload.code}）。${message}`)
    }

    const data = asRecord(payload?.data)
    const webPages = asRecord(data?.webPages)
    // 兼容 value / webSearchValue 两种返回字段
    const values = Array.isArray(webPages?.value)
      ? webPages.value
      : Array.isArray(webPages?.webSearchValue)
        ? webPages.webSearchValue
        : []

    return values
      .map((item) => {
        const record = asRecord(item)
        return {
          title: asString(record?.name),
          url: asString(record?.url),
          snippet: asString(record?.snippet),
          publishedDate: asString(record?.datePublished) || asString(record?.dateLastCrawled) || undefined,
        }
      })
      .filter((item) => item.title && item.url)
  },
}

const providers: Record<WebSearchProviderId, SearchProvider> = {
  tavily: tavilyProvider,
  bocha: bochaProvider,
}

export function getSearchProvider(id: WebSearchProviderId): SearchProvider {
  return providers[id]
}

// 按当前设置执行联网搜索；配置缺失时抛出带引导文案的 WebToolError
export async function searchWeb(query: string, maxResults?: number): Promise<{
  provider: WebSearchProviderId
  results: WebSearchResultItem[]
}> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new WebToolError('unsupported', '搜索关键词不能为空。')
  }

  const config: ResolvedWebSearchConfig = getWebSearchConfig()
  const provider = getSearchProvider(config.provider)
  const results = await provider.search(trimmed, {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeoutMs: config.timeoutMs,
    maxResults: normalizeMaxResults(maxResults ?? config.maxResults),
  })

  // P2-1：联网搜索成功证明网络可达 → 复位离线标记（误标离线的自愈链）
  useNetworkStore.getState().markOnline()

  return { provider: config.provider, results }
}
