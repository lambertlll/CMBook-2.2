import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/enhanced-context-menu"
import { Kbd } from "@/components/ui/kbd"
import { toast } from "@/hooks/use-toast"
import useClipboardStore from "@/stores/clipboard"
import { Copy, File, Trash2, FileDown } from "lucide-react"
import { useTranslations } from "next-intl"
import type { FileSelectionEntry } from "./file-selection"
import { toClipboardItems } from "./file-selection"
import { open } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeFile } from "@tauri-apps/plugin-fs"
import { checkIsTauri } from "@/lib/check"

interface BatchSelectionContextMenuProps {
  entries: FileSelectionEntry[]
  modKey: string
  deleteKey: string
}

export function BatchSelectionContextMenu({
  entries,
  modKey,
  deleteKey,
}: BatchSelectionContextMenuProps) {
  const t = useTranslations('article.file')
  const tRecordToolbar = useTranslations('record.mark.toolbar')
  const { setClipboardItems } = useClipboardStore()
  const count = entries.length
  const allLocal = entries.every(entry => entry.isLocale)
  const clipboardItems = toClipboardItems(entries)

  function handleCopySelected() {
    setClipboardItems(clipboardItems, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  function handleCutSelected() {
    setClipboardItems(clipboardItems, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  function handleDeleteSelected() {
    window.dispatchEvent(new CustomEvent('filemanager-delete-selection'))
  }

  async function handleExportSelected() {
    if (!checkIsTauri()) return
    // 只导出本地文件（不含目录和远程文件）
    const files = entries.filter((e) => e.isFile && e.isLocale)
    if (files.length === 0) {
      toast({ description: '无可导出的本地文件' })
      return
    }
    const dir = await open({ directory: true, title: '选择导出目录' })
    if (!dir) return
    let count = 0
    for (const entry of files) {
      try {
        const content = await readTextFile(entry.path)
        const safeName = entry.name.replace(/[\\/:*?"<>|]/g, '_')
        const filePath = `${dir}/${safeName}`.replace(/[\\/]+/g, '/')
        const encoder = new TextEncoder()
        await writeFile(filePath, encoder.encode(content))
        count++
      } catch (err) {
        console.error(`[BatchExport] 导出失败: ${entry.name}`, err)
      }
    }
    if (count > 0) {
      toast({ description: `已导出 ${count} 个文件` })
    }
  }

  return (
    <>
      <ContextMenuLabel menuType="file">
        {tRecordToolbar('selectedCount', { count })}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem inset disabled={!allLocal} onClick={handleCutSelected} menuType="file">
        <File className="mr-2 h-4 w-4" />
        {t('context.cut')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}X</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!allLocal} onClick={handleCopySelected} menuType="file">
        <Copy className="mr-2 h-4 w-4" />
        {t('context.copy')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}C</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!allLocal} onClick={handleExportSelected} menuType="file">
        <FileDown className="mr-2 h-4 w-4" />
        批量导出
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        inset
        disabled={!allLocal}
        className="text-danger"
        onClick={handleDeleteSelected}
        menuType="file"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {tRecordToolbar('deleteSelected', { count })}
        <ContextMenuShortcut menuType="file">
          <Kbd>{deleteKey}</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}
