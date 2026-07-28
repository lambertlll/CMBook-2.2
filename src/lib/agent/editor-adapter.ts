import type { AgentChange } from './types'

export interface EditorTransactionOperation {
  type: 'replace_range' | 'replace_lines' | 'insert_after_line' | 'insert_before_line'
  from?: number
  to?: number
  startLine?: number
  endLine?: number
  line?: number
  content: string
}

export interface EditorTransactionInput {
  filePath?: string
  version?: number
  operations: EditorTransactionOperation[]
}

export function buildEditorChange(target: string, before: string | undefined, after: string | undefined): AgentChange {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'editor',
    target,
    before,
    after,
    reversible: true,
    summary: '编辑器内容已更新',
  }
}
