'use client'

import { save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { MarkdownManager } from '@tiptap/markdown'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import MarkdownIt from 'markdown-it'
import katex from '@traptitech/markdown-it-katex'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import bash from 'highlight.js/lib/languages/bash'
import jsonLanguage from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { checkIsTauri } from '@/lib/check'
import { getFilePathOptions } from '@/lib/workspace'
import { convertImageByWorkspace } from '@/lib/utils'
import { normalizeLatexForKatex } from '@/lib/latex'
import { resolveImagePathFromMarkdown } from '@/lib/markdown-image-path'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'

export type MarkdownExportFormat = 'markdown' | 'html' | 'json' | 'pdf'

export interface MarkdownExportSource {
  baseName: string
  markdown: string | (() => string | Promise<string>)
  html?: string | (() => string | Promise<string>)
  json?: JSONContent | (() => JSONContent | Promise<JSONContent>)
  pdfElement?: Element | null | (() => Element | null)
  sourcePath?: string
}

export interface MarkdownExportOptions {
  onPdfRenderStart?: () => void
}

const UNSUPPORTED_COLOR_FUNCTION_PATTERN = /\b(?:oklab|oklch|color-mix)\(/i
const IMAGE_LOAD_TIMEOUT_MS = 5000
const PDF_RENDER_TIMEOUT_MS = 30000

const PDF_EXPORT_STYLES = `
  html,
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #333333;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    line-height: 1.6;
  }

  #pdf-export-root {
    box-sizing: border-box;
    width: 595px;
    padding: 40px;
    background: #ffffff;
    color: #333333;
  }

  #pdf-export-root * {
    box-sizing: border-box;
  }

  #pdf-export-root h1,
  #pdf-export-root h2,
  #pdf-export-root h3,
  #pdf-export-root h4,
  #pdf-export-root h5,
  #pdf-export-root h6 {
    margin: 1.2em 0 0.55em;
    color: #111827;
    line-height: 1.25;
    font-weight: 700;
  }

  #pdf-export-root h1 { font-size: 28px; }
  #pdf-export-root h2 { font-size: 22px; }
  #pdf-export-root h3 { font-size: 18px; }
  #pdf-export-root h4 { font-size: 15px; }

  #pdf-export-root p {
    margin: 0.65em 0;
  }

  #pdf-export-root a {
    color: #0969da;
    text-decoration: underline;
  }

  #pdf-export-root blockquote {
    margin: 1em 0;
    padding: 0.2em 0 0.2em 1em;
    border-left: 4px solid #d0d7de;
    color: #57606a;
  }

  #pdf-export-root pre {
    margin: 1em 0;
    padding: 16px;
    overflow-x: auto;
    border-radius: 6px;
    background: #f6f8fa;
    color: #24292f;
    white-space: pre-wrap;
  }

  #pdf-export-root code {
    border-radius: 3px;
    background: #f6f8fa;
    color: #24292f;
    font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.92em;
    padding: 0.2em 0.4em;
  }

  #pdf-export-root pre code {
    background: transparent;
    padding: 0;
  }

  #pdf-export-root ul,
  #pdf-export-root ol {
    margin: 0.65em 0;
    padding-left: 1.6em;
  }

  #pdf-export-root li {
    margin: 0.25em 0;
  }

  #pdf-export-root ul[data-type="taskList"] {
    list-style: none;
    padding-left: 0;
  }

  #pdf-export-root ul[data-type="taskList"] li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  #pdf-export-root table {
    width: 100%;
    margin: 1em 0;
    border-collapse: collapse;
    table-layout: auto;
  }

  #pdf-export-root th,
  #pdf-export-root td {
    border: 1px solid #d0d7de;
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
    overflow-wrap: break-word;
  }

  #pdf-export-root th {
    background: #f6f8fa;
    font-weight: 600;
  }

  #pdf-export-root tr:nth-child(2n) {
    background: #fbfbfb;
  }

  #pdf-export-root img,
  #pdf-export-root svg,
  #pdf-export-root canvas {
    max-width: 100%;
    height: auto;
  }

  #pdf-export-root img {
    border-radius: 8px;
  }

  #pdf-export-root hr {
    height: 1px;
    border: 0;
    background: #d0d7de;
    margin: 1.5em 0;
  }

  #pdf-export-root mark {
    background: #fff8c5;
    color: inherit;
  }
`

const HTML_EXPORT_STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 20px;
    line-height: 1.6;
    color: #333333;
  }
  pre {
    background: #f6f8fa;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  code {
    background: #f6f8fa;
    padding: 0.2em 0.4em;
    border-radius: 3px;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
  blockquote {
    border-left: 4px solid #dfe2e5;
    margin: 0;
    padding-left: 16px;
    color: #6a737d;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  table th,
  table td {
    border: 1px solid #dfe2e5;
    padding: 8px 12px;
  }
  table th {
    background: #f6f8fa;
  }
  img {
    max-width: 100%;
    height: auto;
  }
`

let markdownRenderer: MarkdownIt | null = null
let markdownManager: MarkdownManager | null = null

export function sanitizeExportFileName(fileName: string) {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'document'
}

export function getMarkdownExportBaseName(filePath?: string) {
  const fileName = filePath
    ? filePath.split(/[\\/]/).pop() || filePath
    : 'document'

  return sanitizeExportFileName(fileName.replace(/\.[^/.\\]+$/, ''))
}

function ensureExtension(path: string, extension: string) {
  return path.toLowerCase().endsWith(`.${extension}`) ? path : `${path}.${extension}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value)
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function saveTextExport(
  content: string,
  filename: string,
  extension: string,
  mimeType: string,
  filterName: string,
) {
  if (checkIsTauri()) {
    const selectedPath = await save({
      title: '导出',
      defaultPath: filename,
      filters: [{ name: filterName, extensions: [extension] }],
    })

    if (!selectedPath) {
      return false
    }

    await writeTextFile(ensureExtension(selectedPath, extension), content)
    return true
  }

  downloadTextFile(content, filename, mimeType)
  return true
}

async function notifyPdfRenderStart(options?: MarkdownExportOptions) {
  options?.onPdfRenderStart?.()

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
}

async function savePdfExport(
  renderContent: () => Promise<Uint8Array>,
  filename: string,
  options?: MarkdownExportOptions,
) {
  if (checkIsTauri()) {
    const selectedPath = await save({
      title: '导出',
      defaultPath: filename,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })

    if (!selectedPath) {
      return false
    }

    await notifyPdfRenderStart(options)
    const content = await renderContent()
    await writeFile(ensureExtension(selectedPath, 'pdf'), content)
    return true
  }

  await notifyPdfRenderStart(options)
  const content = await renderContent()
  downloadBlob(new Blob([content]), filename)
  return true
}

function registerHighlightLanguages() {
  if (!hljs.getLanguage('javascript')) {
    hljs.registerLanguage('javascript', javascript)
  }
  if (!hljs.getLanguage('typescript')) {
    hljs.registerLanguage('typescript', typescript)
  }
  if (!hljs.getLanguage('bash')) {
    hljs.registerLanguage('bash', bash)
  }
  if (!hljs.getLanguage('json')) {
    hljs.registerLanguage('json', jsonLanguage)
  }
  if (!hljs.getLanguage('html')) {
    hljs.registerLanguage('html', xml)
  }
  if (!hljs.getLanguage('css')) {
    hljs.registerLanguage('css', css)
  }
}

function getMarkdownRenderer() {
  if (markdownRenderer) {
    return markdownRenderer
  }

  registerHighlightLanguages()

  const renderer = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (code, lang): string => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch {}
      }
      return `<pre class="hljs"><code>${renderer.utils.escapeHtml(code)}</code></pre>`
    },
  }).use(katex, {
    throwOnError: false,
    errorColor: '#cc0000',
  })

  renderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, index, options)
  }

  markdownRenderer = renderer
  return renderer
}

function getMarkdownManager() {
  if (!markdownManager) {
    markdownManager = new MarkdownManager({
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
      ],
      indentation: {
        style: 'space',
        size: 2,
      },
    })
  }

  return markdownManager
}

async function resolveMarkdownImageSources(html: string, sourcePath?: string) {
  if (!sourcePath) {
    return html
  }

  const template = document.createElement('template')
  template.innerHTML = html
  const images = Array.from(template.content.querySelectorAll('img'))

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src')
    if (!shouldTransformImageSrcToWorkspaceAsset(src)) {
      return
    }

    const fullRelativePath = resolveImagePathFromMarkdown(sourcePath, src || '')
    const assetUrl = await convertImageByWorkspace(fullRelativePath)
    image.setAttribute('src', assetUrl)
  }))

  return template.innerHTML
}

function sanitizeExportElementAttributes(root: DocumentFragment | Element) {
  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll<Element>('*'))]
    : Array.from(root.querySelectorAll<Element>('*'))

  elements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (
        attribute.name.toLowerCase().startsWith('on') ||
        UNSUPPORTED_COLOR_FUNCTION_PATTERN.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name)
      }
    })
  })
}

function sanitizeExportHtml(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content
    .querySelectorAll('script, style, link')
    .forEach((element) => element.remove())
  sanitizeExportElementAttributes(template.content)
  return template.innerHTML
}

function preparePdfExportHtml(editorElement: Element) {
  const clone = editorElement.cloneNode(true) as HTMLElement

  clone
    .querySelectorAll('script, style, link, .image-resize-handle, .tableResizeHandle, .ProseMirror-gapcursor, .ProseMirror-widget')
    .forEach((element) => element.remove())

  clone.querySelectorAll<HTMLElement>('[contenteditable], [spellcheck], [data-resize-state]').forEach((element) => {
    element.removeAttribute('contenteditable')
    element.removeAttribute('spellcheck')
    element.removeAttribute('data-resize-state')
  })

  clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = true
  })

  sanitizeExportElementAttributes(clone)

  return clone.innerHTML
}

function createPdfRenderFrame(content: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '595px'
  iframe.style.height = '1px'
  iframe.style.border = '0'
  iframe.style.pointerEvents = 'none'

  document.body.appendChild(iframe)

  const frameDocument = iframe.contentDocument
  if (!frameDocument) {
    document.body.removeChild(iframe)
    throw new Error('PDF render frame unavailable')
  }

  frameDocument.open()
  frameDocument.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base href="${escapeHtmlAttribute(document.baseURI)}" />
    <style>${PDF_EXPORT_STYLES}</style>
  </head>
  <body>
    <main id="pdf-export-root">${sanitizeExportHtml(content)}</main>
  </body>
</html>`)
  frameDocument.close()

  return iframe
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function waitForTimeout(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, timeoutMs)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then((value) => {
        window.clearTimeout(timeout)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timeout)
        reject(error)
      })
  })
}

async function waitForImage(image: HTMLImageElement) {
  image.loading = 'eager'

  if (image.complete) {
    return
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      image.onload = () => resolve()
      image.onerror = () => resolve()
    }),
    waitForTimeout(IMAGE_LOAD_TIMEOUT_MS),
  ])
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(images.map(waitForImage))
}

async function getValue<T>(value: T | (() => T | Promise<T>)) {
  if (typeof value === 'function') {
    return await (value as () => T | Promise<T>)()
  }

  return value
}

function buildHtmlDocument(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${HTML_EXPORT_STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}

async function renderMarkdownToHtml(markdown: string, sourcePath?: string, resolveImages = false) {
  const html = getMarkdownRenderer().render(normalizeLatexForKatex(markdown))
  if (!resolveImages) {
    return html
  }

  return await resolveMarkdownImageSources(html, sourcePath)
}

async function renderSourcePdf(source: MarkdownExportSource) {
  const pdfElement = typeof source.pdfElement === 'function'
    ? source.pdfElement()
    : source.pdfElement

  const html = pdfElement
    ? preparePdfExportHtml(pdfElement)
    : await renderMarkdownToHtml(await getValue(source.markdown), source.sourcePath, true)

  const iframe = createPdfRenderFrame(html)

  try {
    const frameDocument = iframe.contentDocument
    const container = frameDocument?.getElementById('pdf-export-root')
    if (!container) {
      throw new Error('PDF render container unavailable')
    }

    await waitForAnimationFrame()
    await waitForImages(container)
    const renderHeight = Math.max(container.scrollHeight, container.offsetHeight, 842)
    iframe.style.height = `${renderHeight}px`

    const canvas = await withTimeout(
      html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 595,
        windowHeight: renderHeight,
        imageTimeout: IMAGE_LOAD_TIMEOUT_MS,
      }),
      PDF_RENDER_TIMEOUT_MS,
      'PDF 渲染超时，请检查文档中是否包含无法加载的图片',
    )

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    })

    const imgWidth = 595
    const pageHeight = 842
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    document.body.removeChild(iframe)
  }
}

export async function exportMarkdownSource(
  format: MarkdownExportFormat,
  source: MarkdownExportSource,
  options?: MarkdownExportOptions,
) {
  const fileName = getMarkdownExportBaseName(source.baseName)

  if (format === 'markdown') {
    return await saveTextExport(
      await getValue(source.markdown),
      `${fileName}.md`,
      'md',
      'text/markdown',
      'Markdown Files',
    )
  }

  if (format === 'html') {
    const html = source.html
      ? await getValue(source.html)
      : buildHtmlDocument(
        fileName,
        await renderMarkdownToHtml(await getValue(source.markdown), source.sourcePath),
      )

    return await saveTextExport(
      html,
      `${fileName}.html`,
      'html',
      'text/html',
      'HTML Files',
    )
  }

  if (format === 'json') {
    const jsonContent = source.json
      ? await getValue(source.json)
      : getMarkdownManager().parse(await getValue(source.markdown))

    return await saveTextExport(
      JSON.stringify(jsonContent, null, 2),
      `${fileName}.json`,
      'json',
      'application/json',
      'JSON Files',
    )
  }

  return await savePdfExport(
    () => renderSourcePdf(source),
    `${fileName}.pdf`,
    options,
  )
}

export async function exportMarkdownFile(
  format: MarkdownExportFormat,
  filePath: string,
  options?: MarkdownExportOptions,
) {
  const pathOptions = await getFilePathOptions(filePath)
  const readMarkdown = () => (
    pathOptions.baseDir
      ? readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : readTextFile(pathOptions.path)
  )

  return await exportMarkdownSource(format, {
    baseName: filePath,
    markdown: readMarkdown,
    sourcePath: filePath,
  }, options)
}
