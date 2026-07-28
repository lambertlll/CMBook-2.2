'use client'

import { type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Link,
  Image as ImageIcon,
  Palette,
  Highlighter,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

interface EditorToolbarProps {
  editor: Editor | null
}

const TEXT_COLORS = [
  { name: '黑色', value: '#000000' },
  { name: '红色', value: '#e53e3e' },
  { name: '蓝色', value: '#3182ce' },
  { name: '绿色', value: '#38a169' },
  { name: '橙色', value: '#dd6b20' },
  { name: '紫色', value: '#805ad5' },
  { name: '灰色', value: '#718096' },
  { name: '棕色', value: '#975a16' },
]

const HIGHLIGHT_COLORS = [
  { name: '黄色', value: '#fefcbf' },
  { name: '绿色', value: '#c6f6d5' },
  { name: '蓝色', value: '#bee3f8' },
  { name: '粉色', value: '#fed7e2' },
  { name: '橙色', value: '#feebc8' },
]

type TextType = 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4'

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-sm h-7 w-7 text-sm font-medium transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground'
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [colorOpen, setColorOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)

  const getCurrentTextType = useCallback((): TextType => {
    if (!editor) return 'paragraph'
    if (editor.isActive('heading', { level: 1 })) return 'heading-1'
    if (editor.isActive('heading', { level: 2 })) return 'heading-2'
    if (editor.isActive('heading', { level: 3 })) return 'heading-3'
    if (editor.isActive('heading', { level: 4 })) return 'heading-4'
    return 'paragraph'
  }, [editor])

  const handleTextTypeChange = useCallback(
    (value: string) => {
      if (!editor) return
      switch (value) {
        case 'paragraph':
          editor.chain().focus().setParagraph().run()
          break
        case 'heading-1':
          editor.chain().focus().toggleHeading({ level: 1 }).run()
          break
        case 'heading-2':
          editor.chain().focus().toggleHeading({ level: 2 }).run()
          break
        case 'heading-3':
          editor.chain().focus().toggleHeading({ level: 3 }).run()
          break
        case 'heading-4':
          editor.chain().focus().toggleHeading({ level: 4 }).run()
          break
      }
    },
    [editor]
  )

  const handleSetColor = useCallback(
    (color: string) => {
      if (!editor) return
      editor.chain().focus().setColor(color).run()
      setColorOpen(false)
    },
    [editor]
  )

  const handleSetHighlight = useCallback(
    (color: string) => {
      if (!editor) return
      editor.chain().focus().toggleHighlight({ color }).run()
      setHighlightOpen(false)
    },
    [editor]
  )

  const handleSetLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href || ''
    const url = window.prompt('输入链接地址', previousUrl)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }, [editor])

  const handleInsertImage = useCallback(() => {
    if (!editor) return
    const url = window.prompt('输入图片地址')
    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 px-2 h-10 bg-muted/50 border-b border-border overflow-x-auto shrink-0">
      {/* 文本类型选择 */}
      <Select value={getCurrentTextType()} onValueChange={handleTextTypeChange}>
        <SelectTrigger className="h-7 w-[90px] text-xs border-none bg-transparent hover:bg-accent focus:ring-0 focus:ring-offset-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="paragraph">正文</SelectItem>
          <SelectItem value="heading-1">标题 1</SelectItem>
          <SelectItem value="heading-2">标题 2</SelectItem>
          <SelectItem value="heading-3">标题 3</SelectItem>
          <SelectItem value="heading-4">标题 4</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 加粗 / 斜体 / 下划线 / 删除线 */}
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="加粗"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="斜体"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="下划线"
      >
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="删除线"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 文字颜色 */}
      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-center rounded-sm h-7 w-7 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground'
            )}
            title="文字颜色"
          >
            <Palette className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                className="h-6 w-6 rounded-sm border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color.value }}
                onClick={() => handleSetColor(color.value)}
                title={color.name}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 背景高亮 */}
      <Popover open={highlightOpen} onOpenChange={setHighlightOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-center rounded-sm h-7 w-7 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              editor.isActive('highlight') && 'bg-accent text-accent-foreground'
            )}
            title="背景高亮"
          >
            <Highlighter className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-5 gap-1">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                className="h-6 w-6 rounded-sm border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color.value }}
                onClick={() => handleSetHighlight(color.value)}
                title={color.name}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 对齐 */}
      <ToolbarButton
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        title="左对齐"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        title="居中"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        title="右对齐"
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 列表 */}
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="无序列表"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="有序列表"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="任务列表"
      >
        <ListTodo className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 引用块 / 代码块 */}
      <ToolbarButton
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="引用块"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="代码块"
      >
        <Code2 className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* 链接 / 图片 */}
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={handleSetLink}
        title="链接"
      >
        <Link className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={handleInsertImage}
        title="图片"
      >
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
    </div>
  )
}

export default EditorToolbar
