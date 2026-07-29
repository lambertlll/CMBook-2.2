import { createOpenAIClient } from '@/lib/ai/utils'
import { resolveModelConfig } from '@/app/core/main/meeting/meeting-model-config'
import useSettingStore from '@/stores/setting'
import type { WeekData } from '@/db/weekly-reports'
import { formatWeekLabel, formatWeekRange } from '@/db/weekly-reports'

/**
 * 周报 AI 生成器：将周聚合数据组装为 prompt，调用 LLM 流式生成 Markdown 周报正文。
 * 使用与会议纪要相同的 AI 调用模式（createOpenAIClient + resolveModelConfig）。
 */

// 拜访类型中文映射
const VISIT_TYPE_LABEL: Record<string, string> = {
  'first-visit': '首次拜访',
  'regular-return': '定期回访',
  'post-loan': '贷后检查',
  'marketing': '营销走访',
  '': '拜访',
}

function formatDateTime(ts: number): string {
  if (!ts) return '未定'
  const d = new Date(ts)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

/**
 * 将周数据组装为结构化 prompt 文本
 */
function buildPromptContext(
  weekData: WeekData,
  weekStart: number
): string {
  const lines: string[] = []
  lines.push(`# 周报数据（${formatWeekLabel(weekStart)} ${formatWeekRange(weekStart)}）`)
  lines.push('')

  // 1. 本周拜访
  lines.push('## 本周客户拜访')
  if (weekData.visits.length === 0) {
    lines.push('本周无客户拜访记录。')
  } else {
    lines.push(`共 ${weekData.stats.visitCount} 次拜访，涉及 ${weekData.stats.customerCount} 位客户：`)
    for (const v of weekData.visits) {
      const typeLabel = VISIT_TYPE_LABEL[v.visitType] || '拜访'
      lines.push(`- ${formatDateTime(v.visitDate)} ${v.customerName}（${typeLabel}）`)
      if (v.meetingSummary) {
        lines.push(`  纪要摘要：${v.meetingSummary}`)
      }
    }
  }
  lines.push('')

  // 2. 待办完成情况
  lines.push('## 本周待办事项')
  const { completed, pending, overdue, newThisWeek } = weekData.todos
  lines.push(`- 本周新建待办：${newThisWeek.length} 条`)
  lines.push(`- 已完成：${completed.length} 条`)
  lines.push(`- 未完成（本周到期）：${pending.length} 条`)
  lines.push(`- 逾期未完成：${overdue.length} 条`)
  lines.push(`- 完成率：${Math.round(weekData.stats.completionRate * 100)}%`)

  if (completed.length > 0) {
    lines.push('\n### 已完成事项：')
    for (const t of completed) {
      lines.push(`- [x] ${t.content}${t.owner ? `（${t.owner}）` : ''}${t.dueDate ? ` 期限:${formatDateTime(t.dueDate)}` : ''}`)
    }
  }
  if (pending.length > 0) {
    lines.push('\n### 本周到期未完成：')
    for (const t of pending) {
      lines.push(`- [ ] ${t.content}${t.owner ? `（${t.owner}）` : ''}${t.dueDate ? ` 期限:${formatDateTime(t.dueDate)}` : ''}`)
    }
  }
  if (overdue.length > 0) {
    lines.push('\n### 逾期未完成：')
    for (const t of overdue) {
      lines.push(`- [!] ${t.content}${t.owner ? `（${t.owner}）` : ''}${t.dueDate ? ` 期限:${formatDateTime(t.dueDate)}` : ''}`)
    }
  }
  lines.push('')

  // 3. 下周待办
  lines.push('## 下周到期待办')
  if (weekData.nextWeekTodos.length === 0) {
    lines.push('下周暂无到期待办。')
  } else {
    for (const t of weekData.nextWeekTodos) {
      lines.push(`- ${t.content}${t.owner ? `（${t.owner}）` : ''}${t.dueDate ? ` 期限:${formatDateTime(t.dueDate)}` : ''}`)
    }
  }

  return lines.join('\n')
}

/**
 * 生成周报 Markdown 正文（流式）。
 * @param weekData 周聚合数据
 * @param weekStart 周一 0 点时间戳
 * @param onStream 流式回调（每个 chunk 调用一次）
 * @param customPrompt 自定义模板 prompt（可选，来自设置中的自定义周报模板）
 * @returns 完整的 Markdown 周报正文
 */
export async function generateWeeklyReport(
  weekData: WeekData,
  weekStart: number,
  onStream?: (chunk: string) => void,
  customPrompt?: string
): Promise<string> {
  // 优先使用 reportModel，留空时回退到 primaryModel
  const settingStore = useSettingStore.getState()
  const reportModel = settingStore.reportModel
  const aiConfig = resolveModelConfig(reportModel || undefined)
  if (!aiConfig) {
    throw new Error('AI 模型未配置，请在设置中配置周报生成模型或主模型后重试')
  }

  const promptContext = buildPromptContext(weekData, weekStart)
  const weekLabel = formatWeekLabel(weekStart)
  const weekRange = formatWeekRange(weekStart)

  const systemPrompt = customPrompt || `你是一位银行客户经理的工作助手，擅长根据周拜访和待办数据撰写结构化、专业、简洁的周报。
请根据提供的本周数据，生成一份 Markdown 格式的周报，包含以下三个部分：

## 一、本周客户拜访情况
- 按时间顺序概述本周拜访的客户、拜访类型及交流要点
- 如有纪要摘要，提炼关键信息（不可照抄，需归纳）
- 如本周无拜访，简要说明

## 二、本周待办事项完成情况
- 统计本周待办完成情况（完成数/总数/完成率）
- 列出已完成的重要事项
- 列出未完成和逾期的事项，标注负责人和期限
- 简要分析未完成原因（如有线索）

## 三、下周重点工作规划
- 根据下周到期待办，列出重点工作安排
- 结合本周未完成事项和逾期事项，提出跟进计划
- 如有拜访计划，一并提及

要求：
- 使用 Markdown 格式
- 语言简洁专业，避免空话套话
- 数据准确，不要编造不存在的信息
- 开头写上周报标题：# ${weekLabel} 周报（${weekRange}）`

  const userPrompt = `请根据以下本周数据生成周报：\n\n${promptContext}`

  const openai = await createOpenAIClient(aiConfig)
  const useStream = aiConfig.enableStream !== false && !!onStream

  if (useStream) {
    const stream = await openai.chat.completions.create({
      model: aiConfig.model!,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: aiConfig.temperature ?? 0.7,
    }) as unknown as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>

    let full = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        full += delta
        onStream?.(delta)
      }
    }
    return full
  } else {
    const response = await openai.chat.completions.create({
      model: aiConfig.model!,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: aiConfig.temperature ?? 0.7,
    }) as unknown as { choices: Array<{ message: { content?: string } }> }
    const content = response.choices[0]?.message?.content || ''
    onStream?.(content)
    return content
  }
}
