'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

interface WordCountProps {
  editor: Editor
}

export function WordCount({ editor }: WordCountProps) {
  const [characters, setCharacters] = useState(() => editor.storage.characterCount?.characters?.() ?? 0)

  useEffect(() => {
    if (!editor) {
      setCharacters(0)
      return
    }

    const updateCharacters = () => {
      setCharacters(editor.storage.characterCount?.characters?.() ?? 0)
    }

    updateCharacters()
    editor.on('create', updateCharacters)
    editor.on('update', updateCharacters)

    return () => {
      editor.off('create', updateCharacters)
      editor.off('update', updateCharacters)
    }
  }, [editor])

  return (
    <span className="text-xs">{characters} 字符</span>
  )
}
