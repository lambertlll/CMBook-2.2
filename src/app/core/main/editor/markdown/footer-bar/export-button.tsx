'use client'

import { Editor } from '@tiptap/react'
import { Download, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'
import {
  exportMarkdownSource,
  getMarkdownExportBaseName,
  type MarkdownExportFormat,
} from '../markdown-export'

interface ExportButtonProps {
  editor: Editor
}

export function ExportButton({ editor }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [exporting, setExporting] = useState<MarkdownExportFormat | null>(null)

  const showPdfExportStart = useCallback(() => {
    toast({
      title: '正在导出 PDF',
      description: '长篇文档可能需要一些时间，请稍候。',
    })
  }, [])

  const runExport = useCallback(async (format: MarkdownExportFormat) => {
    try {
      setExporting(format)

      const activeFilePath = useArticleStore.getState().activeFilePath
      const exported = await exportMarkdownSource(
        format,
        {
          baseName: getMarkdownExportBaseName(activeFilePath),
          markdown: () => editor.getMarkdown(),
          html: () => editor.getHTML(),
          json: () => editor.getJSON(),
          pdfElement: () => document.querySelector('.tiptap') || document.querySelector('.ProseMirror'),
          sourcePath: activeFilePath,
        },
        { onPdfRenderStart: showPdfExportStart },
      )

      if (exported) {
        toast({ title: format === 'pdf' ? 'PDF 导出成功' : '导出成功' })
      }
    } catch (error) {
      console.error(`${format} export failed:`, error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
      setIsOpen(false)
    }
  }, [editor, showPdfExportStart])

  const handleExport = useCallback((format: MarkdownExportFormat) => {
    void runExport(format)
  }, [runExport])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="导出"
          className="p-1 rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-0"
          disabled={exporting !== null}
        >
          <Download className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('markdown')
          }}
        >
          <FileText size={12} />
          <span>Markdown</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('html')
          }}
        >
          <FileCode size={12} />
          <span>HTML</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('json')
          }}
        >
          <FileJson size={12} />
          <span>JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('pdf')
          }}
        >
          <FileText size={12} />
          <span>PDF</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
