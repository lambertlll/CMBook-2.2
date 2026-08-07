'use client'

import { Editor } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { WordCount } from './word-count'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncTools } from '../sync/sync-tools'
import { OutlineToggle } from './outline-toggle'
import { SyncButton } from '../sync/sync-button'
import { PullButton } from '../sync/pull-button'
import { HistorySheet } from '../sync/history-sheet'
import useArticleStore from '@/stores/article'
import { isMobileDevice } from '@/lib/check'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({
  editor,
  outlineOpen,
  onToggleOutline,
}: FooterBarProps) {
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  // E3：保存状态三态指示（编辑中/保存中/已保存 HH:mm/保存失败）
  const saveState = useArticleStore((state) => state.saveState)
  const lastSavedAt = useArticleStore((state) => state.lastSavedAt)
  const isMobile = isMobileDevice()
  const fileName = activeFilePath
    ? activeFilePath.split('/').pop() || activeFilePath
    : '未命名'

  // 保存状态文案（E3）
  const saveIndicator = (() => {
    if (saveState === 'saving') {
      return { text: '保存中…', cls: 'text-muted-foreground' }
    }
    if (saveState === 'error') {
      return { text: '保存失败', cls: 'text-destructive' }
    }
    if (saveState === 'saved' && lastSavedAt > 0) {
      const d = new Date(lastSavedAt)
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return { text: `已保存 ${hhmm}`, cls: 'text-muted-foreground/70' }
    }
    return { text: '编辑中', cls: 'text-muted-foreground/70' }
  })()

  if (isMobile) {
    return (
      <div className="mobile-editor-footer h-7 flex items-center justify-between gap-3 px-3 border-t border-border bg-background text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <FileText className="size-3.5 shrink-0" />
          <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
            <span className="block min-w-0 truncate font-medium text-foreground/90">{fileName}</span>
            <div className="shrink-0">
              <WordCount editor={editor} />
            </div>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {/* E3：保存状态（移动端简短显示） */}
          <span className={`shrink-0 ${saveIndicator.cls}`}>{saveIndicator.text}</span>
          <HistorySheet editor={editor} />
          <SyncButton />
          <PullButton editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border bg-background text-xs text-muted-foreground">
      {/* Left side: Word count, Copy, Export, Outline */}
      <div className="flex items-center gap-1">
        <WordCount editor={editor} />
        <CopyButton editor={editor} />
        <ExportButton editor={editor} />
        <OutlineToggle
          editor={editor}
          outlineOpen={outlineOpen}
          onToggleOutline={onToggleOutline}
        />
        {/* E3：保存状态（编辑中/保存中/已保存 HH:mm/保存失败） */}
        <span className={`ml-1 shrink-0 ${saveIndicator.cls}`}>{saveIndicator.text}</span>
      </div>

      {/* Right side: Sync tools */}
      <SyncTools editor={editor} />
    </div>
  )
}

export default FooterBar
