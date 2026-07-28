
import Database from '@tauri-apps/plugin-sql';

// 导出数据库实例
export const db = await Database.load('sqlite:note.db');

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  return db;
}

// 初始化所有数据库
export async function initAllDatabases() {
  // 引入各数据库初始化函数
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');
  const { initMeetingsDb } = await import('./meetings');
  const { initSchemaMetaDb } = await import('./schema-meta');
  const { initCustomersDb } = await import('./customers');
  const { initVisitsDb } = await import('./visits');
  const { initVisitTodosDb } = await import('./visit-todos');

  // 执行初始化：先确保基础表存在，再做 conversations 对 chats 的迁移/补列。
  await initChatsDb();
  await initConversationsDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initActivityDb();
  await initMeetingsDb();
  // 2.0 新增：schema 版本登记 + 客户/拜访表
  await initSchemaMetaDb();
  await initCustomersDb();
  await initVisitsDb();
  // 2.1 新增：待办表（含 cmbook2 schema v1→v2 迁移登记）
  await initVisitTodosDb();
}
