"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Pencil } from "lucide-react"
import { DiffViewer } from "@/components/ui/diff-viewer"
import type { AgentChange } from "@/lib/agent/types"
import { formatAgentTarget } from "./agent-display-utils"

interface AgentChangesPanelProps {
  changes?: AgentChange[]
}

function changeTypeLabel(type: AgentChange["type"]) {
  const labels: Record<AgentChange["type"], string> = {
    editor: "编辑器",
    file: "文件",
    tag: "标签",
    mark: "记录",
    memory: "记忆",
    chat: "对话",
    folder: "文件夹",
  }

  return labels[type]
}

export function AgentChangesPanel({ changes = [] }: AgentChangesPanelProps) {
  const [expanded, setExpanded] = React.useState(false)

  if (changes.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Pencil className="size-4 shrink-0 text-primary" />
          <span className="truncate">本轮改动 {changes.length}</span>
        </span>
        {expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="ml-6 flex flex-col gap-1 border-l pl-3">
          {changes.map((change) => {
            const hasDiff = change.before !== undefined && change.after !== undefined

            return (
              <div key={change.id} className="py-1 text-xs">
                <div className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="flex min-w-0 items-center gap-2">
                    {change.reversible ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{change.summary || formatAgentTarget(change.target)}</span>
                      <span className="block truncate text-muted-foreground">{changeTypeLabel(change.type)} · {change.target}</span>
                    </span>
                  </span>
                </div>

                {hasDiff && (
                  <div className="mt-2">
                    <DiffViewer
                      original={change.before || ""}
                      modified={change.after || ""}
                      maxHeight={220}
                      className="text-xs"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
