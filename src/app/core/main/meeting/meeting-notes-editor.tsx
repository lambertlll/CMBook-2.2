'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useMeetingStore } from './meeting-store'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Palette,
  Highlighter,
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
// 复用主编辑器的排版样式（.tiptap-editor），保证随手记与笔记编辑器观感一致
import '../editor/markdown/style.css'

const TEXT_COLORS = [
  { label: '黑色', value: '#000000' },
  { label: '红色', value: '#ef4444' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '绿色', value: '#22c55e' },
  { label: '橙色', value: '#f97316' },
  { label: '紫色', value: '#a855f7' },
]

const HIGHLIGHT_COLORS = [
  { label: '黄色', value: '#fef08a' },
  { label: '绿色', value: '#bbf7d0' },
  { label: '蓝色', value: '#bfdbfe' },
  { label: '粉色', value: '#fecdd3' },
  { label: '紫色', value: '#e9d5ff' },
]

interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  children: React.ReactNode
  title?: string
}

function ToolbarButton({
  onClick,
  isActive,
  children,
  title,
}: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-7 w-7 p-0', isActive && 'bg-accent')}
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  )
}

function MeetingEditorToolbar({
  editor,
}: {
  editor: Editor | null
}) {
  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 flex-wrap border-b px-2 py-1.5">
      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="H1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="H2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="H3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        isActive={editor.isActive('paragraph')}
        title="正文"
      >
        <Type className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Text formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="加粗"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="斜体"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="下划线"
      >
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="删除线"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Text Color */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="文字颜色"
          >
            <Palette className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.value}
                className="w-6 h-6 rounded-full border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color.value }}
                onClick={() =>
                  editor.chain().focus().setColor(color.value).run()
                }
                title={color.label}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Highlight */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="高亮"
          >
            <Highlighter className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                className="w-6 h-6 rounded-full border border-border hover:scale-110 transition-transform"
                style={{ backgroundColor: color.value }}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: color.value })
                    .run()
                }
                title={color.label}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="无序列表"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="有序列表"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive('taskList')}
        title="任务列表"
      >
        <ListTodo className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Blockquote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="引用"
      >
        <Quote className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Alignment */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        isActive={editor.isActive({ textAlign: 'left' })}
        title="左对齐"
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        isActive={editor.isActive({ textAlign: 'center' })}
        title="居中"
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        isActive={editor.isActive({ textAlign: 'right' })}
        title="右对齐"
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>
    </div>
  )
}

interface MeetingNotesEditorProps {
  meetingId: string
  content: string
}

export function MeetingNotesEditor({
  meetingId,
  content,
}: MeetingNotesEditorProps) {
  const t = useTranslations('meeting')
  const updateMeeting = useMeetingStore((s) => s.updateMeeting)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: t('notesPlaceholder'),
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      updateMeeting(meetingId, { manualNotes: editor.getHTML() })
    },
    editorProps: {
      attributes: {
        // prose 类未生效（项目无 typography 插件），排版统一由 style.css 的 .tiptap-editor 提供
        class: 'focus:outline-none h-full',
      },
    },
  })

  return (
    <div className="flex flex-col h-full">
      <MeetingEditorToolbar editor={editor} />
      <div className="flex-1 overflow-auto tiptap-editor meeting-notes-editor">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  )
}
