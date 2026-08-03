import { getDb } from './index'
import {
  CMBOOK2_SCHEMA_KEY,
  CMBOOK2_SCHEMA_VERSION,
  getSchemaVersion,
  setSchemaVersion,
} from './schema-meta'

// 待办记录（visit_todos 表）：会议纪要自动提取 + 手动添加的个人待办统一存放。
// 手动添加的个人待办 customerId/visitId/meetingId 可为空串；dueDate 为 0 表示无/待定。
// confirmed 为确认制标记（2.3）：AI 提取的待办默认 0（待确认），用户确认后置 1；
// 手动添加的默认 1。未确认的待办只在"待确认"区展示，不进入正式分组与统计。
export interface VisitTodoRecord {
  id: string
  customerId: string
  visitId: string
  meetingId: string
  content: string // 跟进事项
  owner: string // 负责人（空串表示未指定）
  dueDate: number // 时限时间戳（0=无/待定）
  done: number // 0 未完成 | 1 已完成
  confirmed: number // 0 待确认（AI 提取）| 1 已确认
  deleted: number // 0 正常 | 1 已删除（软删除，可恢复）
  createdAt: number
  updatedAt: number
}

// 从纪要待办表解析出的待办行（replaceMeetingTodos 的入参）
export interface VisitTodoInputRow {
  customerId: string
  visitId: string
  content: string
  owner: string
  dueDate: number
  confirmed?: boolean
}

/**
 * 初始化 visit_todos 表（待办结构化，2.1 战略 1；2.3 起新增 confirmed 确认制列）。
 * 表本身 CREATE IF NOT EXISTS 幂等；同时承担 cmbook2 schema 版本迁移登记：
 * 旧版本（<当前版本）在补列后把版本号升到当前版本（照 schema-meta 现有登记模式）。
 */
export async function initVisitTodosDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS visit_todos (
      id TEXT PRIMARY KEY,
      customerId TEXT DEFAULT '',
      visitId TEXT DEFAULT '',
      meetingId TEXT DEFAULT '',
      content TEXT NOT NULL,
      owner TEXT DEFAULT '',
      dueDate INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0,
      confirmed INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_visit_todos_customer ON visit_todos(customerId)'
  )
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_visit_todos_done_due ON visit_todos(done, dueDate)'
  )

  // v3 迁移：老库的 visit_todos 没有 confirmed 列；补齐后，历史待办视为已确认（confirmed=1），
  // 避免升级后旧待办全部落入"待确认"区打扰用户
  const columns = await db.select<Array<{ name: string }>>(
    'PRAGMA table_info(visit_todos)'
  )
  if (!columns.some((c) => c.name === 'confirmed')) {
    await db.execute(
      'ALTER TABLE visit_todos ADD COLUMN confirmed INTEGER DEFAULT 0'
    )
    await db.execute('UPDATE visit_todos SET confirmed = 1')
  }

  // v5 迁移：visit_todos 新增 deleted 软删除列；历史数据默认 0（正常）
  if (!columns.some((c) => c.name === 'deleted')) {
    await db.execute(
      'ALTER TABLE visit_todos ADD COLUMN deleted INTEGER DEFAULT 0'
    )
  }

  // schema 版本迁移登记：新装库 initSchemaMetaDb 已直接写入当前版本，
  // 这里只在旧版本登记（<当前版本）时升级，保证幂等
  const current = (await getSchemaVersion(CMBOOK2_SCHEMA_KEY)) ?? 0
  if (current < CMBOOK2_SCHEMA_VERSION) {
    await setSchemaVersion(CMBOOK2_SCHEMA_KEY, CMBOOK2_SCHEMA_VERSION)
  }
}

/**
 * 新建待办（id/时间戳由本函数生成），返回完整记录。
 * confirmed 默认 true（手动添加即已确认）；AI 提取场景请走 replaceMeetingTodos（恒为待确认）。
 */
export async function createVisitTodo(input: {
  content: string
  customerId?: string
  visitId?: string
  meetingId?: string
  owner?: string
  dueDate?: number
  done?: boolean
  confirmed?: boolean
}): Promise<VisitTodoRecord> {
  const db = await getDb()
  const now = Date.now()
  const record: VisitTodoRecord = {
    id: crypto.randomUUID(),
    customerId: input.customerId || '',
    visitId: input.visitId || '',
    meetingId: input.meetingId || '',
    content: input.content,
    owner: input.owner || '',
    dueDate: input.dueDate || 0,
    done: input.done ? 1 : 0,
    confirmed: input.confirmed === undefined ? 1 : input.confirmed ? 1 : 0,
    deleted: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.execute(
    `INSERT INTO visit_todos (id, customerId, visitId, meetingId, content, owner, dueDate, done, confirmed, deleted, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      record.id,
      record.customerId,
      record.visitId,
      record.meetingId,
      record.content,
      record.owner,
      record.dueDate,
      record.done,
      record.confirmed,
      record.deleted,
      record.createdAt,
      record.updatedAt,
    ]
  )
  return record
}

/**
 * 获取单个待办
 */
export async function getVisitTodo(id: string): Promise<VisitTodoRecord | null> {
  const db = await getDb()
  const results = await db.select<VisitTodoRecord[]>(
    'SELECT * FROM visit_todos WHERE id = $1',
    [id]
  )
  return results[0] || null
}

/**
 * 删除待办（软删除：标记 deleted=1，可恢复）
 */
export async function deleteVisitTodo(id: string) {
  const db = await getDb()
  await db.execute(
    'UPDATE visit_todos SET deleted = 1, updatedAt = $1 WHERE id = $2',
    [Date.now(), id]
  )
}

/**
 * 恢复已删除的待办（deleted=0 → 正常）
 */
export async function restoreVisitTodo(id: string) {
  const db = await getDb()
  await db.execute(
    'UPDATE visit_todos SET deleted = 0, updatedAt = $1 WHERE id = $2',
    [Date.now(), id]
  )
}

/**
 * 永久删除待办（物理删除，不可恢复）
 */
export async function deleteVisitTodoPermanently(id: string) {
  const db = await getDb()
  await db.execute('DELETE FROM visit_todos WHERE id = $1', [id])
}

/**
 * 更新待办内容/负责人/时限
 */
export async function updateVisitTodo(
  id: string,
  updates: { content?: string; owner?: string; dueDate?: number }
) {
  const db = await getDb()
  const now = Date.now()
  const setClauses: string[] = ['updatedAt = $1']
  const values: unknown[] = [now]
  if (updates.content !== undefined) {
    values.push(updates.content)
    setClauses.push(`content = $${values.length}`)
  }
  if (updates.owner !== undefined) {
    values.push(updates.owner)
    setClauses.push(`owner = $${values.length}`)
  }
  if (updates.dueDate !== undefined) {
    values.push(updates.dueDate)
    setClauses.push(`dueDate = $${values.length}`)
  }
  values.push(id)
  await db.execute(
    `UPDATE visit_todos SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
    values
  )
}

/**
 * 按 meetingId 用最新解析行做"差异合并"（替代早期的整批删除重插）：
 * 以 content+owner 归一化文本为匹配键——
 * - 已存在且仍在新行中：保留原记录（**保留 done 完成态**、id、createdAt），仅 dueDate 变化时更新时限
 * - 新行中新增：插入（done=0）
 * - 已存在但不在新行中：删除
 * 这样用户重新生成/重新同步纪要时，已勾选的待办不会因整批替换而丢失完成状态。
 * 匹配键含 owner：内容相同但负责人不同的视为不同待办；归一化忽略多余空白。
 */
export async function replaceMeetingTodos(
  meetingId: string,
  rows: VisitTodoInputRow[],
  options?: { fullReset?: boolean }
) {
  const db = await getDb()

  // fullReset 模式：先删除该会议的所有待办，再全部作为新记录插入。
  // 用于待办确认弹窗：用户明确选择了哪些待办，应以新选择为准，
  // 不保留旧的 done/confirmed/删除状态。
  if (options?.fullReset) {
    await db.execute('DELETE FROM visit_todos WHERE meetingId = $1', [meetingId])
    const now = Date.now()
    const toInsert: Record<string, unknown>[] = rows.map((row) => ({
      id: crypto.randomUUID(),
      customerId: row.customerId,
      visitId: row.visitId,
      meetingId,
      content: row.content,
      owner: row.owner,
      dueDate: row.dueDate,
      done: 0,
      confirmed: row.confirmed ? 1 : 0,
      deleted: 0,
      createdAt: now,
      updatedAt: now,
    }))
    if (toInsert.length > 0) {
      await db.execute(
        `INSERT INTO visit_todos (id, customerId, visitId, meetingId, content, owner, dueDate, done, confirmed, deleted, createdAt, updatedAt)
         SELECT
           json_extract(value, '$.id'),
           json_extract(value, '$.customerId'),
           json_extract(value, '$.visitId'),
           json_extract(value, '$.meetingId'),
           json_extract(value, '$.content'),
           json_extract(value, '$.owner'),
           json_extract(value, '$.dueDate'),
           json_extract(value, '$.done'),
           json_extract(value, '$.confirmed'),
           json_extract(value, '$.deleted'),
           json_extract(value, '$.createdAt'),
           json_extract(value, '$.updatedAt')
         FROM json_each($1)`,
        [JSON.stringify(toInsert)]
      )
    }
    return
  }

  // 差异合并模式（默认）：用于纪要重新生成/自动同步时保留已勾选的完成状态

  // 该会议现有待办（含已软删除的，用于匹配）
  const existing = await db.select<VisitTodoRecord[]>(
    'SELECT * FROM visit_todos WHERE meetingId = $1',
    [meetingId]
  )

  // 匹配键：content+owner 归一化（压缩连续空白），忽略格式差异
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ')
  const keyOf = (content: string, owner: string) =>
    `${normalize(content)}||${normalize(owner)}`

  const existingByKey = new Map(existing.map((e) => [keyOf(e.content, e.owner), e]))
  const newKeys = new Set<string>()
  const now = Date.now()
  const toInsert: Record<string, unknown>[] = []
  const dueDateUpdates: Array<{ id: string; dueDate: number }> = []
  const confirmedUpdates: Array<{ id: string; confirmed: number }> = []
  const restoreUpdates: string[] = [] // 软删除待办重新出现时恢复

  for (const row of rows) {
    const key = keyOf(row.content, row.owner)
    if (newKeys.has(key)) continue // 新行内部去重（同内容同负责人只保留一条）
    newKeys.add(key)
    const old = existingByKey.get(key)
    if (!old) {
      toInsert.push({
        id: crypto.randomUUID(),
        customerId: row.customerId,
        visitId: row.visitId,
        meetingId,
        content: row.content,
        owner: row.owner,
        dueDate: row.dueDate,
        done: 0,
        confirmed: row.confirmed ? 1 : 0,
        deleted: 0,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      // 保留完成态，仅同步时限变化
      if (old.dueDate !== row.dueDate) {
        dueDateUpdates.push({ id: old.id, dueDate: row.dueDate })
      }
      // 用户确认弹窗显式传 confirmed 时，同步更新已有记录的确认状态
      if (row.confirmed !== undefined && old.confirmed !== (row.confirmed ? 1 : 0)) {
        confirmedUpdates.push({ id: old.id, confirmed: row.confirmed ? 1 : 0 })
      }
      // 软删除的待办重新出现在纪要中时自动恢复
      if (old.deleted === 1) {
        restoreUpdates.push(old.id)
      }
    }
  }

  // 不在新行中的旧记录：物理删除（差异合并语义——纪要中已移除）
  const toDelete = existing.filter((e) => !newKeys.has(keyOf(e.content, e.owner)))
  for (const e of toDelete) {
    await db.execute('DELETE FROM visit_todos WHERE id = $1', [e.id])
  }

  // 时限变更更新
  for (const u of dueDateUpdates) {
    await db.execute(
      'UPDATE visit_todos SET dueDate = $1, updatedAt = $2 WHERE id = $3',
      [u.dueDate, now, u.id]
    )
  }

  // 确认状态变更更新（用户确认弹窗显式传 confirmed 时）
  for (const u of confirmedUpdates) {
    await db.execute(
      'UPDATE visit_todos SET confirmed = $1, updatedAt = $2 WHERE id = $3',
      [u.confirmed, now, u.id]
    )
  }

  // 软删除的待办重新出现在纪要中时自动恢复（deleted=0）
  for (const id of restoreUpdates) {
    await db.execute(
      'UPDATE visit_todos SET deleted = 0, updatedAt = $1 WHERE id = $2',
      [now, id]
    )
  }

  // 新增项单条 SQL 批量写入（json_each），避免逐条 IPC
  // 注意：json_each 虚拟表只有 key/value/type/atom/id/parent/fullkey/path 列，
  // 不能直接 SELECT JSON 字段名，必须用 json_extract(value, '$.field') 提取
  if (toInsert.length > 0) {
    await db.execute(
      `INSERT INTO visit_todos (id, customerId, visitId, meetingId, content, owner, dueDate, done, confirmed, deleted, createdAt, updatedAt)
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.customerId'),
         json_extract(value, '$.visitId'),
         json_extract(value, '$.meetingId'),
         json_extract(value, '$.content'),
         json_extract(value, '$.owner'),
         json_extract(value, '$.dueDate'),
         json_extract(value, '$.done'),
         json_extract(value, '$.confirmed'),
         json_extract(value, '$.deleted'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each($1)`,
      [JSON.stringify(toInsert)]
    )
  }
}

/**
 * 确认待办（AI 提取的待办经用户确认后进入正式分组），返回是否成功
 */
export async function confirmVisitTodo(id: string): Promise<boolean> {
  const db = await getDb()
  const result = await db.execute(
    'UPDATE visit_todos SET confirmed = 1, updatedAt = $1 WHERE id = $2',
    [Date.now(), id]
  )
  return result.rowsAffected > 0
}

/**
 * 获取待办列表，支持 done/customerId/confirmed 过滤。
 * 默认排除已删除（deleted=0）的待办；传入 includeDeleted: true 可同时返回已删除项。
 * 默认排序：未完成优先（done ASC）→ 时限近者优先（dueDate ASC，0 无时限排最后）→ 新创建优先（createdAt DESC）
 */
export async function getVisitTodoList(filter?: {
  done?: boolean
  customerId?: string
  confirmed?: boolean
  includeDeleted?: boolean
}): Promise<VisitTodoRecord[]> {
  const db = await getDb()
  const conditions: string[] = []
  const values: unknown[] = []
  if (filter?.done !== undefined) {
    conditions.push(`done = $${values.length + 1}`)
    values.push(filter.done ? 1 : 0)
  }
  if (filter?.customerId !== undefined) {
    conditions.push(`customerId = $${values.length + 1}`)
    values.push(filter.customerId)
  }
  if (filter?.confirmed !== undefined) {
    conditions.push(`confirmed = $${values.length + 1}`)
    values.push(filter.confirmed ? 1 : 0)
  }
  if (!filter?.includeDeleted) {
    conditions.push(`deleted = 0`)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  return await db.select<VisitTodoRecord[]>(
    `SELECT * FROM visit_todos${where}
     ORDER BY done ASC, CASE WHEN dueDate = 0 THEN 1 ELSE 0 END ASC, dueDate ASC, createdAt DESC`,
    values
  )
}

/**
 * 切换待办完成态，返回切换后的新值（true=已完成）
 */
export async function toggleVisitTodoDone(id: string): Promise<boolean> {
  const db = await getDb()
  const current = await getVisitTodo(id)
  if (!current) {
    throw new Error(`visit todo not found: ${id}`)
  }
  const next = current.done === 1 ? 0 : 1
  await db.execute(
    'UPDATE visit_todos SET done = $1, updatedAt = $2 WHERE id = $3',
    [next, Date.now(), id]
  )
  return next === 1
}

/**
 * 删除某客户的全部待办（删除客户时级联清理，避免残留孤儿记录）
 */
export async function deleteVisitTodosByCustomer(customerId: string) {
  const db = await getDb()
  await db.execute('DELETE FROM visit_todos WHERE customerId = $1', [customerId])
}

/**
 * 删除某会议产生的全部待办（删除会议时级联清理，避免待办面板残留"幽灵待办"）
 */
export async function deleteVisitTodosByMeeting(meetingId: string) {
  const db = await getDb()
  await db.execute('DELETE FROM visit_todos WHERE meetingId = $1', [meetingId])
}
