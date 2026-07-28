'use client'

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { toast } from '@/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

const COPY_FEEDBACK_TIMEOUT_MS = 1200
const AUTO_LANGUAGE_VALUE = '__auto__'

interface CodeBlockLanguageOption {
  value: string
  label: string
  shortLabel: string
}

const CODE_BLOCK_LANGUAGE_OPTIONS: CodeBlockLanguageOption[] = [
  { value: AUTO_LANGUAGE_VALUE, label: 'Auto Detect', shortLabel: 'AUTO' },
  { value: 'plaintext', label: 'Plain Text', shortLabel: 'TXT' },
  { value: 'bash', label: 'Bash', shortLabel: 'BASH' },
  { value: 'shell', label: 'Shell', shortLabel: 'SH' },
  { value: 'c', label: 'C', shortLabel: 'C' },
  { value: 'cpp', label: 'C++', shortLabel: 'C++' },
  { value: 'csharp', label: 'C#', shortLabel: 'C#' },
  { value: 'css', label: 'CSS', shortLabel: 'CSS' },
  { value: 'diff', label: 'Diff', shortLabel: 'DIFF' },
  { value: 'go', label: 'Go', shortLabel: 'GO' },
  { value: 'graphql', label: 'GraphQL', shortLabel: 'GQL' },
  { value: 'html', label: 'HTML', shortLabel: 'HTML' },
  { value: 'ini', label: 'INI', shortLabel: 'INI' },
  { value: 'java', label: 'Java', shortLabel: 'JAVA' },
  { value: 'javascript', label: 'JavaScript', shortLabel: 'JS' },
  { value: 'json', label: 'JSON', shortLabel: 'JSON' },
  { value: 'kotlin', label: 'Kotlin', shortLabel: 'KT' },
  { value: 'less', label: 'Less', shortLabel: 'LESS' },
  { value: 'lua', label: 'Lua', shortLabel: 'LUA' },
  { value: 'makefile', label: 'Makefile', shortLabel: 'MAKE' },
  { value: 'markdown', label: 'Markdown', shortLabel: 'MD' },
  { value: 'objectivec', label: 'Objective-C', shortLabel: 'OBJC' },
  { value: 'perl', label: 'Perl', shortLabel: 'PERL' },
  { value: 'php', label: 'PHP', shortLabel: 'PHP' },
  { value: 'python', label: 'Python', shortLabel: 'PY' },
  { value: 'r', label: 'R', shortLabel: 'R' },
  { value: 'ruby', label: 'Ruby', shortLabel: 'RB' },
  { value: 'rust', label: 'Rust', shortLabel: 'RS' },
  { value: 'scss', label: 'SCSS', shortLabel: 'SCSS' },
  { value: 'sql', label: 'SQL', shortLabel: 'SQL' },
  { value: 'swift', label: 'Swift', shortLabel: 'SWIFT' },
  { value: 'typescript', label: 'TypeScript', shortLabel: 'TS' },
  { value: 'yaml', label: 'YAML', shortLabel: 'YAML' },
]

const CODE_BLOCK_LANGUAGE_BY_VALUE = new Map(
  CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => [option.value, option])
)

function normalizeLanguage(language: unknown) {
  if (typeof language !== 'string') {
    return null
  }

  const trimmedLanguage = language.trim()
  return trimmedLanguage || null
}

function createCustomLanguageOption(language: string): CodeBlockLanguageOption {
  return {
    value: language,
    label: language,
    shortLabel: language.toUpperCase(),
  }
}

function getLanguageOption(language: string | null) {
  if (!language) {
    return CODE_BLOCK_LANGUAGE_BY_VALUE.get(AUTO_LANGUAGE_VALUE) ?? CODE_BLOCK_LANGUAGE_OPTIONS[0]
  }

  return CODE_BLOCK_LANGUAGE_BY_VALUE.get(language) ?? createCustomLanguageOption(language)
}

function isSelectAllShortcut(event: KeyboardEvent<HTMLElement>) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'a'
  )
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.inset = '0 auto auto 0'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command failed')
    }
  } finally {
    document.body.removeChild(textArea)
  }
}

export function CodeBlockView({ editor, node, updateAttributes, getPos }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false)
  const language = normalizeLanguage(node.attrs.language)
  const selectedLanguageValue = language ?? AUTO_LANGUAGE_VALUE
  const selectedLanguageOption = getLanguageOption(language)
  const languageOptions = CODE_BLOCK_LANGUAGE_BY_VALUE.has(selectedLanguageValue)
    ? CODE_BLOCK_LANGUAGE_OPTIONS
    : [selectedLanguageOption, ...CODE_BLOCK_LANGUAGE_OPTIONS]
  const codeText = node.textContent

  useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopied(false)
    }, COPY_FEEDBACK_TIMEOUT_MS)

    return () => window.clearTimeout(timeout)
  }, [copied])

  const restoreEditorFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      editor.commands.focus()
    })
  }, [editor])

  const selectCodeBlockContent = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : null

    if (typeof pos !== 'number') {
      editor.commands.focus()
      return
    }

    const { doc, tr } = editor.state
    const from = pos + 1
    const to = pos + node.nodeSize - 1

    editor.view.dispatch(
      tr
        .setSelection(TextSelection.create(doc, from, to))
        .scrollIntoView()
    )
    editor.view.focus()
  }, [editor, getPos, node.nodeSize])

  const handleToolbarKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!isSelectAllShortcut(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectCodeBlockContent()
  }, [selectCodeBlockContent])

  const handleLanguageChange = useCallback((value: string) => {
    updateAttributes({
      language: value === AUTO_LANGUAGE_VALUE ? null : value,
    })
    restoreEditorFocus()
  }, [restoreEditorFocus, updateAttributes])

  const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    try {
      await writeClipboardText(codeText)
      setCopied(true)
      toast({
        title: '复制成功',
        description: '已复制代码块内容',
      })
    } catch {
      toast({
        title: '复制失败',
        description: '无法复制代码块内容',
        variant: 'destructive',
      })
    } finally {
      restoreEditorFocus()
    }
  }, [codeText, restoreEditorFocus])

  return (
    <NodeViewWrapper className="code-block-wrapper" spellCheck={false}>
      <div
        className="code-block-toolbar"
        contentEditable={false}
        onKeyDown={handleToolbarKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Select value={selectedLanguageValue} onValueChange={handleLanguageChange}>
          <SelectTrigger
            className="code-block-language-trigger"
            aria-label="选择代码块语言"
            title="选择代码块语言"
          >
            <span className="code-block-language-trigger-label">
              {selectedLanguageOption.shortLabel}
            </span>
          </SelectTrigger>
          <SelectContent align="end" className="max-h-72">
            {languageOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="code-block-language-option">
                  <span className="code-block-language-option-code">{option.shortLabel}</span>
                  <span>{option.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          className="code-block-copy-button"
          title={copied ? '已复制' : '复制代码块'}
          aria-label={copied ? '已复制代码块' : '复制代码块'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre><NodeViewContent<'code'> as="code" /></pre>
    </NodeViewWrapper>
  )
}
