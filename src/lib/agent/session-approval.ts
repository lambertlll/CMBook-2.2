import type { AgentTool } from './types'
import { isWriteLikeRisk } from './permission-engine'

export interface SessionApprovalScope {
  type: 'write' | 'runtime-script-skill'
  skillId?: string
}

export function getSessionApprovalScope(
  toolName: string,
  tool: AgentTool | undefined,
  params: Record<string, unknown>
): SessionApprovalScope | null {
  if (!tool) {
    return null
  }

  if (tool.risk === 'script' || toolName === 'skill_execute_script') {
    const skillId = typeof params.skill_id === 'string'
      ? params.skill_id
      : typeof params.skillId === 'string'
        ? params.skillId
        : undefined

    return skillId
      ? { type: 'runtime-script-skill', skillId }
      : null
  }

  if (isWriteLikeRisk(tool.risk)) {
    return { type: 'write' }
  }

  return null
}

export function matchesSessionApproval(
  approvedConversationId: number | null,
  activeConversationId: number | null,
  approvedRuntimeScriptSkillId: string | null,
  scope: SessionApprovalScope | null
): boolean {
  if (!scope || approvedConversationId === null || activeConversationId === null) {
    return false
  }

  if (approvedConversationId !== activeConversationId) {
    return false
  }

  if (scope.type === 'write') {
    return true
  }

  return scope.type === 'runtime-script-skill' &&
    Boolean(scope.skillId) &&
    approvedRuntimeScriptSkillId === scope.skillId
}
