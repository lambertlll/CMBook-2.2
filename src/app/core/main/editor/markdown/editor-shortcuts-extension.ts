import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorShortcut, EditorShortcutCommandId } from '@/config/editor-shortcuts'
import {
  findMatchingEditorShortcut,
  shouldBlockEditorDefaultShortcut,
} from '@/lib/editor-shortcut-utils'

interface EditorShortcutsOptions {
  getShortcuts: () => EditorShortcut[]
  runCommand: (id: EditorShortcutCommandId, editor: Editor) => boolean
}

export const EditorShortcutsExtension = Extension.create<EditorShortcutsOptions>({
  name: 'editorShortcuts',

  priority: 10000,

  addOptions() {
    return {
      getShortcuts: () => [],
      runCommand: () => false,
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            const shortcuts = this.options.getShortcuts()
            const matchedShortcut = findMatchingEditorShortcut(event, shortcuts)

            if (matchedShortcut) {
              const handled = this.options.runCommand(matchedShortcut.id, this.editor)
              if (handled) {
                event.preventDefault()
                event.stopPropagation()
                return true
              }
            }

            if (shouldBlockEditorDefaultShortcut(event, shortcuts)) {
              event.preventDefault()
              event.stopPropagation()
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})
