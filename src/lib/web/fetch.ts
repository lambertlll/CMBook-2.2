// 网页正文抓取（纯前端实现，无需 Rust 命令）：
// @tauri-apps/plugin-http 抓取 HTML（桌面/移动端一致、自动跟随重定向、绕过 WebView CORS），
// @mozilla/readability + linkedom 提取正文文本；Readability 失败时回退为标签清洗后的 body 文本。
// 输出正文限长 WEB_FETCH_MAX_CONTENT_LENGTH 字符，超出截断并标记 truncated。
// 安全约束：
// - SSRF 防护：仅允许公网 http/https 地址，拦截本机/内网地址（含重定向后的最终地址）；
// - 响应体限长 WEB_FETCH_MAX_BODY_BYTES：Content-Length 超限直接拒读，流式读取累计超限即停；
// - 超时覆盖整个请求周期（连接 + 响应头 + body 读取）。
// 已知限制：按 UTF-8 解码，GBK 等编码页面可能乱码；PDF/二进制内容不支持解析。

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { WebToolError, errorFromStatus, toWebToolError, type WebFetchResultData } from './types'
import { getWebFetchTimeoutMs } from './config'

export const WEB_FETCH_MAX_CONTENT_LENGTH = 20000
// 响应体字节上限：Content-Length 预检 + 流式读取上限共用，防止超大响应撑爆内存
export const WEB_FETCH_MAX_BODY_BYTES = 10 * 1024 * 1024 // 10MB

// SSRF 防护：拦截本机/内网地址，避免 web_fetch 被用于探测内网服务。
// 注意 URL.hostname 对 IPv6 字面量保留方括号（如 "[::1]"），比较前先剥离；
// WHATWG URL 解析器已把 IPv4 的各种写法（整数、十六进制、IPv4 映射 IPv6）归一化为点分十进制。
function assertPublicUrl(parsed: URL): void {
  let hostname = parsed.hostname.toLowerCase()
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }

  const reject = (reason: string): never => {
    throw new WebToolError('unsupported', `出于安全考虑，不允许访问本机或内网地址（${reason}）：${parsed.hostname}`)
  }

  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    reject('本机域名')
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    reject('内网域名后缀')
  }

  // IPv4 映射的 IPv6（::ffff:127.0.0.1）提取后按 IPv4 规则判定
  const v4Mapped = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  const ipv4 = v4Mapped ? v4Mapped[1] : hostname
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)) {
    const [a, b] = ipv4.split('.').map(Number)
    if (a === 0) reject('未指定地址 0.0.0.0/8')
    if (a === 127) reject('回环地址 127.0.0.0/8')
    if (a === 10) reject('私网地址 10.0.0.0/8')
    if (a === 172 && b >= 16 && b <= 31) reject('私网地址 172.16.0.0/12')
    if (a === 192 && b === 168) reject('私网地址 192.168.0.0/16')
    if (a === 169 && b === 254) reject('链路本地地址 169.254.0.0/16')
    if (a === 100 && b >= 64 && b <= 127) reject('运营商级 NAT 地址 100.64.0.0/10')
    return
  }

  // IPv6：回环(::1)、未指定(::)、唯一本地(fc00::/7)、链路本地(fe80::/10)
  if (hostname.includes(':')) {
    if (hostname === '::1' || hostname === '::') reject('IPv6 回环/未指定地址')
    const firstHextet = parseInt(hostname.split(':', 1)[0] || '0', 16)
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) reject('IPv6 唯一本地地址 fc00::/7')
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) reject('IPv6 链路本地地址 fe80::/10')
  }
}

// 分块读取响应体：累计超过 maxBytes 立即取消；读取过程纳入超时（竞速超时后取消流）
async function readBodyTextLimited(response: Response, maxBytes: number, timeoutMs: number): Promise<string> {
  const body = response.body
  if (!body) {
    // 极端环境下无流式接口时回退整体读取（Content-Length 预检仍生效）
    return response.text()
  }

  const reader = body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const chunks: Uint8Array[] = []
    let received = 0
    const timeoutGuard = new Promise<never>((_, rejectPromise) => {
      timer = setTimeout(() => {
        void reader.cancel().catch(() => undefined)
        rejectPromise(new WebToolError('timeout', `读取网页内容超时（${Math.round(timeoutMs / 1000)} 秒）`))
      }, timeoutMs)
    })

    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeoutGuard])
      if (done) break
      received += value?.byteLength ?? 0
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new WebToolError(
          'invalid-response',
          `网页内容超过 ${Math.round(maxBytes / 1024 / 1024)}MB 大小限制，已停止读取`
        )
      }
      if (value) chunks.push(value)
    }

    const merged = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8').decode(merged)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// 压缩空白：合并连续空行、去除行尾空格，便于模型消费
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 从 HTML 提取正文：优先 Readability，失败/内容过短时回退 body 纯文本
function extractContent(html: string, url: string): { title: string; content: string } {
  const { document } = parseHTML(html)

  try {
    // linkedom 的 document 与 Readability 的 DOM 类型不完全一致，做结构化断言
    const article = new Readability(document as unknown as Document).parse()
    const text = normalizeText(article?.textContent || '')
    if (article && text.length >= 100) {
      return { title: article.title || '', content: text }
    }
  } catch (error) {
    console.debug('[web_fetch] Readability 解析失败，回退纯文本提取:', error)
  }

  // 回退：剔除脚本/样式后取 body 纯文本
  const fallback = parseHTML(html).document
  fallback.querySelectorAll('script, style, noscript, template, iframe, svg').forEach((node) => node.remove())
  const title = fallback.querySelector('title')?.textContent?.trim() || ''
  const content = normalizeText(fallback.body?.textContent || '')
  if (!content) {
    throw new WebToolError('invalid-response', `页面未提取到可读文本内容：${url}`)
  }
  return { title, content }
}

// 抓取网页并提取正文文本
export async function fetchWebPage(url: string): Promise<WebFetchResultData> {
  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new WebToolError('unsupported', `无效的 URL：${trimmed}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebToolError('unsupported', `仅支持 http/https 链接：${trimmed}`)
  }
  // SSRF 防护：目标地址必须是公网地址
  assertPublicUrl(parsed)

  const timeoutMs = getWebFetchTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Awaited<ReturnType<typeof tauriFetch>>
  try {
    response = await tauriFetch(trimmed, {
      method: 'GET',
      headers: {
        // 模拟常规浏览器，降低被简单反爬拦截的概率
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      connectTimeout: timeoutMs,
    })
  } catch (error) {
    throw toWebToolError(error, `无法访问网页 ${trimmed}，请检查网络连接`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw errorFromStatus(response.status, `网页地址：${trimmed}`)
  }

  const finalUrl = response.url || trimmed
  // 插件会自动跟随重定向，公网地址可能被 302 跳到内网地址，最终地址同样需要校验
  if (finalUrl !== trimmed) {
    let finalParsed: URL
    try {
      finalParsed = new URL(finalUrl)
    } catch {
      throw new WebToolError('unsupported', `重定向后的地址无效：${finalUrl}`)
    }
    assertPublicUrl(finalParsed)
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase()

  // 非 HTML 的纯文本/JSON 直接返回内容；其他二进制类型不支持
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml')
  const isPlainText =
    contentType.includes('text/plain') || contentType.includes('application/json') || contentType.includes('text/markdown')
  if (contentType && !isHtml && !isPlainText) {
    throw new WebToolError(
      'unsupported',
      `不支持解析的内容类型（${contentType.split(';')[0]}）：${finalUrl}。目前仅支持 HTML 网页与纯文本。`
    )
  }

  // Content-Length 预检：明显超限的响应直接拒读，避免无意义传输（无此头或值不可信时由流式上限兜底）
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > WEB_FETCH_MAX_BODY_BYTES) {
    throw new WebToolError(
      'invalid-response',
      `网页内容约 ${Math.ceil(contentLength / 1024 / 1024)}MB，超过 ${Math.round(WEB_FETCH_MAX_BODY_BYTES / 1024 / 1024)}MB 大小限制，已拒绝读取：${finalUrl}`
    )
  }

  // 分块限量读取，读取阶段同样受超时约束
  const bodyText = await readBodyTextLimited(response, WEB_FETCH_MAX_BODY_BYTES, timeoutMs).catch((error) => {
    throw toWebToolError(error, `读取网页内容失败：${finalUrl}`)
  })

  let title = ''
  let content: string
  if (isPlainText) {
    content = normalizeText(bodyText)
  } else {
    const extracted = extractContent(bodyText, finalUrl)
    title = extracted.title
    content = extracted.content
  }

  const truncated = content.length > WEB_FETCH_MAX_CONTENT_LENGTH
  return {
    url: trimmed,
    finalUrl,
    title,
    content: truncated ? content.slice(0, WEB_FETCH_MAX_CONTENT_LENGTH) : content,
    truncated,
  }
}
