'use client'

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { CodeBlockView } from './code-block-view'

export const StableCodeBlockLowlight = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {}

    return {
      ...parentShortcuts,
      'Mod-a': ({ editor }) => {
        const { selection, doc, tr } = editor.state
        const { $from, $to } = selection

        if (
          $from.parent.type !== this.type ||
          $to.parent.type !== this.type ||
          $from.start() !== $to.start()
        ) {
          return false
        }

        editor.view.dispatch(
          tr
            .setSelection(TextSelection.create(doc, $from.start(), $from.end()))
            .scrollIntoView()
        )
        return true
      },
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const { $from, empty } = selection

        if (!empty || $from.parent.type !== this.type) {
          return false
        }

        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n')
        const action = isAtEnd && endsWithDoubleNewline ? 'exit' : 'newline'

        if (action === 'exit') {
          return editor.chain()
            .command(({ tr }) => {
              tr.delete($from.pos - 2, $from.pos)
              return true
            })
            .exitCode()
            .run()
        }

        return editor.commands.insertContent('\n')
      },
    }
  },
})
