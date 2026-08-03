'use client'

/**
 * Markdown 格式工具栏：在 textarea 光标位置插入 Markdown 语法。
 * 参考笔记/会议编辑器的工具栏设计，但适配纯 textarea 编辑模式。
 */
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo, Quote, Code2, Table, Minus, Undo, Redo,
  Sparkles, Loader2, Languages, ChevronRight,
} from 'lucide-react'
import { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

// 常用翻译语言（与笔记/会议编辑器对齐）
const POPULAR_LANGUAGES = [
  { name: 'English', code: '英语' },
  { name: '日本語', code: '日语' },
  { name: '한국어', code: '韩语' },
  { name: 'Français', code: '法语' },
  { name: 'Deutsch', code: '德语' },
  { name: 'Español', code: '西班牙语' },
  { name: 'Português', code: '葡萄牙语' },
  { name: 'Русский', code: '俄语' },
  { name: 'العربية', code: '阿拉伯语' },
]

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  /** AI 改写：传入修改指令，调用方读取选区、调 LLM、替换选区（返回是否成功） */
  onAskAI?: (instruction: string) => Promise<string | null>
  /** AI 改写进行中状态（用于按钮 loading 与禁用） */
  aiProcessing?: boolean
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
  disabled,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-sm h-7 w-7 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none"
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

const Separator = () => <div className="h-5 w-px bg-border mx-1" />

export function MarkdownToolbar({ textareaRef, value, onChange, onAskAI, aiProcessing }: MarkdownToolbarProps) {
  const historyRef = useRef<string[]>([value])
  const historyIdx = useRef(0)
  const [showAiMenu, setShowAiMenu] = useState(false)
  const [showTranslateMenu, setShowTranslateMenu] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [customTranslateLang, setCustomTranslateLang] = useState('')

  // 选区 AI 改写：读选区 → 调 onAskAI → 成功则替换选区（含历史记录）
  const runAi = (instruction: string) => {
    const textarea = textareaRef.current
    if (!textarea || !onAskAI) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    if (!selectedText.trim()) {
      textarea.focus()
      alert('请先选中要改写的文字')
      return
    }
    void (async () => {
      const result = await onAskAI(instruction)
      if (!result || result === selectedText) return
      const newValue = value.substring(0, start) + result + value.substring(end)
      markInternalChange(newValue)
      onChange(newValue)
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(start, start + result.length)
      })
    })()
  }

  const pushHistory = (newVal: string) => {
    // 简单历史记录用于撤销/重做
    historyRef.current = historyRef.current.slice(0, historyIdx.current + 1)
    historyRef.current.push(newVal)
    historyIdx.current = historyRef.current.length - 1
  }

  // 标记"由内部操作触发 onChange"（格式化/AI改写），避免这些操作被再次记录
  const internalChangeRef = useRef(false)
  const markInternalChange = (newVal: string) => {
    internalChangeRef.current = true
    pushHistory(newVal)
  }

  // 监听外部 value 变化（键盘输入/AI生成等非工具栏操作）：记录到历史，保证撤销可回退打字
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (prevValueRef.current !== value) {
      if (!internalChangeRef.current) {
        pushHistory(value)
      }
      prevValueRef.current = value
      internalChangeRef.current = false
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const canUndo = historyIdx.current > 0
  const canRedo = historyIdx.current < historyRef.current.length - 1

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
      markInternalChange(newValue)
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
    markInternalChange(newValue)
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
    markInternalChange(newValue)
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
    markInternalChange(newValue)
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
      <ToolbarButton onClick={undo} title="撤销" disabled={!canUndo}>
        <Undo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={redo} title="重做" disabled={!canRedo}>
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

      <Separator />

      {/* 选中文字 AI 改写（与笔记/会议一致的预设操作） */}
      <div
        className="relative"
        onMouseEnter={() => setShowAiMenu(true)}
        onMouseLeave={() => setShowAiMenu(false)}
      >
        <ToolbarButton onClick={() => setShowAiMenu(!showAiMenu)} title="AI 改写选中文字" disabled={!onAskAI || aiProcessing}>
          {aiProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </ToolbarButton>
        {showAiMenu && (
          <div className="absolute top-full right-0 mt-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-36 z-50">
            <AiMenuButton onClick={() => { runAi('润色这段文字，语言更专业流畅，保持原意和篇幅'); setShowAiMenu(false) }}>润色</AiMenuButton>
            <AiMenuButton onClick={() => { runAi('精简这段文字，去除冗余，只保留关键信息'); setShowAiMenu(false) }}>精简</AiMenuButton>
            <AiMenuButton onClick={() => { runAi('扩写这段文字，补充合理的细节说明'); setShowAiMenu(false) }}>扩写</AiMenuButton>
            {/* 翻译子菜单 */}
            <div
              className="relative"
              onMouseEnter={() => setShowTranslateMenu(true)}
              onMouseLeave={() => setShowTranslateMenu(false)}
            >
              <AiMenuButton onClick={() => setShowTranslateMenu(!showTranslateMenu)} icon={<Languages className="w-3.5 h-3.5" />} hasSubmenu={true} submenuOpen={showTranslateMenu}>
                翻译
              </AiMenuButton>
              {showTranslateMenu && (
                <div className="absolute top-0 left-full ml-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-36 z-50 max-h-60 overflow-y-auto">
                  {POPULAR_LANGUAGES.map((lang) => (
                    <AiMenuButton key={lang.code} onClick={() => { runAi(`将这段文字翻译成${lang.code}`); setShowAiMenu(false); setShowTranslateMenu(false) }}>
                      {lang.name}
                    </AiMenuButton>
                  ))}
                  <div className="border-t border-border my-1" />
                  <div className="px-2 py-1 flex items-center gap-1">
                    <input
                      type="text"
                      value={customTranslateLang}
                      placeholder="输入语言，如：日语"
                      onChange={(e) => setCustomTranslateLang(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customTranslateLang.trim()) {
                          runAi(`将这段文字翻译成${customTranslateLang.trim()}`)
                          setShowAiMenu(false)
                          setShowTranslateMenu(false)
                          setCustomTranslateLang('')
                        } else if (e.key === 'Escape') {
                          setShowTranslateMenu(false)
                          setCustomTranslateLang('')
                        }
                      }}
                      className="w-full px-2 py-1 text-xs bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-border my-1" />
            <div className="px-2 py-1 flex items-center gap-1">
              <input
                type="text"
                value={customInstruction}
                placeholder="输入修改指令，如：改成三条待办"
                onChange={(e) => setCustomInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customInstruction.trim()) {
                    runAi(customInstruction.trim())
                    setShowAiMenu(false)
                    setCustomInstruction('')
                  } else if (e.key === 'Escape') {
                    setShowAiMenu(false)
                    setCustomInstruction('')
                  }
                }}
                className="w-full px-2 py-1 text-xs bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** AI 菜单项按钮 */
function AiMenuButton({ onClick, icon, children, hasSubmenu, submenuOpen }: {
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
  hasSubmenu?: boolean
  submenuOpen?: boolean
}) {
  return (
    <button
      className="w-full px-3 py-1 text-left text-xs hover:bg-muted flex items-center gap-2"
      onClick={onClick}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hasSubmenu && <ChevronRight className={cn('w-3 h-3 transition-transform', submenuOpen && 'rotate-90')} />}
    </button>
  )
}
