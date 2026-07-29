import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { formatWeekLabel } from '@/db/weekly-reports'
import useArticleStore from '@/stores/article'
import { exportMarkdownToWord } from '@/lib/export-word'

/**
 * 周报导出工具：复制到剪贴板 / 另存为笔记文件 / 导出为 Word。
 */

/**
 * 复制周报正文到系统剪贴板
 */
export async function copyReportToClipboard(content: string): Promise<void> {
  await navigator.clipboard.writeText(content)
}

/**
 * 将周报另存为笔记文件（Markdown）。
 * 文件名格式：周报-2026年第31周.md，保存在工作区根目录。
 * 保存后自动在文件树中刷新并打开。
 */
export async function saveReportAsNote(
  content: string,
  weekStart: number
): Promise<string> {
  const label = formatWeekLabel(weekStart)
  // 清理文件名中的非法字符
  const fileName = `周报-${label}.md`
  const relativePath = fileName

  const pathOptions = await getFilePathOptions(relativePath)
  if (pathOptions.baseDir) {
    await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  } else {
    await writeTextFile(pathOptions.path, content)
  }

  // 刷新文件树并在编辑器中打开
  const articleStore = useArticleStore.getState()
  if (articleStore.insertLocalEntry) {
    articleStore.insertLocalEntry(relativePath, false)
  }
  if (articleStore.setActiveFilePath) {
    await articleStore.setActiveFilePath(relativePath)
  }

  return relativePath
}

/**
 * 将周报导出为 Word 文档
 */
export async function exportReportToWord(
  content: string,
  weekStart: number
): Promise<void> {
  const label = formatWeekLabel(weekStart)
  const fileName = `周报-${label}`
  await exportMarkdownToWord(content, fileName)
}
