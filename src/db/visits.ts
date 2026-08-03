import { getDb } from './index'

// 拜访阶段：preparing 访前准备 | visited 已拜访（纪要导出触发）
// 'followed' 已废弃：报告生成提升到客户级后不再写入，仅为兼容历史数据保留在类型中
export type VisitStage = 'preparing' | 'visited' | 'followed'

// 拜访类型：first-visit 首次拜访 | regular-return 定期回访 | post-loan 贷后检查 | marketing 营销走访 | '' 未指定
export type VisitType = 'first-visit' | 'regular-return' | 'post-loan' | 'marketing' | ''

export interface VisitRecord {
  id: string
  customerId: string
  title: string // 如"2026-07-30 首次拜访"
  visitDate: number // 拜访时间戳（0 表示未确定）
  stage: string // preparing | visited（历史数据可能为已废弃的 followed）
  visitType: string // first-visit | regular-return | post-loan | marketing | ''（2.1 B5 新增）
  previsitDocPath: string // 访前材料路径（空串表示无）
  meetingId: string // 关联会议 ID（空串表示未关联）
  noteDocPath: string // 关联笔记文档路径（归档型拜访的访中记录，空串表示无；2.4 新增）
  postDocs: string // 访后产物路径 JSON 数组（空串表示无）
  notes: string
  createdAt: number
  updatedAt: number
}

/**
 * 初始化 visits 表（拜访生命周期枢纽）
 */
export async function initVisitsDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      title TEXT DEFAULT '',
      visitDate INTEGER DEFAULT 0,
      stage TEXT DEFAULT 'preparing',
      previsitDocPath TEXT DEFAULT '',
      meetingId TEXT DEFAULT '',
      noteDocPath TEXT DEFAULT '',
      postDocs TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_visits_customer ON visits(customerId)'
  )
  // 2.1 B5 新增：拜访类型（供时间线展示与后续过滤）
  await ensureColumn(db, 'visitType', `visitType TEXT DEFAULT ''`)
  // 2.4 新增：归档型拜访的访中笔记文档路径（不走录音会议的拜访，访中内容为一篇笔记）
  await ensureColumn(db, 'noteDocPath', `noteDocPath TEXT DEFAULT ''`)
}

/**
 * 通过 PRAGMA table_info 判断列是否存在，不存在时才 ALTER TABLE（与 meetings 表同款兼容模式）
 */
async function ensureColumn(
  db: Awaited<ReturnType<typeof getDb>>,
  column: string,
  definition: string
) {
  const columns = await db.select<Array<{ name: string }>>(
    'PRAGMA table_info(visits)'
  )
  if (!columns.some((c) => c.name === column)) {
    await db.execute(`ALTER TABLE visits ADD COLUMN ${definition}`)
  }
}

/**
 * 新建拜访（id/时间戳由本函数生成），返回完整记录
 */
export async function createVisitRecord(input: {
  customerId: string
  title?: string
  visitDate?: number
  stage?: VisitStage
  visitType?: VisitType
  notes?: string
  meetingId?: string
}): Promise<VisitRecord> {
  const db = await getDb()
  const now = Date.now()
  const record: VisitRecord = {
    id: crypto.randomUUID(),
    customerId: input.customerId,
    title: input.title || '',
    visitDate: input.visitDate || 0,
    stage: input.stage || 'preparing',
    visitType: input.visitType || '',
    previsitDocPath: '',
    meetingId: input.meetingId || '',
    noteDocPath: '',
    postDocs: '',
    notes: input.notes || '',
    createdAt: now,
    updatedAt: now,
  }
  await db.execute(
    `INSERT INTO visits (id, customerId, title, visitDate, stage, visitType, previsitDocPath, meetingId, noteDocPath, postDocs, notes, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      record.id,
      record.customerId,
      record.title,
      record.visitDate,
      record.stage,
      record.visitType,
      record.previsitDocPath,
      record.meetingId,
      record.noteDocPath,
      record.postDocs,
      record.notes,
      record.createdAt,
      record.updatedAt,
    ]
  )
  return record
}

/**
 * 获取单个拜访
 */
export async function getVisit(id: string): Promise<VisitRecord | null> {
  const db = await getDb()
  const results = await db.select<VisitRecord[]>(
    'SELECT * FROM visits WHERE id = $1',
    [id]
  )
  return results[0] || null
}

/**
 * 按拜访时间倒序获取全部拜访
 */
export async function getVisitList(): Promise<VisitRecord[]> {
  const db = await getDb()
  return await db.select<VisitRecord[]>(
    'SELECT * FROM visits ORDER BY visitDate DESC, updatedAt DESC'
  )
}

/**
 * 获取某客户的全部拜访（拜访时间倒序）
 */
export async function getVisitsByCustomer(customerId: string): Promise<VisitRecord[]> {
  const db = await getDb()
  return await db.select<VisitRecord[]>(
    'SELECT * FROM visits WHERE customerId = $1 ORDER BY visitDate DESC, updatedAt DESC',
    [customerId]
  )
}

// 跨客户的待拜访记录（关联 customers 取客户名，供工作台「近 7 天待拜访」卡片使用）
export interface UpcomingVisitRecord extends VisitRecord {
  customerName: string
}

/**
 * 查询近 N 天待拜访（stage='preparing' 且 visitDate 落在 今天0点 ~ 今天0点+withinDays 天 区间），
 * 跨客户按拜访时间正序。客户已被删除时 customerName 为空串（LEFT JOIN 兜底）。
 */
export async function getUpcomingVisits(withinDays: number): Promise<UpcomingVisitRecord[]> {
  const db = await getDb()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = startOfToday + withinDays * 24 * 60 * 60 * 1000
  return await db.select<UpcomingVisitRecord[]>(
    `SELECT v.*, COALESCE(c.name, '') AS customerName
     FROM visits v
     LEFT JOIN customers c ON c.id = v.customerId
     WHERE v.stage = 'preparing' AND v.visitDate >= $1 AND v.visitDate < $2
     ORDER BY v.visitDate ASC, v.updatedAt DESC`,
    [startOfToday, end]
  )
}

/**
 * 更新拜访字段（动态 SET + 字段白名单）
 */
export async function updateVisitRecord(
  id: string,
  fields: Partial<Omit<VisitRecord, 'id' | 'customerId' | 'createdAt' | 'updatedAt'>>
) {
  const db = await getDb()
  const updatedAt = Date.now()

  // 动态构建 SET 子句
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const allowedFields = [
    'title',
    'visitDate',
    'stage',
    'visitType',
    'previsitDocPath',
    'meetingId',
    'noteDocPath',
    'postDocs',
    'notes',
  ] as const

  for (const field of allowedFields) {
    if (field in fields) {
      setClauses.push(`${field} = $${paramIndex}`)
      values.push(fields[field as keyof typeof fields])
      paramIndex++
    }
  }

  setClauses.push(`updatedAt = $${paramIndex}`)
  values.push(updatedAt)
  paramIndex++

  values.push(id)

  await db.execute(
    `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 删除拜访
 */
export async function deleteVisitRecord(id: string) {
  const db = await getDb()
  await db.execute('DELETE FROM visits WHERE id = $1', [id])
}

/**
 * 删除某客户的全部拜访（删除客户时级联清理，避免残留孤儿记录）
 */
export async function deleteVisitsByCustomer(customerId: string) {
  const db = await getDb()
  await db.execute('DELETE FROM visits WHERE customerId = $1', [customerId])
}

/**
 * 清空某会议在拜访记录中的关联（删除会议时调用，避免悬空 meetingId 引用）
 */
export async function clearVisitMeetingLink(meetingId: string) {
  const db = await getDb()
  await db.execute(
    'UPDATE visits SET meetingId = $1, updatedAt = $2 WHERE meetingId = $3',
    ['', Date.now(), meetingId]
  )
}
