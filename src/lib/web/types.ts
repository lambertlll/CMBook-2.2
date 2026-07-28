// 联网搜索/抓取的公共类型定义

export type WebSearchProviderId = 'tavily' | 'bocha'

export const WEB_SEARCH_PROVIDERS: WebSearchProviderId[] = ['tavily', 'bocha']

// 归一化后的单条搜索结果
export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

// 网页正文抓取结果
export interface WebFetchResultData {
  url: string
  finalUrl: string
  title: string
  content: string
  truncated: boolean
}

// 错误分类：用于给模型/用户返回可操作的提示
export type WebErrorKind =
  | 'disabled' // 功能未启用
  | 'not-configured' // 未配置 API Key
  | 'auth' // 鉴权失败（401/403）
  | 'rate-limit' // 限流（429）
  | 'timeout' // 超时
  | 'network' // 网络错误（DNS、连接失败等）
  | 'http' // 其他 HTTP 错误
  | 'invalid-response' // 响应格式异常
  | 'unsupported' // 不支持的输入（协议、内容类型等）

export class WebToolError extends Error {
  kind: WebErrorKind
  status?: number

  constructor(kind: WebErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'WebToolError'
    this.kind = kind
    this.status = status
  }
}

// 把未知异常归一化为 WebToolError（网络层兜底）
export function toWebToolError(error: unknown, fallback: string): WebToolError {
  if (error instanceof WebToolError) {
    return error
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new WebToolError('timeout', `请求超时：${fallback}`)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new WebToolError('network', `${fallback}：${message}`)
}

// 按 HTTP 状态码分类错误
export function errorFromStatus(status: number, detail: string): WebToolError {
  if (status === 401 || status === 403) {
    return new WebToolError('auth', `API Key 鉴权失败（HTTP ${status}），请检查设置中的搜索 API Key 是否正确。${detail}`, status)
  }
  if (status === 429) {
    return new WebToolError('rate-limit', `搜索服务限流（HTTP 429），请稍后重试。${detail}`, status)
  }
  return new WebToolError('http', `搜索服务请求失败（HTTP ${status}）。${detail}`, status)
}
