import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/enhanced-context-menu"
import { Kbd } from "@/components/ui/kbd"
import { toast } from "@/hooks/use-toast"
import useClipboardStore from "@/stores/clipboard"
import { Copy, File, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import type { FileSelectionEntry } from "./file-selection"
import { toClipboardItems } from "./file-selection"

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
