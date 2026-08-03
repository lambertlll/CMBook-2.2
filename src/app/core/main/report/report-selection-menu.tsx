'use client'

/**
 * 周报 textarea 的选中文字浮层菜单（对齐笔记/会议的 bubble menu 交互）：
 * 选中文字后，在选区上方显示「润色/精简/扩写/翻译+自定义」操作，
 * AI 改写只作用于选中部分。textarea 无法用 TipTap BubbleMenu，
 * 这里用选区坐标估算浮层位置（textarea 单字体等宽假设，位置为近似值）。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, Minimize2, Maximize2, Languages, ChevronRight, Loader2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// 预设操作对应的 AI 指令（与会议气泡一致，固定中文 prompt）
const PRESET_INSTRUCTIONS = {
  polish: '润色这段文字，语言更专业流畅，保持原意和篇幅',
  concise: '精简这段文字，去除冗余，只保留关键信息',
  expand: '扩写这段文字，补充合理的细节说明',
} as const

// 常用翻译语言（与笔记/会议对齐）
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

interface ReportSelectionMenuProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** AI 改写执行：传入指令，读取选区并调用 LLM，成功则替换选区（返回是否成功） */
  onApply: (instruction: string) => void
  /** AI 处理中（浮层保持显示并禁用） */
  processing: boolean
  /** 滚动容器（position: relative），浮层绝对定位在其中，随内容滚动 */
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function ReportSelectionMenu({
  textareaRef,
  onApply,
  processing,
  containerRef,
}: ReportSelectionMenuProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showTranslate, setShowTranslate] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [customTranslateLang, setCustomTranslateLang] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const processingRef = useRef(processing)

  useEffect(() => {
    processingRef.current = processing
    if (!processing) {
      // 处理结束后隐藏（替换后选区变化）
      setShow(false)
      setShowTranslate(false)
      setCustomInstruction('')
      setCustomTranslateLang('')
    }
  }, [processing])

  const hideMenu = useCallback(() => {
    setShow(false)
    setShowTranslate(false)
    setCustomInstruction('')
    setCustomTranslateLang('')
  }, [])

  // 记录选区起止位置，供 AI 改写替换时使用（focus 变化可能改变 textarea 选择范围）
  const lastSelectionRef = useRef<{ start: number; end: number } | null>(null)

  const hasSelection = useCallback((): boolean => {
    const textarea = textareaRef.current
    if (!textarea) return false
    const { selectionStart, selectionEnd } = textarea
    if (selectionStart === selectionEnd) return false
    return textarea.value.substring(selectionStart, selectionEnd).trim().length > 0
  }, [textareaRef])

  const updatePosition = useCallback(() => {
    if (processingRef.current) return
    if (!hasSelection()) {
      hideMenu()
      return
    }
    const textarea = textareaRef.current
    const container = containerRef.current
    if (!textarea || !container) {
      hideMenu()
      return
    }

    // 估算选区起点坐标：textarea 单字体，用字符数×近似字符宽 + 行高
    const { selectionStart, selectionEnd } = textarea
    const value = textarea.value
    const textBefore = value.substring(0, selectionStart)
    const lines = textBefore.split('\n')
    const line = lines.length
    const col = lines[lines.length - 1].length

    const charWidth = 8.2 // 近似等宽字符宽（14px 字体约 8px）
    const lineHeight = 22 // 与 textarea 的 leading-relaxed 对应
    const textareaRect = textarea.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const relativeTop = textareaRect.top - containerRect.top + container.scrollTop + line * lineHeight
    const relativeLeft = textareaRect.left - containerRect.left + container.scrollLeft + col * charWidth

    const menuWidth = menuRef.current?.offsetWidth || 280
    const maxLeft = Math.max(0, containerRect.width - menuWidth)
    const left = Math.min(Math.max(0, relativeLeft), maxLeft)

    // 选区上方（约浮层高度 110px），空间不足时放下方
    const top = relativeTop > 110 ? relativeTop - 110 : relativeTop + lineHeight
    setPosition({ top, left })
    setShow(true)
    // 记录选区的 from/to，供替换时使用（textarea 选择范围可能已因 focus 丢失）
    lastSelectionRef.current = { start: selectionStart, end: selectionEnd }
  }, [textareaRef, containerRef, hasSelection, hideMenu])

  // 监听 textarea 的选区变化
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const handlers = ['selectionchange', 'mouseup', 'keyup', 'click'] as const
    handlers.forEach((evt) => textarea.addEventListener(evt, updatePosition))
    return () => {
      handlers.forEach((evt) => textarea.removeEventListener(evt, updatePosition))
    }
  }, [textareaRef, updatePosition])

  // 点击浮层外部时隐藏（重新选择会再次显示）
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (processingRef.current) return
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        hideMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [hideMenu])

  const apply = useCallback((instruction: string) => {
    if (processingRef.current) return
    hideMenu()
    onApply(instruction)
  }, [hideMenu, onApply])

  const applyCustom = useCallback(() => {
    const instruction = customInstruction.trim()
    if (!instruction) return
    apply(instruction)
  }, [customInstruction, apply])

  if (!show && !processing) return null

  return (
    <div ref={menuRef} className="absolute z-50" style={{ top: position.top, left: position.left }}>
      <div className="flex flex-col gap-1.5 p-1.5 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border border-border rounded-lg shadow-lg">
        {/* 预设操作 */}
        <div className="flex items-center gap-0.5">
          <MenuButton disabled={processing} onClick={() => apply(PRESET_INSTRUCTIONS.polish)} icon={<Sparkles className="w-3.5 h-3.5" />}>润色</MenuButton>
          <MenuButton disabled={processing} onClick={() => apply(PRESET_INSTRUCTIONS.concise)} icon={<Minimize2 className="w-3.5 h-3.5" />}>精简</MenuButton>
          <MenuButton disabled={processing} onClick={() => apply(PRESET_INSTRUCTIONS.expand)} icon={<Maximize2 className="w-3.5 h-3.5" />}>扩写</MenuButton>
          {/* 翻译子菜单 */}
          <div
            className="relative"
            onMouseEnter={() => setShowTranslate(true)}
            onMouseLeave={() => setShowTranslate(false)}
          >
            <MenuButton
              disabled={processing}
              onClick={() => setShowTranslate(!showTranslate)}
              icon={<Languages className="w-3.5 h-3.5" />}
              hasSubmenu
              submenuOpen={showTranslate}
            >翻译</MenuButton>
            {showTranslate && (
              <div className="absolute top-0 left-full ml-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-36 z-50 max-h-60 overflow-y-auto">
                {POPULAR_LANGUAGES.map((lang) => (
                  <MenuButton key={lang.code} onClick={() => apply(`将这段文字翻译成${lang.code}`)}>
                    {lang.name}
                  </MenuButton>
                ))}
                <div className="border-t border-border my-1" />
                <div className="px-2 py-1">
                  <input
                    type="text"
                    value={customTranslateLang}
                    placeholder="输入语言，如：日语"
                    onChange={(e) => setCustomTranslateLang(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customTranslateLang.trim()) {
                        apply(`将这段文字翻译成${customTranslateLang.trim()}`)
                      } else if (e.key === 'Escape') {
                        setShowTranslate(false)
                        setCustomTranslateLang('')
                      }
                    }}
                    className="w-full px-2 py-1 text-xs bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        {/* 自定义指令 */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={customInstruction}
            disabled={processing}
            placeholder="输入修改指令，如：改成三条待办"
            onChange={(e) => setCustomInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyCustom()
              else if (e.key === 'Escape') hideMenu()
            }}
            className="w-48 px-2 py-1 text-xs bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            className="px-2 py-1 rounded hover:bg-muted transition-colors text-xs flex items-center gap-1 text-primary disabled:opacity-50"
            disabled={processing || !customInstruction.trim()}
            onClick={applyCustom}
          >
            {processing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            {processing ? '修改中' : '应用'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 浮层菜单按钮 */
function MenuButton({ onClick, icon, children, disabled, hasSubmenu, submenuOpen }: {
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  hasSubmenu?: boolean
  submenuOpen?: boolean
}) {
  return (
    <button
      className="px-2 py-1 rounded hover:bg-muted transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
      {hasSubmenu && <ChevronRight className={cn('w-3 h-3 transition-transform', submenuOpen && 'rotate-90')} />}
    </button>
  )
}
