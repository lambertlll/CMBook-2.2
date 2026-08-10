import { getDb } from './index'
import type Database from '@tauri-apps/plugin-sql'

export interface MeetingRecord {
  id: string
  title: string
  status: string // idle | recording | paused | transcribing | generating | completed
  manualNotes: string
  transcript: string
  summary: string
  selectedTemplate: string
  selectedModel: string // 模型 ID（对应 aiModelList 中的 model.id）
  duration: number // 秒
  audioPath: string // 第一段音频文件保存路径（续录会议的多段路径见 audioSegments）
  audioSegments: string // 全部音频段路径的 JSON 数组（空串表示无，老数据回退用 audioPath）
  error: string // 失败信息（空串表示无错误）
  customerId?: string // 关联客户 ID（2.0 新增，空串表示未关联）
  visitId?: string // 关联拜访 ID（2.0 新增，空串表示未关联）
  exportedFilePath?: string // 纪要导出到客户知识库的文件相对路径（空串表示未导出）
  pendingTranscribe?: number // 1=离线结束待联网补转写（P1-2：独立布尔字段替代 error 文案匹配）
  createdAt: number
  updatedAt: number
}

// 列表展示用的元数据记录（不含 transcript/summary/manualNotes 等大字段；
// hasSummary 是 SELECT 里的计算列，标记该会议是否已有纪要）
export type MeetingListRecord = Omit<
  MeetingRecord,
  'manualNotes' | 'transcript' | 'summary'
> & { hasSummary: number }

/**
 * 初始化 meetings 表
 */
export async function initMeetingsDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      status TEXT DEFAULT 'completed',
      manualNotes TEXT DEFAULT '',
      transcript TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      selectedTemplate TEXT DEFAULT 'default',
      duration INTEGER DEFAULT 0,
      audioPath TEXT DEFAULT '',
      audioSegments TEXT DEFAULT '',
      error TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  // 兼容已有数据库：按需补充缺失的列
  await ensureColumn(db, 'audioPath', `audioPath TEXT DEFAULT ''`)
  await ensureColumn(db, 'audioSegments', `audioSegments TEXT DEFAULT ''`)
  await ensureColumn(db, 'selectedModel', `selectedModel TEXT DEFAULT ''`)
  await ensureColumn(db, 'error', `error TEXT DEFAULT ''`)
  // 2.0 新增：会议关联客户/拜访
  await ensureColumn(db, 'customerId', `customerId TEXT DEFAULT ''`)
  await ensureColumn(db, 'visitId', `visitId TEXT DEFAULT ''`)
  // 2.0 新增：纪要导出到客户知识库的文件路径（重新导出时据此清理旧文件，删除会议时级联清理）
  await ensureColumn(db, 'exportedFilePath', `exportedFilePath TEXT DEFAULT ''`)
  // 2.8.3 新增：离线结束待补转写标记（独立布尔字段，替代 error 文案匹配的脆弱方案）
  await ensureColumn(db, 'pendingTranscribe', `pendingTranscribe INTEGER DEFAULT 0`)
}

/**
 * 通过 PRAGMA table_info 判断列是否存在，不存在时才 ALTER TABLE
 */
async function ensureColumn(db: Database, column: string, definition: string) {
  const columns = await db.select<Array<{ name: string }>>(
    'PRAGMA table_info(meetings)'
  )
  if (!columns.some((c) => c.name === column)) {
    await db.execute(`ALTER TABLE meetings ADD COLUMN ${definition}`)
  }
}

// 列表查询的元数据列（排除 transcript/summary/manualNotes 大字段；
// hasSummary 为计算列：不读 summary 内容即可获得"是否已有纪要"标记，供工作台待归类卡片等场景使用）
const LIST_COLUMNS =
  'id, title, status, selectedTemplate, selectedModel, duration, audioPath, audioSegments, error, customerId, visitId, exportedFilePath, pendingTranscribe, createdAt, updatedAt, (CASE WHEN summary IS NULL OR summary = \'\' THEN 0 ELSE 1 END) AS hasSummary'

/**
 * 获取所有会议的元数据（按创建时间倒序，不含大字段，列表展示用）
 */
export async function getMeetingList(): Promise<MeetingListRecord[]> {
  const db = await getDb()
  return await db.select<MeetingListRecord[]>(
    `SELECT ${LIST_COLUMNS} FROM meetings ORDER BY createdAt DESC`
  )
}

// 全局搜索用的轻量结果（不含 transcript/summary 等大字段；
// matchSource 标记标题命中还是纪要命中，snippet 为纪要命中时截取的上下文片段）
export interface MeetingSearchResult {
  id: string
  title: string
  status: string
  createdAt: number
  hasSummary: number
  matchSource: 'title' | 'summary'
  snippet: string
}

/**
 * 全局搜索会议：标题 LIKE 优先，其次纪要内容 LIKE（参数绑定 + LIKE 通配符转义）。
 * 纪要命中时截取匹配位置前后约 60 字上下文作为片段；标题命中在前、按创建时间倒序，限量返回。
 */
export async function searchMeetings(
  keyword: string,
  limit = 20
): Promise<MeetingSearchResult[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const db = await getDb()
  // 转义 LIKE 特殊字符（\ % _），避免用户输入干扰匹配
  const escaped = kw.replace(/[\\%_]/g, (c) => `\\${c}`)
  const like = `%${escaped}%`
  return await db.select<MeetingSearchResult[]>(
    `SELECT id, title, status, createdAt,
       (CASE WHEN summary IS NULL OR summary = '' THEN 0 ELSE 1 END) AS hasSummary,
       (CASE WHEN title LIKE $1 ESCAPE '\\' THEN 'title' ELSE 'summary' END) AS matchSource,
       (CASE
          WHEN title LIKE $1 ESCAPE '\\' THEN ''
          ELSE trim(substr(summary, MAX(instr(summary, $2) - 30, 1), 60))
        END) AS snippet
     FROM meetings
     WHERE title LIKE $1 ESCAPE '\\' OR summary LIKE $1 ESCAPE '\\'
     ORDER BY (CASE WHEN title LIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END), createdAt DESC
     LIMIT $3`,
    [like, kw, limit]
  )
}

/**
 * 获取单个会议
 */
export async function getMeeting(id: string): Promise<MeetingRecord | null> {
  const db = await getDb()
  const results = await db.select<MeetingRecord[]>(
    'SELECT * FROM meetings WHERE id = $1',
    [id]
  )
  return results[0] || null
}

/**
 * 插入新会议
 */
export async function insertMeeting(meeting: MeetingRecord) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO meetings (id, title, status, manualNotes, transcript, summary, selectedTemplate, selectedModel, duration, audioPath, audioSegments, error, customerId, visitId, exportedFilePath, pendingTranscribe, createdAt, updatedAt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      meeting.id,
      meeting.title,
      meeting.status,
      meeting.manualNotes,
      meeting.transcript,
      meeting.summary,
      meeting.selectedTemplate,
      meeting.selectedModel || '',
      meeting.duration,
      meeting.audioPath,
      meeting.audioSegments || '',
      meeting.error || '',
      meeting.customerId || '',
      meeting.visitId || '',
      meeting.exportedFilePath || '',
      meeting.pendingTranscribe ? 1 : 0,
      meeting.createdAt,
      meeting.updatedAt,
    ]
  )
}

/**
 * 更新会议字段
 */
export async function updateMeetingRecord(
  id: string,
  fields: Partial<Omit<MeetingRecord, 'id' | 'createdAt'>>
) {
  const db = await getDb()
  const updatedAt = Date.now()

  // 动态构建 SET 子句
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  const allowedFields = [
    'title',
    'status',
    'manualNotes',
    'transcript',
    'summary',
    'selectedTemplate',
    'selectedModel',
    'duration',
    'audioPath',
    'audioSegments',
    'error',
    'customerId',
    'visitId',
    'exportedFilePath',
    'pendingTranscribe',
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
    `UPDATE meetings SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  )
}

/**
 * 删除会议
 */
export async function deleteMeetingRecord(id: string) {
  const db = await getDb()
  await db.execute('DELETE FROM meetings WHERE id = $1', [id])
}

/**
 * 清空某客户名下所有会议的客户/拜访关联（删除客户时级联调用，会议本身保留）
 * 同时清空 exportedFilePath：客户知识库文件夹与其向量索引已随客户删除，
 * 会议上的导出路径引用必须清空，避免"文件在、索引无"的悬空引用
 */
export async function clearMeetingCustomerLink(customerId: string) {
  const db = await getDb()
  await db.execute(
    `UPDATE meetings SET customerId = '', visitId = '', exportedFilePath = '', updatedAt = $2 WHERE customerId = $1`,
    [customerId, Date.now()]
  )
}

/**
 * 客户改名后，把该客户名下会议的 exportedFilePath 从旧文件夹前缀替换到新前缀
 * （导出路径存的是工作区相对路径，形如 customers/<旧名>/访中/xxx.md）。
 * 先按 customerId 查出全部记录，逐条替换（避免 SQL 里拼接前缀）。
 */
export async function renameMeetingExportPaths(customerId: string, oldPrefix: string, newPrefix: string) {
  const db = await getDb()
  const rows = await db.select<{ id: string; exportedFilePath: string }[]>(
    `SELECT id, exportedFilePath FROM meetings WHERE customerId = $1 AND exportedFilePath != ''`,
    [customerId]
  )
  for (const row of rows) {
    if (row.exportedFilePath.startsWith(oldPrefix)) {
      const newPath = `${newPrefix}${row.exportedFilePath.slice(oldPrefix.length)}`
      await db.execute(
        `UPDATE meetings SET exportedFilePath = $1, updatedAt = $2 WHERE id = $3`,
        [newPath, Date.now(), row.id]
      )
    }
  }
}
