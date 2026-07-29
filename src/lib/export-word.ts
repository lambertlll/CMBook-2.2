/**
 * Word 导出工具：将 Markdown 转换为 Word 兼容的 HTML 并下载为 .doc 文件。
 *
 * 原理：生成带有 Office 命名空间的 HTML，以 application/msword MIME 类型保存为 .doc 文件。
 * Microsoft Word、WPS Office、LibreOffice 等均可正常打开。
 * 这种方式不需要额外的 npm 依赖，在 Tauri webview 中运行可靠。
 */

let mdRenderer: ((markdown: string) => string) | null = null

async function getMarkdownRenderer() {
  if (mdRenderer) return mdRenderer
  const MarkdownIt = (await import('markdown-it')).default
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
  mdRenderer = (text: string) => md.render(text)
  return mdRenderer
}

/**
 * 将 Markdown 转换为 Word 兼容的 HTML 文档
 */
async function markdownToWordHtml(markdown: string, title: string): Promise<string> {
  const render = await getMarkdownRenderer()
  const bodyHtml = render(markdown)

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 {
  size: 595.3pt 841.9pt;
  margin: 72pt 90pt 72pt 90pt;
}
div.WordSection1 { page: WordSection1; }
body {
  font-family: '宋体', SimSun, 'Segoe UI', sans-serif;
  font-size: 12pt;
  line-height: 1.75;
  color: #333;
}
h1 { font-size: 20pt; font-weight: bold; margin: 18pt 0 12pt; }
h2 { font-size: 16pt; font-weight: bold; margin: 16pt 0 10pt; }
h3 { font-size: 14pt; font-weight: bold; margin: 14pt 0 8pt; }
h4 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0 6pt 24pt; }
li { margin: 3pt 0; }
blockquote {
  border-left: 3pt solid #ccc;
  margin: 8pt 0;
  padding-left: 12pt;
  color: #666;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 8pt 0;
}
table th, table td {
  border: 0.5pt solid #999;
  padding: 4pt 8pt;
}
table th {
  background: #f0f0f0;
  font-weight: bold;
}
code {
  font-family: 'Courier New', monospace;
  font-size: 10.5pt;
  background: #f5f5f5;
  padding: 1pt 3pt;
}
pre {
  font-family: 'Courier New', monospace;
  font-size: 10.5pt;
  background: #f5f5f5;
  padding: 8pt;
  margin: 8pt 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}
strong { font-weight: bold; }
em { font-style: italic; }
a { color: #0563c1; text-decoration: underline; }
hr { border: none; border-top: 0.5pt solid #ccc; margin: 12pt 0; }
</style>
</head>
<body>
<div class="WordSection1">
${bodyHtml}
</div>
</body>
</html>`
}

/**
 * 下载 Blob 为文件
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 将 Markdown 内容导出为 Word 文档
 * @param markdown Markdown 正文
 * @param filename 文件名（不含扩展名）
 */
export async function exportMarkdownToWord(markdown: string, filename: string): Promise<void> {
  const wordHtml = await markdownToWordHtml(markdown, filename)
  // BOM + HTML content, application/msword 让浏览器识别为 Word 文档
  const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword' })
  downloadBlob(blob, `${filename}.doc`)
}

/**
 * 将 HTML 内容导出为 Word 文档
 * @param html HTML 正文（不含 html/head/body 标签）
 * @param filename 文件名（不含扩展名）
 */
export async function exportHtmlToWord(html: string, filename: string): Promise<void> {
  const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${filename}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 {
  size: 595.3pt 841.9pt;
  margin: 72pt 90pt 72pt 90pt;
}
div.WordSection1 { page: WordSection1; }
body {
  font-family: '宋体', SimSun, 'Segoe UI', sans-serif;
  font-size: 12pt;
  line-height: 1.75;
  color: #333;
}
h1 { font-size: 20pt; font-weight: bold; margin: 18pt 0 12pt; }
h2 { font-size: 16pt; font-weight: bold; margin: 16pt 0 10pt; }
h3 { font-size: 14pt; font-weight: bold; margin: 14pt 0 8pt; }
h4 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0 6pt 24pt; }
li { margin: 3pt 0; }
blockquote {
  border-left: 3pt solid #ccc;
  margin: 8pt 0;
  padding-left: 12pt;
  color: #666;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 8pt 0;
}
table th, table td {
  border: 0.5pt solid #999;
  padding: 4pt 8pt;
}
table th {
  background: #f0f0f0;
  font-weight: bold;
}
code {
  font-family: 'Courier New', monospace;
  font-size: 10.5pt;
  background: #f5f5f5;
  padding: 1pt 3pt;
}
pre {
  font-family: 'Courier New', monospace;
  font-size: 10.5pt;
  background: #f5f5f5;
  padding: 8pt;
  margin: 8pt 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}
strong { font-weight: bold; }
em { font-style: italic; }
a { color: #0563c1; text-decoration: underline; }
hr { border: none; border-top: 0.5pt solid #ccc; margin: 12pt 0; }
</style>
</head>
<body>
<div class="WordSection1">
${html}
</div>
</body>
</html>`
  const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword' })
  downloadBlob(blob, `${filename}.doc`)
}
