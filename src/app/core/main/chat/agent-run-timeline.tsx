"use client"

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react"
import type { AgentChange, AgentRunStatus, AgentSkillSummary, AgentTraceEvent, ToolCall } from "@/lib/agent/types"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { AgentChangesPanel } from "./agent-changes-panel"
import { AgentContextTray, type RagSourceDetail } from "./agent-context-tray"
import { agentStatusText, formatAgentDuration, formatAgentToolName } from "./agent-display-utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import ChatPreview from "./chat-preview"

interface AgentRunTimelineProps {
  status?: AgentRunStatus
  isRunning?: boolean
  traceEvents?: AgentTraceEvent[]
  toolCalls?: ToolCall[]
  changes?: AgentChange[]
  showChanges?: boolean
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]
  loadedSkills?: AgentSkillSummary[]
}

function eventIcon(event: AgentTraceEvent) {
  if (event.status === "error") {
    return <AlertTriangle className="size-4 text-destructive" />
  }

  if (event.status === "running") {
    return <Loader2 className="size-4 animate-spin text-primary" />
  }

  if (event.type === "tool_call" || event.type === "tool_result") {
    return <Wrench className="size-4 text-primary" />
  }

  if (event.type === "final") {
    return <CheckCircle2 className="size-4 text-success" />
  }

  return <Sparkles className="size-4 text-primary" />
}

function shouldShowEventMessage(event: AgentTraceEvent) {
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "steering" ||
    event.type === "error"
}

function hasMeaningfulTraceDetail(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0
  }

  return value !== undefined && value !== null
}

function shouldShowTraceEvent(event: AgentTraceEvent) {
  if (event.type === "final") {
    return false
  }

  if (event.type === "change") {
    return false
  }

  if (event.type === "approval") {
    return false
  }

  if (
    (event.type === "model_call" || event.type === "model_response") &&
    event.status === "success" &&
    !hasMeaningfulTraceDetail(event.output) &&
    event.duration === undefined
  ) {
    return false
  }

  return true
}

function filterTimelineEvents(events: AgentTraceEvent[]) {
  return events.filter(shouldShowTraceEvent)
}

function getModelResponseContent(event: AgentTraceEvent) {
  if (
    (event.type === "model_call" || event.type === "model_response") &&
    typeof event.output === "string" &&
    event.output.trim()
  ) {
    return event.output
  }

  return undefined
}

function getModelReasoningContent(event: AgentTraceEvent) {
  const reasoning = event.reasoning?.trim()
  if (!reasoning) {
    return undefined
  }

  if (event.status === "running" && reasoning.length > 1200) {
    return `…${reasoning.slice(-1200)}`
  }

  return reasoning
}

function getReceivedTokenCount(event: AgentTraceEvent) {
  if (event.streamedTokenCount !== undefined) {
    return event.streamedTokenCount
  }

  const output = typeof event.output === "string"
    ? event.output
    : event.output
      ? JSON.stringify(event.output)
      : ""
  return estimateTokens(`${event.reasoning || ""}${output}`)
}

function formatProcessedDuration(duration?: number) {
  if (duration === undefined) return ""
  if (duration < 1000) return `${duration}ms`

  const totalSeconds = Math.round(duration / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  }

  return `${seconds}s`
}

function formatTraceDetail(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compactTraceInput(value: unknown) {
  return hasMeaningfulTraceDetail(value) ? value : undefined
}

function compactTraceOutput(event: AgentTraceEvent, visibleMessage?: string) {
  const value = event.output

  if (!hasMeaningfulTraceDetail(value)) {
    return undefined
  }

  if (event.type === "model_call" || event.type === "model_response") {
    return value
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return visibleMessage ? undefined : value
  }

  const output = value as {
    ok?: unknown
    success?: unknown
    message?: unknown
    data?: unknown
    error?: unknown
  }

  if (
    "ok" in output ||
    "success" in output ||
    "message" in output ||
    "data" in output ||
    "error" in output
  ) {
    if (event.status !== "error") {
      return visibleMessage ? undefined : output.data
    }

    const compacted: Record<string, unknown> = {}

    if (output.ok !== undefined) compacted.ok = output.ok
    if (output.success !== undefined) compacted.success = output.success
    if (!visibleMessage && output.message !== undefined) compacted.message = output.message
    if (output.error !== undefined) compacted.error = output.error
    if (output.data !== undefined) compacted.data = output.data

    return hasMeaningfulTraceDetail(compacted) ? compacted : undefined
  }

  return visibleMessage ? undefined : value
}

function traceDetailClassName(event: AgentTraceEvent) {
  const maxHeight = event.type === "model_call" || event.type === "model_response"
    ? "max-h-96"
    : "max-h-72"

  return `${maxHeight} overflow-auto rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]`
}

function statusIcon(status: AgentRunStatus, isRunning: boolean) {
  if (isRunning) {
    return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
  }

  if (status === "failed") {
    return <AlertTriangle className="size-4 shrink-0 text-destructive" />
  }

  return <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
}

function eventFromToolCall(toolCall: ToolCall): AgentTraceEvent {
  return {
    id: toolCall.id,
    runId: "live",
    type: "tool_call",
    title: formatAgentToolName(toolCall.toolName),
    status: toolCall.status === "running"
      ? "running"
      : toolCall.status === "error"
        ? "error"
        : toolCall.status === "success"
          ? "success"
          : "pending",
    timestamp: toolCall.timestamp,
    toolName: toolCall.toolName,
    input: toolCall.params,
    output: toolCall.result,
    message: toolCall.result?.message || toolCall.result?.error,
  }
}

export function AgentRunTimeline({
  status = "idle",
  isRunning = false,
  traceEvents = [],
  toolCalls = [],
  changes = [],
  showChanges = true,
  ragSources = [],
  ragSourceDetails = [],
  loadedSkills = [],
}: AgentRunTimelineProps) {
  const [expandedEvents, setExpandedEvents] = React.useState<string[]>([])
  const [processOpen, setProcessOpen] = React.useState(false)

  const events = React.useMemo(() => {
    if (traceEvents.length > 0) {
      return filterTimelineEvents(traceEvents)
    }

    return toolCalls.map(eventFromToolCall)
  }, [traceEvents, toolCalls])
  const hasRunningEvent = events.some((event) => event.status === "running")
  const [liveNow, setLiveNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!isRunning && !hasRunningEvent) {
      return
    }

    setLiveNow(Date.now())
    const timer = window.setInterval(() => {
      setLiveNow(Date.now())
    }, 100)

    return () => window.clearInterval(timer)
  }, [hasRunningEvent, isRunning])

  const toggleEvent = (id: string) => {
    setExpandedEvents((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }

  if (!isRunning && events.length === 0 && ragSources.length === 0 && changes.length === 0 && loadedSkills.length === 0) {
    return null
  }

  const showStatusRow = events.length === 0 && (status === "failed" || status === "stopped")
  const durationEvents = traceEvents.length > 0 ? traceEvents : events
  const processStartedAt = durationEvents.length > 0
    ? Math.min(...durationEvents.map((event) => event.timestamp))
    : undefined
  const processFinishedAt = durationEvents.length > 0
    ? Math.max(...durationEvents.map((event) => event.timestamp + (event.duration || 0)))
    : undefined
  const processDuration = processStartedAt === undefined
    ? undefined
    : Math.max(0, (isRunning ? liveNow : processFinishedAt || processStartedAt) - processStartedAt)
  const modelExecutionCount = events.filter((event) =>
    event.type === "model_call" || event.type === "model_response"
  ).length
  const processLabel = [
    "已处理",
    processDuration === undefined ? undefined : formatProcessedDuration(processDuration),
    modelExecutionCount > 0 ? `· 执行 ${modelExecutionCount} 次` : undefined,
  ].filter(Boolean).join(" ")

  const processContent = (
    <div className="flex flex-col gap-2 pl-1">
      <AgentContextTray
        ragSources={ragSources}
        ragSourceDetails={ragSourceDetails}
        loadedSkills={loadedSkills}
      />

      {events.length > 0 && (
        <div role="list" className="flex flex-col gap-1">
          {events.map((event) => {
            const storedExpanded = expandedEvents.includes(event.id)
            const isModelEvent = event.type === "model_call" || event.type === "model_response"
            const visibleMessage = shouldShowEventMessage(event) ? event.message : undefined
            const modelResponseContent = getModelResponseContent(event)
            const modelReasoningContent = getModelReasoningContent(event)
            const inputDetail = compactTraceInput(event.input)
            const outputDetail = modelResponseContent ? undefined : compactTraceOutput(event, visibleMessage)
            const hasTraceDetails = Boolean(
              visibleMessage || inputDetail !== undefined || outputDetail !== undefined
            )
            const hasDetails = Boolean(
              modelReasoningContent ||
              hasTraceDetails
            )
            const forceExpanded = isModelEvent && event.status === "running"
            const expanded = forceExpanded || storedExpanded
            const canToggle = hasDetails && !forceExpanded
            const displayDuration = event.duration ?? (
              event.status === "running"
                ? Math.max(0, liveNow - event.timestamp)
                : undefined
            )
            const receivedTokenCount = isModelEvent ? getReceivedTokenCount(event) : 0
            return (
              <div key={event.id} role="listitem" className="text-sm">
                <button
                  type="button"
                  className="group flex w-full items-start gap-2 py-1.5 text-left"
                  onClick={() => canToggle && toggleEvent(event.id)}
                  aria-expanded={canToggle ? expanded : undefined}
                >
                  <span className="mt-0.5 shrink-0">{eventIcon(event)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={expanded ? "min-w-0 break-words [overflow-wrap:anywhere]" : "truncate"}>
                        {event.toolName ? formatAgentToolName(event.toolName) : event.title}
                      </span>
                      {displayDuration !== undefined && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatAgentDuration(displayDuration)}
                        </span>
                      )}
                      {receivedTokenCount > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          · {receivedTokenCount.toLocaleString()} tokens
                        </span>
                      )}
                    </span>
                    {visibleMessage && !expanded && (
                      <span className="mt-1 block max-w-full truncate text-xs text-muted-foreground">
                        {visibleMessage}
                      </span>
                    )}
                  </span>
                  {canToggle && (
                    expanded ? (
                      <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )
                  )}
                </button>

                {modelReasoningContent && expanded && event.status !== "running" && (
                  <div className="ml-6 border-l pl-3 pb-2 text-xs">
                    <div className="max-h-48 overflow-y-auto rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">
                      {modelReasoningContent}
                    </div>
                  </div>
                )}

                {modelResponseContent && (
                  <div className="ml-6 border-l pl-3 pb-2 text-sm">
                    <ChatPreview text={modelResponseContent} />
                  </div>
                )}

                {expanded && hasTraceDetails && (
                  <div className="ml-6 flex flex-col gap-2 border-l pl-3 pb-2 text-xs">
                    {visibleMessage && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">描述</div>
                        <div className="rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">
                          {visibleMessage}
                        </div>
                      </div>
                    )}
                    {inputDetail !== undefined && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">参数</div>
                        <pre className={traceDetailClassName(event)}>{formatTraceDetail(inputDetail)}</pre>
                      </div>
                    )}
                    {outputDetail !== undefined && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">结果</div>
                        <pre className={traceDetailClassName(event)}>{formatTraceDetail(outputDetail)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showStatusRow && (
        <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
          {statusIcon(status, isRunning)}
          <span className="truncate">{agentStatusText[status]}</span>
        </div>
      )}

      {showChanges && !isRunning && <AgentChangesPanel changes={changes} />}
    </div>
  )

  return (
    <div>
      {isRunning ? processContent : (
        <Collapsible open={processOpen} onOpenChange={setProcessOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="group flex w-full items-center gap-2 py-1.5 text-left text-sm text-muted-foreground">
            {statusIcon(status, isRunning)}
            <span className="flex-1 truncate">{processLabel}</span>
            <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          </button>
        </CollapsibleTrigger>

          <CollapsibleContent>{processContent}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
