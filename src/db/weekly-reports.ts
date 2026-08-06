import { getDb } from './index'
import type { VisitTodoRecord } from './visit-todos'

// 周报记录（weekly_reports 表）：每周一条，weekStart 为周一 0 点时间戳（唯一键）。
// content 为 Markdown 正文（AI 生成或手动编辑），aiGenerated 标记是否由 AI 生成。
export interface WeeklyReportRecord {
  id: string
  weekStart: number // 周一 0 点时间戳（唯一键）
  weekEnd: number // 周日 24 点时间戳
  content: string // 周报正文（Markdown）
  aiGenerated: number // 0 手动创建 | 1 AI 生成
  generatedAt: number // AI 生成时间戳（0 表示从未生成）
  createdAt: number
  updatedAt: number
}

// 周数据聚合结果（跨 visits / meetings / visit_todos 三表汇总）
export interface WeekVisitData {
  visitDate: number
  customerName: string
  visitType: string
  meetingSummary: string // 关联会议纪要摘要（前 200 字）
  stage: string
}

export interface WeekTodoData {
  completed: VisitTodoRecord[] // 本周完成的（updatedAt 落在本周）
  pending: VisitTodoRecord[] // 未完成的
  overdue: VisitTodoRecord[] // 逾期未完成（dueDate < weekStart 且 done=0）
  newThisWeek: VisitTodoRecord[] // 本周新建的（createdAt 落在本周）
}

export interface WeekData {
  visits: WeekVisitData[]
  todos: WeekTodoData
  stats: {
    visitCount: number
    customerCount: number
    todoTotal: number
    todoCompleted: number
    completionRate: number // 完成率（0~1）
    overdueCount: number
  }
  nextWeekTodos: VisitTodoRecord[] // 下周到期的未完成待办
}

/**
 * 初始化 weekly_reports 表
 */
export async function initWeeklyReportsDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      weekStart INTEGER NOT NULL,
      weekEnd INTEGER NOT NULL,
      content TEXT DEFAULT '',
      aiGenerated INTEGER DEFAULT 0,
      generatedAt INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  await db.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(weekStart)'
  )
}

/**
 * 获取或创建某周的周报（weekStart 为周一 0 点时间戳）
 */
export async function getOrCreateWeeklyReport(
  weekStart: number
): Promise<WeeklyReportRecord> {
  const db = await getDb()
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000
  const existing = await db.select<WeeklyReportRecord[]>(
    'SELECT * FROM weekly_reports WHERE weekStart = $1',
    [weekStart]
  )
  if (existing[0]) return existing[0]

  const now = Date.now()
  const record: WeeklyReportRecord = {
    id: crypto.randomUUID(),
    weekStart,
    weekEnd,
    content: '',
    aiGenerated: 0,
    generatedAt: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.execute(
    `INSERT INTO weekly_reports (id, weekStart, weekEnd, content, aiGenerated, generatedAt, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.weekStart,
      record.weekEnd,
      record.content,
      record.aiGenerated,
      record.generatedAt,
      record.createdAt,
      record.updatedAt,
    ]
  )
  return record
}

/**
 * 更新周报正文
 */
export async function updateWeeklyReportContent(
  id: string,
  content: string
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE weekly_reports SET content = $1, updatedAt = $2 WHERE id = $3',
    [content, Date.now(), id]
  )
}

/**
 * 标记周报为 AI 生成
 */
export async function markWeeklyReportGenerated(
  id: string,
  content: string
): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    'UPDATE weekly_reports SET content = $1, aiGenerated = 1, generatedAt = $2, updatedAt = $3 WHERE id = $4',
    [content, now, now, id]
  )
}

/**
 * 获取周报列表（weekStart 倒序，最近 N 周）
 */
export async function getWeeklyReportList(
  limit?: number
): Promise<WeeklyReportRecord[]> {
  const db = await getDb()
  const sql = limit
    ? 'SELECT * FROM weekly_reports ORDER BY weekStart DESC LIMIT $1'
    : 'SELECT * FROM weekly_reports ORDER BY weekStart DESC'
  const params = limit ? [limit] : []
  return await db.select<WeeklyReportRecord[]>(sql, params)
}

/**
 * 获取某周的聚合数据（拜访 + 待办 + 统计 + 下周待办）
 * 跨 visits / meetings / visit_todos / customers 四表汇总
 */
export async function getWeekData(
  weekStart: number,
  weekEnd: number
): Promise<WeekData> {
  const db = await getDb()
  const nextWeekStart = weekEnd
  const nextWeekEnd = weekEnd + 7 * 24 * 60 * 60 * 1000

  // 1. 本周拜访记录（关联客户名 + 会议纪要摘要）
  const visits = await db.select<Array<{
    visitDate: number
    customerName: string
    visitType: string
    meetingSummary: string
    stage: string
  }>>(
    `SELECT
       v.visitDate,
       COALESCE(c.name, '') AS customerName,
       v.visitType,
       COALESCE(SUBSTR(m.summary, 1, 200), '') AS meetingSummary,
       v.stage
     FROM visits v
     LEFT JOIN customers c ON c.id = v.customerId
     LEFT JOIN meetings m ON m.id = v.meetingId
     WHERE v.visitDate >= $1 AND v.visitDate < $2
     ORDER BY v.visitDate ASC`,
    [weekStart, weekEnd]
  )

  // 2. 本周所有已确认的待办（排除已删除）
  const allTodos = await db.select<VisitTodoRecord[]>(
    `SELECT * FROM visit_todos
     WHERE confirmed = 1 AND deleted = 0
       AND (dueDate >= $1 AND dueDate < $2
            OR updatedAt >= $1 AND updatedAt < $2 AND done = 1
            OR createdAt >= $1 AND createdAt < $2
            OR dueDate < $1 AND done = 0)`,
    [weekStart, weekEnd]
  )

  // 分类
  const completed: VisitTodoRecord[] = []
  const pending: VisitTodoRecord[] = []
  const overdue: VisitTodoRecord[] = []
  const newThisWeek: VisitTodoRecord[] = []

  const seenIds = new Set<string>()
  for (const todo of allTodos) {
    if (seenIds.has(todo.id)) continue
    seenIds.add(todo.id)

    if (todo.dueDate > 0 && todo.dueDate < weekStart && todo.done === 0) {
      overdue.push(todo)
    }
    if (todo.done === 1 && todo.updatedAt >= weekStart && todo.updatedAt < weekEnd) {
      completed.push(todo)
    }
    if (todo.done === 0 && todo.dueDate >= weekStart && todo.dueDate < weekEnd) {
      pending.push(todo)
    } else if (todo.done === 0 && todo.dueDate === 0) {
      // 无截止日期且未完成：计入 pending（此前只进 newThisWeek，完成率分母少算，O14）
      pending.push(todo)
    }
    if (todo.createdAt >= weekStart && todo.createdAt < weekEnd) {
      newThisWeek.push(todo)
    }
  }

  // 排序：按 dueDate 升序（0 排最后）
  const sortByDueDate = (a: VisitTodoRecord, b: VisitTodoRecord) => {
    const aDue = a.dueDate === 0 ? Number.MAX_SAFE_INTEGER : a.dueDate
    const bDue = b.dueDate === 0 ? Number.MAX_SAFE_INTEGER : b.dueDate
    return aDue - bDue
  }
  completed.sort(sortByDueDate)
  pending.sort(sortByDueDate)
  overdue.sort(sortByDueDate)
  newThisWeek.sort(sortByDueDate)

  // 3. 下周到期的未完成待办
  const nextWeekTodos = await db.select<VisitTodoRecord[]>(
    `SELECT * FROM visit_todos
     WHERE confirmed = 1 AND deleted = 0 AND done = 0
       AND dueDate >= $1 AND dueDate < $2
     ORDER BY dueDate ASC`,
    [nextWeekStart, nextWeekEnd]
  )

  // 4. 统计
  const customerSet = new Set(
    visits
      .map((v) => v.customerName)
      .filter((name) => name !== '')
  )
  const todoTotal = completed.length + pending.length + overdue.length
  const completionRate = todoTotal > 0 ? completed.length / todoTotal : 0

  return {
    visits,
    todos: { completed, pending, overdue, newThisWeek },
    stats: {
      visitCount: visits.length,
      customerCount: customerSet.size,
      todoTotal,
      todoCompleted: completed.length,
      completionRate,
      overdueCount: overdue.length,
    },
    nextWeekTodos,
  }
}

/**
 * 获取当前周的 weekStart（周一 0 点时间戳）
 */
export function getCurrentWeekStart(date: Date = new Date()): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayOfWeek = d.getDay() // 0=周日, 1=周一
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // 回到周一
  d.setDate(d.getDate() + diff)
  return d.getTime()
}

/**
 * 获取指定周前/后 N 周的 weekStart
 */
export function getWeekStartOffset(
  weekStart: number,
  offsetWeeks: number
): number {
  // 用本地时区加 7 天而非固定毫秒偏移：跨夏令时切换的周（国际版）不会漂移（O8）
  if (offsetWeeks === 0) return weekStart
  const d = new Date(weekStart)
  d.setDate(d.getDate() + offsetWeeks * 7)
  return d.getTime()
}

/**
 * 格式化周日期范围（如 "7.28 - 8.3"）
 */
export function formatWeekRange(weekStart: number): string {
  const start = new Date(weekStart)
  const end = new Date(weekStart + 6 * 24 * 60 * 60 * 1000)
  return `${start.getMonth() + 1}.${start.getDate()} - ${end.getMonth() + 1}.${end.getDate()}`
}

/**
 * 格式化周标识（如 "2026年第31周"）
 * 严格 ISO 8601 周数（ISO 周从周一开始，第 1 周是含当年第一个周四的那周）——
 * 旧的近似算法在 12 月底/1 月初会错标成"53 周"（实为下一年第 1 周）
 */
export function formatWeekLabel(weekStart: number): string {
  const start = new Date(weekStart)
  // ISO 周：周四所在年即周归属年；周四 = 本周一 + 3 天
  const thursday = new Date(start)
  thursday.setDate(start.getDate() + 3)
  const isoYear = thursday.getFullYear()
  // 该年 1 月 1 日所在周的周一（ISO 周一对齐）
  const firstThursday = new Date(isoYear, 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7))
  const weekNum = Math.round(
    (thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
  ) + 1
  return `${isoYear}年第${weekNum}周`
}
