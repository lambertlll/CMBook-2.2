import { getDb } from './index'

// 2.0 基线的 schema 版本标记：后续结构变更按版本号递增做迁移
// v2（2.1 战略 1）：新增 visit_todos 待办表
// v3（2.3 工作流）：visit_todos 新增 confirmed 确认制列，历史待办迁移为已确认
// v4（2.4 拜访形态）：visits 新增 noteDocPath 归档型拜访的访中笔记文档列
// v5（2.5 待办增强）：visit_todos 新增 deleted 软删除列，删除改为标记可恢复
// v6（2.6 周报）：新增 weekly_reports 表（周报正文 + AI 生成标记）
// v7（2.8.3 离线待补转写）：meetings 新增 pendingTranscribe 离线待补转写标记列（ensureColumn 幂等加列）
// （迁移均在 db/visit-todos.ts / db/visits.ts / db/weekly-reports.ts / db/meetings.ts 的 init 中完成）
export const CMBOOK2_SCHEMA_KEY = 'cmbook2'
export const CMBOOK2_SCHEMA_VERSION = 7

export interface SchemaMetaRecord {
  key: string
  version: number
  appliedAt: number
}

/**
 * 初始化 schema_meta 表（schema 版本登记表），并幂等写入 2.0 基线版本记录
 */
export async function initSchemaMetaDb() {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      appliedAt INTEGER NOT NULL
    )
  `)

  // 写入 2.0 基线版本（已存在时不覆盖，保证幂等且不影响后续版本升级）
  await db.execute(
    'INSERT OR IGNORE INTO schema_meta (key, version, appliedAt) VALUES ($1, $2, $3)',
    [CMBOOK2_SCHEMA_KEY, CMBOOK2_SCHEMA_VERSION, Date.now()]
  )
}

/**
 * 读取某个 schema 的版本号，未登记时返回 null
 */
export async function getSchemaVersion(key: string): Promise<number | null> {
  const db = await getDb()
  const results = await db.select<SchemaMetaRecord[]>(
    'SELECT key, version, appliedAt FROM schema_meta WHERE key = $1',
    [key]
  )
  return results[0]?.version ?? null
}

/**
 * 登记/更新某个 schema 的版本号（upsert）
 */
export async function setSchemaVersion(key: string, version: number) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO schema_meta (key, version, appliedAt) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET version = $2, appliedAt = $3`,
    [key, version, Date.now()]
  )
}
