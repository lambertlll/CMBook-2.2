'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { Sparkles, Minimize2, Maximize2, Loader2, Wand2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * 纪要编辑器的选中气泡菜单（主编辑器 bubble-menu.tsx 的简化版）：
 * 预设操作（润色/精简/扩写）+ 自定义指令输入，AI 只改写选中部分。
 * 之所以不直接复用主编辑器的气泡菜单：那个组件绑定了大量主编辑器扩展
 * （下划线/高亮/链接等）和 emitter 建议模式，嫁接成本高于独立实现。
 */

// 预设操作对应的 AI 指令（发给模型的指令固定中文，与会议模块其他 prompt 一致）
const PRESET_INSTRUCTIONS = {
  polish: '润色这段文字，语言更专业流畅，保持原意和篇幅',
  concise: '精简这段文字，去除冗余，只保留关键信息',
  expand: '扩写这段文字，补充合理的细节说明',
} as const

interface SummaryBubbleMenuProps {
  editor: Editor
  /** 滚动容器（position: relative），气泡绝对定位在其中，随内容一起滚动 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** AI 处理中（父组件持有），处理中气泡保持显示并禁用操作 */
  processing: boolean
  /** 应用某条指令（预设或自定义），由父组件执行 AI 调用和选区替换 */
  onApply: (instruction: string) => void
}

function getSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, '\n', '\n')
}

function hasTextSelection(editor: Editor): boolean {
  const { selection } = editor.state
  if (selection.empty) return false
  return getSelectedText(editor).trim().length > 0
}

export function SummaryBubbleMenu({
  editor,
  containerRef,
  processing,
  onApply,
}: SummaryBubbleMenuProps) {
  const t = useTranslations('meeting')
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [customInstruction, setCustomInstruction] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  // processing 的最新值供事件回调读取（监听器不随 processing 重建）
  const hideMenu = useCallback(() => {
    setShow(false)
    setCustomInstruction('')
  }, [])

  const processingRef = useRef(processing)
  useEffect(() => {
    processingRef.current = processing
    // 处理结束后隐藏气泡（替换选区后不再停留在原位）
    if (!processing) hideMenu()
  }, [processing, hideMenu])

  // 根据选区坐标计算气泡位置（选区上方，空间不足时放下方）
  const updatePosition = useCallback(() => {
    // 处理中保持气泡显示（展示加载态），不随选区变化隐藏
    if (processingRef.current) return
    if (!hasTextSelection(editor)) {
      hideMenu()
      return
    }

    const container = containerRef.current
    if (!container) {
      hideMenu()
      return
    }

    try {
      const { from } = editor.state.selection
      const coords = editor.view.coordsAtPos(from)
      const containerBounds = container.getBoundingClientRect()

      // 视口坐标换算为容器内内容坐标（加上滚动偏移，气泡随内容滚动）
      const relativeTop = coords.top - containerBounds.top + container.scrollTop
      const relativeLeft = coords.left - containerBounds.left + container.scrollLeft

      const menuWidth = menuRef.current?.offsetWidth || 320
      const maxLeft = Math.max(0, containerBounds.width - menuWidth)
      const left = Math.min(Math.max(0, relativeLeft), maxLeft)

      // 上方空间不足（约气泡高度 96px，含输入框）时放选区下方
      const top = relativeTop > 96 ? relativeTop - 96 : relativeTop + 28
      setPosition({ top, left })
      setShow(true)
    } catch {
      hideMenu()
    }
  }, [editor, containerRef, hideMenu])

  // 选区变化/文档事务时更新气泡显隐与位置
  useEffect(() => {
    editor.on('selectionUpdate', updatePosition)
    editor.on('transaction', updatePosition)
    return () => {
      editor.off('selectionUpdate', updatePosition)
      editor.off('transaction', updatePosition)
    }
  }, [editor, updatePosition])

  // 点击气泡外部时隐藏（mousedown 在编辑器内重新选择时，selectionUpdate 会重新定位显示）
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

  // 应用指令：先隐藏气泡（替换后选区变化不再弹出），再交给父组件执行
  const apply = useCallback(
    (instruction: string) => {
      if (processingRef.current) return
      hideMenu()
      onApply(instruction)
    },
    [hideMenu, onApply]
  )

  const applyCustom = useCallback(() => {
    const instruction = customInstruction.trim()
    if (!instruction) return
    apply(instruction)
  }, [customInstruction, apply])

  if (!show && !processing) return null

  return (
    <div
      ref={menuRef}
      className="absolute z-50"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex flex-col gap-1.5 p-1.5 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border border-border rounded-lg shadow-lg">
        {/* 预设操作 */}
        <div className="flex items-center gap-0.5">
          <button
            className="px-2 py-1 rounded hover:bg-muted transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
            disabled={processing}
            onClick={() => apply(PRESET_INSTRUCTIONS.polish)}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t('bubblePolish')}
          </button>
          <button
            className="px-2 py-1 rounded hover:bg-muted transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
            disabled={processing}
            onClick={() => apply(PRESET_INSTRUCTIONS.concise)}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            {t('bubbleConcise')}
          </button>
          <button
            className="px-2 py-1 rounded hover:bg-muted transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
            disabled={processing}
            onClick={() => apply(PRESET_INSTRUCTIONS.expand)}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            {t('bubbleExpand')}
          </button>
        </div>
        {/* 自定义指令 */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={customInstruction}
            disabled={processing}
            placeholder={t('bubbleCustomPlaceholder')}
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
            {processing ? t('bubbleWorking') : t('bubbleApply')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SummaryBubbleMenu
