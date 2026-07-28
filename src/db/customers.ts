import { getDb } from './index'

// 客户类型：企业 | 个人
export type CustomerType = 'enterprise' | 'individual'

export interface CustomerRecord {
  id: string
  name: string
  type: string // enterprise | individual
  industry: string // 行业（空串表示未填写）
  profile: string // 备注画像（空串表示未填写）
  folderPath: string // 工作区内客户文件夹相对路径
  isPinned: number // 1 置顶 / 0 默认
  createdAt: number
  updatedAt: number
}

/**
 * 初始化 customers 表
 */
export async function initCustomersDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'enterprise',
      industry TEXT DEFAULT '',
      profile TEXT DEFAULT '',
      folderPath TEXT DEFAULT '',
      isPinned INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
}

/**
 * 新建客户（id/时间戳由本函数生成），返回完整记录
 */
export async function createCustomerRecord(input: {
  name: string
  type?: CustomerType
  industry?: string
  profile?: string
  folderPath?: string
}): Promise<CustomerRecord> {
  const db = await getDb()
  const now = Date.now()
  const record: CustomerRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    type: input.type || 'enterprise',
    industry: input.industry || '',
    profile: input.profile || '',
    folderPath: input.folderPath || '',
    isPinned: 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.execute(
    `INSERT INTO customers (id, name, type, industry, profile, folderPath, isPinned, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.id,
      record.name,
      record.type,
      record.industry,
      record.profile,
      record.folderPath,
      record.isPinned,
      record.createdAt,
      record.updatedAt,
    ]
  )
  return record
}

/**
 * 获取单个客户
 */
export async function getCustomer(id: string): Promise<CustomerRecord | null> {
  const db = await getDb()
  const results = await db.select<CustomerRecord[]>(
    'SELECT * FROM customers WHERE id = $1',
    [id]
  )
  return results[0] || null
}

/**
 * 客户列表：置顶优先，其余按更新时间倒序；keyword 非空时按名称模糊搜索
 */
export async function getCustomerList(keyword?: string): Promise<CustomerRecord[]> {
  const db = await getDb()
  const trimmed = keyword?.trim()
  if (trimmed) {
    // LIKE 模糊匹配，% 通配符转义后按参数绑定传入
    const escaped = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    return await db.select<CustomerRecord[]>(
      `SELECT * FROM customers WHERE name LIKE $1 ESCAPE '\\'
       ORDER BY isPinned DESC, updatedAt DESC`,
      [`%${escaped}%`]
    )
  }
  return await db.select<CustomerRecord[]>(
    'SELECT * FROM customers ORDER BY isPinned DESC, updatedAt DESC'
  )
}

/**
 * 更新客户字段（动态 SET + 字段白名单）
 */
export async function updateCustomerRecord(
  id: string,
  fields: Partial<Omit<CustomerRecord, 'id' | 'createdAt' | 'updatedAt'>>
) {
  const db = await getDb()
  const updatedAt = Date.now()

  // 动态构建 SET 子句
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const allowedFields = [
    'name',
    'type',
    'industry',
    'profile',
    'folderPath',
    'isPinned',
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
    `UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 删除客户（仅删数据库记录，客户文件夹保留在工作区中）
 */
export async function deleteCustomerRecord(id: string) {
  const db = await getDb()
  await db.execute('DELETE FROM customers WHERE id = $1', [id])
}

/**
 * 切换置顶状态，返回切换后的值（1 置顶 / 0 取消）
 */
export async function toggleCustomerPin(id: string): Promise<number> {
  const db = await getDb()
  const record = await getCustomer(id)
  if (!record) return 0
  const next = record.isPinned ? 0 : 1
  await db.execute(
    'UPDATE customers SET isPinned = $1, updatedAt = $2 WHERE id = $3',
    [next, Date.now(), id]
  )
  return next
}

/**
 * 删除客户时将级联清理的关联数据统计（删除确认框展示用，查询失败由调用方降级为不显示数字）
 */
export async function getCustomerCascadeStats(
  customerId: string
): Promise<{ visits: number; todos: number; meetings: number }> {
  const db = await getDb()
  const [visitRows, todoRows, meetingRows] = await Promise.all([
    db.select<{ count: number }[]>(
      'SELECT COUNT(*) AS count FROM visits WHERE customerId = $1',
      [customerId]
    ),
    db.select<{ count: number }[]>(
      'SELECT COUNT(*) AS count FROM visit_todos WHERE customerId = $1',
      [customerId]
    ),
    db.select<{ count: number }[]>(
      'SELECT COUNT(*) AS count FROM meetings WHERE customerId = $1',
      [customerId]
    ),
  ])
  return {
    visits: visitRows[0]?.count ?? 0,
    todos: todoRows[0]?.count ?? 0,
    meetings: meetingRows[0]?.count ?? 0,
  }
}
