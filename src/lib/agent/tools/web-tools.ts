import { Tool, ToolResult } from '../types'
import { searchWeb } from '@/lib/web/search'
import { fetchWebPage } from '@/lib/web/fetch'
import { WebToolError } from '@/lib/web/types'

// 联网工具组（web_search / web_fetch）：
// - 只读类工具，不修改任何本地数据，注册时按 risk: 'read' 处理
// - 未启用/未配置 API Key 时返回友好错误文本引导用户去设置页，不抛异常中断 Agent
// - 搜索 provider 抽象与配置见 src/lib/web/（Tavily / 博查，baseURL 可覆盖）

function errorResult(error: unknown, fallback: string): ToolResult {
  if (error instanceof WebToolError) {
    return { success: false, error: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { success: false, error: `${fallback}: ${message}` }
}

/**
 * 联网搜索工具
 * 按设置中配置的 provider（Tavily / 博查）搜索公开互联网，返回归一化结果列表
 */
export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the public web for up-to-date information. Returns a list of results with title, URL, snippet, and optional published date. Use this when the user asks about recent events, facts, companies, or anything not available in local notes. Requires an API key configured in Settings → Web Search.',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: '搜索关键词，尽量具体（可包含时间范围描述，如"2025 年""最新"）。',
      required: true,
    },
    {
      name: 'max_results',
      type: 'number',
      description: '返回结果条数（可选）。默认使用设置值（10），上限 20。',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const query = typeof params.query === 'string' ? params.query : ''
      const maxResults = typeof params.max_results === 'number' ? params.max_results : undefined

      const { provider, results } = await searchWeb(query, maxResults)

      if (results.length === 0) {
        return {
          success: true,
          data: { provider, results: [] },
          message: `未找到与"${query}"相关的搜索结果，可以尝试更换关键词。`,
        }
      }

      // 文本化结果供模型直接消费
      const text = results
        .map((item, index) => {
          const date = item.publishedDate ? `（${item.publishedDate}）` : ''
          return `${index + 1}. ${item.title}${date}\n   ${item.url}\n   ${item.snippet}`
        })
        .join('\n\n')

      return {
        success: true,
        data: { provider, results },
        message: `搜索"${query}"找到 ${results.length} 条结果（来源：${provider === 'tavily' ? 'Tavily' : '博查'}）：\n\n${text}`,
      }
    } catch (error) {
      console.error('[web_search] 执行失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return errorResult(error, '联网搜索失败')
    }
  },
}

/**
 * 网页正文抓取工具
 * 抓取指定 URL 并提取正文文本（限长截断），供模型阅读网页内容
 */
export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch a web page by URL and extract its main text content (truncated to 20000 characters). Use this to read the full content of a specific page, e.g. a result found by web_search. Only http/https URLs are supported.',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: '要抓取的网页 URL（仅支持 http/https）。',
      required: true,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const url = typeof params.url === 'string' ? params.url : ''
      const page = await fetchWebPage(url)

      const header = [
        page.title ? `标题：${page.title}` : '',
        page.finalUrl !== page.url ? `最终地址：${page.finalUrl}` : `地址：${page.finalUrl}`,
        page.truncated ? '（正文过长，已截断为前 20000 字符）' : '',
      ]
        .filter(Boolean)
        .join('\n')

      return {
        success: true,
        data: page,
        message: `${header}\n\n${page.content}`,
      }
    } catch (error) {
      console.error('[web_fetch] 执行失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return errorResult(error, '网页抓取失败')
    }
  },
}

export const webTools: Tool[] = [
  webSearchTool,
  webFetchTool,
]
