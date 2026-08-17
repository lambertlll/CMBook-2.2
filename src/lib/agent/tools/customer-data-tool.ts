import type { Tool, ToolResult } from '../types'
import { getCustomerList } from '@/db/customers'
import { getVisitsByCustomer } from '@/db/visits'
import { getVisitTodoList } from '@/db/visit-todos'

/**
 * 客户结构化数据读取工具（customer_get_context）
 *
 * 背景：内置 skill（client-research / credit-committee-assistant /
 * financial-report-analyzer）生成材料时需要「本行掌握情况」——这些信息在
 * customers/visits/visit_todos/meetings 表里有结构化数据，但 skill 只能靠
 * note_search_files 搜文本文件，读不到数据库，导致"本行掌握情况"章节流于表面。
 *
 * 本工具按客户文件夹路径（folderPath，skill 输入中一定携带）查回客户记录，
 * 返回该客户的拜访时间线、待办事项（含已确认 AI 提取项）等结构化摘要，
 * 供 skill 直接引用——比从文件全文里抠更准确、更省 token。
 */
export const customerGetContextTool: Tool = {
  name: 'customer_get_context',
  description: 'Read structured context of a customer (visits timeline, follow-up todos) by its workspace folder path. Use this when a customer report needs "本行掌握情况" (internal knowledge: historical visits, commitments, todos, credit clues) instead of only searching note text files.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: '客户文件夹工作区相对路径，如 customers/腾讯',
      required: true,
    },
  ],
  execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const folderPath = typeof params.folderPath === 'string' ? params.folderPath.trim() : ''
      if (!folderPath) {
        return { success: false, error: '缺少必需参数 folderPath' }
      }

      const customers = await getCustomerList()
      // folderPath 精确匹配（兼容尾斜杠差异）
      const normalized = folderPath.replace(/\/+$/, '')
      const customer = customers.find(
        (c) => (c.folderPath || '').replace(/\/+$/, '') === normalized
      ) || customers.find((c) => (c.folderPath || '').includes(normalized))

      if (!customer) {
        return {
          success: false,
          error: `未找到 folderPath 为「${folderPath}」的客户。可先用 note_search_files / note_list_files 确认客户文件夹实际路径。`,
        }
      }

      // 拜访时间线（按时间倒序）
      const visits = await getVisitsByCustomer(customer.id)
      const visitSummary = visits
        .slice(0, 10)
        .map((v) => {
          const date = v.visitDate
            ? new Date(v.visitDate).toISOString().slice(0, 10)
            : '日期未定'
          const stage = v.stage === 'visited' ? '已拜访' : v.stage === 'preparing' ? '访前' : v.stage
          const typeMap: Record<string, string> = {
            'first-visit': '首次拜访',
            'regular-return': '常规回访',
            'post-loan': '贷后检查',
            marketing: '营销拜访',
          }
          const type = typeMap[v.visitType] || v.visitType || ''
          const title = `${date} ${v.title}`
          return `- ${title} [${stage}${type ? `/${type}` : ''}]${v.notes ? `：${v.notes.slice(0, 120)}` : ''}`
        })
        .join('\n') || '（无拜访记录）'

      // 待办事项（含 AI 提取待确认项）
      const todos = await getVisitTodoList({ customerId: customer.id })
      const todoSummary = todos
        .slice(0, 15)
        .map((t) => {
          const status = t.done ? '✅ 已完成' : t.confirmed ? '🔲 待跟进' : '🔲 待确认(AI提取)'
          const due = t.dueDate ? `，期限 ${new Date(t.dueDate).toISOString().slice(0, 10)}` : ''
          const owner = t.owner ? `，负责人 ${t.owner}` : ''
          return `- [${status}] ${t.content}${due}${owner}`
        })
        .join('\n') || '（无待办）'

      const data = {
        customerId: customer.id,
        customerName: customer.name,
        customerType: customer.type === 'individual' ? '个人客户' : '企业客户',
        industry: customer.industry || '未填写',
        profile: customer.profile || '',
        visitCount: visits.length,
        visits: visitSummary,
        todos: todoSummary,
      }

      return {
        success: true,
        data,
        message: `已读取客户「${customer.name}」的结构化上下文：${visits.length} 条拜访记录、${todos.length} 条待办。`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: `读取客户上下文失败: ${message}` }
    }
  },
}
