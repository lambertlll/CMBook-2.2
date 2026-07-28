"use client"

import * as React from "react"
import {
  ChevronRight,
  Database,
  FileText,
  MoreHorizontal,
  Sparkles,
} from "lucide-react"
import useArticleStore from "@/stores/article"
import type { AgentSkillSummary } from "@/lib/agent/types"

export interface RagSourceDetail {
  filepath: string
  filename: string
  content: string
}

interface AgentContextTrayProps {
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]
  loadedSkills?: AgentSkillSummary[]
}

export function AgentContextTray({
  ragSources = [],
  ragSourceDetails = [],
  loadedSkills = [],
}: AgentContextTrayProps) {
  const [showRag, setShowRag] = React.useState(false)
  const [showSkills, setShowSkills] = React.useState(false)
  const [expandedSkillDescriptions, setExpandedSkillDescriptions] = React.useState<string[]>([])
  const { setActiveFilePath, readArticle } = useArticleStore()

  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((detail) => [detail.filename, detail])),
    [ragSourceDetails]
  )

  const openRagFile = (filepath: string) => {
    if (!filepath) return
    setActiveFilePath(filepath)
    void readArticle(filepath)
  }

  const toggleSkillDescription = (skillId: string) => {
    setExpandedSkillDescriptions((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    )
  }

  if (ragSources.length === 0 && loadedSkills.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      {ragSources.length > 0 && (
        <div>
          <button
            type="button"
            className="group flex w-full items-center gap-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowRag((value) => !value)}
          >
            <Database className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">已检索 {ragSources.length} 个文件</span>
            <ChevronRight
              className={`size-4 shrink-0 transition-transform ${showRag ? "rotate-90" : ""}`}
            />
          </button>

          {showRag && (
            <div className="ml-6 flex flex-col gap-1 border-l pl-3">
              {ragSources.map((source) => {
                const detail = detailMap.get(source)
                return (
                  <div key={source} className="py-1 text-xs">
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{source}</span>
                      </div>
                      {detail?.filepath && (
                        <button
                          type="button"
                          className="shrink-0 text-primary hover:underline"
                          onClick={() => openRagFile(detail.filepath)}
                        >
                          打开
                        </button>
                      )}
                    </div>
                    {detail?.content && (
                      <div className="mt-1 truncate text-muted-foreground">
                        {detail.content}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loadedSkills.length > 0 && (
        <div>
          <button
            type="button"
            className="group flex w-full items-center gap-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowSkills((value) => !value)}
          >
            <Sparkles className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              已使用 {loadedSkills.length} 个技能
            </span>
            <ChevronRight
              className={`size-4 shrink-0 transition-transform ${showSkills ? "rotate-90" : ""}`}
            />
          </button>

          {showSkills && (
            <div className="ml-6 flex flex-col gap-2 border-l pl-3">
              {loadedSkills.map((skill) => {
                const descriptionExpanded = expandedSkillDescriptions.includes(skill.id)

                return (
                  <div key={skill.id} className="py-1 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                      <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{skill.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">
                      {skill.id}
                    </div>
                    {skill.description && (
                      <div className="mt-1 flex min-w-0 items-start gap-1 text-muted-foreground">
                        <div
                          className={`min-w-0 flex-1 ${
                            descriptionExpanded ? "whitespace-pre-wrap break-words" : "truncate"
                          }`}
                        >
                          {skill.description}
                        </div>
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => toggleSkillDescription(skill.id)}
                          title={descriptionExpanded ? "收起描述" : "展开描述"}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
