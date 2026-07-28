import type { AgentRunStatus } from "@/lib/agent/types"

export const agentStatusText: Record<AgentRunStatus, string> = {
  idle: "空闲",
  preparing_context: "准备上下文",
  thinking: "思考中",
  calling_tool: "执行工具",
  waiting_approval: "等待确认",
  applying_change: "应用修改",
  recovering: "恢复中",
  steering: "应用追加信息",
  completed: "已完成",
  stopped: "已停止",
  failed: "失败",
}

export function formatAgentToolName(name: string) {
  return name
    .replace(/^editor_/, "编辑器 · ")
    .replace(/^note_/, "笔记 · ")
    .replace(/^folder_/, "文件夹 · ")
    .replace(/^tag_/, "标签 · ")
    .replace(/^mark_/, "记录 · ")
    .replace(/^memory_/, "记忆 · ")
    .replace(/^skill_/, "Skill · ")
    .replace(/^mcp_/, "MCP · ")
    .replace(/^system_/, "系统 · ")
    .replace(/_/g, " ")
}

export function formatAgentDuration(duration?: number) {
  if (duration === undefined) return ""
  if (duration < 1000) return `${duration}ms`
  return `${(duration / 1000).toFixed(1)}s`
}

export function formatAgentTarget(target: string) {
  const normalized = target.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || target
}
