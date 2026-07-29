'use client'

/**
 * Markdown 格式工具栏：在 textarea 光标位置插入 Markdown 语法。
 * 参考笔记/会议编辑器的工具栏设计，但适配纯 textarea 编辑模式。
 */
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo, Quote, Code2, Table, Minus, Undo, Redo,
} from 'lucide-react'
import { useRef } from 'react'

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
}

interface InsertAction {
  type: 'wrap' | 'line' | 'insert'
  prefix?: string
  suffix?: string
  text?: string
  placeholder?: string
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-sm h-7 w-7 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

const Separator = () => <div className="h-5 w-px bg-border mx-1" />

export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const historyRef = useRef<string[]>([value])
  const historyIdx = useRef(0)

  const pushHistory = (newVal: string) => {
    // 简单历史记录用于撤销/重做
    historyRef.current = historyRef.current.slice(0, historyIdx.current + 1)
    historyRef.current.push(newVal)
    historyIdx.current = historyRef.current.length - 1
  }

  const undo = () => {
    if (historyIdx.current > 0) {
      historyIdx.current--
      onChange(historyRef.current[historyIdx.current])
    }
  }

  const redo = () => {
    if (historyIdx.current < historyRef.current.length - 1) {
      historyIdx.current++
      onChange(historyRef.current[historyIdx.current])
    }
  }

  const applyAction = (action: InsertAction) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    const beforeText = value.substring(0, start)
    const afterText = value.substring(end)

    let insertText = ''
    let newCursorStart = start
    let newCursorEnd = start

    if (action.type === 'wrap') {
      const placeholder = action.placeholder || '文本'
      const content = selectedText || placeholder
      insertText = `${action.prefix || ''}${content}${action.suffix || ''}`
      newCursorStart = start + (action.prefix?.length || 0)
      newCursorEnd = newCursorStart + content.length
    } else if (action.type === 'line') {
      const placeholder = action.placeholder || '列表项'
      // 在行首插入前缀
      const lineStart = beforeText.lastIndexOf('\n') + 1
      const prefix = action.prefix || ''
      insertText = value.substring(0, lineStart) + prefix + value.substring(lineStart)
      // 替换选中内容
      if (selectedText) {
        insertText = value.substring(0, lineStart) + prefix + selectedText + value.substring(end)
      } else {
        insertText = value.substring(0, lineStart) + prefix + placeholder + value.substring(end)
      }
      newCursorStart = lineStart + prefix.length
      newCursorEnd = newCursorStart + (selectedText || placeholder).length
      const newValue = insertText
      pushHistory(newValue)
      onChange(newValue)
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(newCursorStart, newCursorEnd)
      })
      return
    } else if (action.type === 'insert') {
      insertText = action.text || ''
      newCursorStart = start + insertText.length
      newCursorEnd = newCursorStart
    }

    const newValue = beforeText + insertText + afterText
    pushHistory(newValue)
    onChange(newValue)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorStart, newCursorEnd)
    })
  }

  const insertTable = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const beforeText = value.substring(0, start)
    const afterText = value.substring(start)
    const table = '\n| 列1 | 列2 | 列3 |\n|------|------|------|\n| 内容 | 内容 | 内容 |\n'
    const newValue = beforeText + table + afterText
    pushHistory(newValue)
    onChange(newValue)
    requestAnimationFrame(() => {
      textarea.focus()
      const pos = start + table.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  const insertDivider = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const beforeText = value.substring(0, start)
    const afterText = value.substring(start)
    const divider = '\n---\n'
    const newValue = beforeText + divider + afterText
    pushHistory(newValue)
    onChange(newValue)
    requestAnimationFrame(() => {
      textarea.focus()
      const pos = start + divider.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="flex items-center gap-0.5 px-2 h-10 bg-muted/50 border-b border-border overflow-x-auto shrink-0">
      {/* 撤销/重做 */}
      <ToolbarButton onClick={undo} title="撤销">
        <Undo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={redo} title="重做">
        <Redo className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      {/* 标题 */}
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '# ', placeholder: '标题' })} title="标题 1">
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '## ', placeholder: '标题' })} title="标题 2">
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '### ', placeholder: '标题' })} title="标题 3">
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      {/* 加粗/斜体/删除线 */}
      <ToolbarButton onClick={() => applyAction({ type: 'wrap', prefix: '**', suffix: '**', placeholder: '加粗' })} title="加粗">
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'wrap', prefix: '*', suffix: '*', placeholder: '斜体' })} title="斜体">
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'wrap', prefix: '~~', suffix: '~~', placeholder: '删除线' })} title="删除线">
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      {/* 列表 */}
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '- ', placeholder: '列表项' })} title="无序列表">
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '1. ', placeholder: '列表项' })} title="有序列表">
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '- [ ] ', placeholder: '待办项' })} title="待办列表">
        <ListTodo className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      {/* 引用/代码 */}
      <ToolbarButton onClick={() => applyAction({ type: 'line', prefix: '> ', placeholder: '引用' })} title="引用">
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => applyAction({ type: 'wrap', prefix: '`', suffix: '`', placeholder: '代码' })} title="行内代码">
        <Code2 className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      {/* 表格/分割线 */}
      <ToolbarButton onClick={insertTable} title="表格">
        <Table className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={insertDivider} title="分割线">
        <Minus className="h-4 w-4" />
      </ToolbarButton>
    </div>
  )
}
