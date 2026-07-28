import { getDb } from "./index"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'

export type Role = 'system' | 'user'
export type ChatType = 'chat' | 'note' | 'clipboard' | 'clear' | 'condensed'

export interface Chat {
  id: number
  tagId?: number // 可选，用于兼容过渡期
  conversationId?: number // 关联的会话 ID
  content?: string
  role: Role
  type: ChatType
  image?: string
  images?: string // 多张图片，JSON字符串数组
  inserted: boolean // 是否插入到 mark 中
  createdAt: number
  ragSources?: string // RAG引用的文件名，JSON字符串数组
  ragSourceDetails?: string // RAG引用的详细信息，JSON字符串数组（包含文件路径和文本片段）
  agentHistory?: string // Agent执行历史，JSON字符串
  thinking?: string // AI 思考过程
  quoteData?: string // 引用信息，JSON字符串
  // 压缩相关字段
  condensedContent?: string    // 压缩后的摘要内容（存储在本条消息上）
  condensedAt?: number         // 压缩时间戳
}

// 创建 chats 表
export async function initChatsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists chats (
      id integer primary key autoincrement,
      tagId integer not null,
      content text default null,
      role text not null,
      type text not null,
      image text default null,
      images text default null,
      inserted boolean default false,
      createdAt integer not null,
      ragSources text default null,
      agentHistory text default null,
      thinking text default null,
      quoteData text default null
    )
  `)
  
  // 迁移：为现有表添加 ragSources 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSources text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
    // SQLite 会抛出 "duplicate column name" 错误
  }
  
  // 迁移：为现有表添加 agentHistory 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column agentHistory text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 images 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column images text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 thinking 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column thinking text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 quoteData 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column quoteData text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 ragSourceDetails 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSourceDetails text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedFrom 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedFrom text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 originalTokenCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalTokenCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 originalMessageCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalMessageCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedAt 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedAt integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedContent 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedContent text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 conversationId 列（如果不存在）
  // 注意：这个迁移已移到 conversations.ts 的 initConversationsDb 中执行
  // 这里保留是为了向后兼容，如果 conversations 初始化失败，这里会确保列存在
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 常用查询索引：按会话/标签查询并按时间排序
  await db.execute(`
    create index if not exists idx_chats_conversation on chats(conversationId, createdAt)
  `)
  await db.execute(`
    create index if not exists idx_chats_tag on chats(tagId)
  `)
}

// 插入一条 chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  const createdAt = Date.now();
  const result = await db.execute(
    "insert into chats (tagId, conversationId, content, role, type, image, images, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.inserted ? 1 : 0, createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
  )

  if (chat.role === 'user' && chat.content?.trim()) {
    await insertActivityEvent({
      source: 'chat',
      title: truncateActivityText(chat.content, 64),
      description: truncateActivityText(chat.content, 140),
      tagId: chat.tagId ?? null,
      dedupeKey: result.lastInsertId ? `chat:${result.lastInsertId}` : `chat:${createdAt}`,
      createdAt,
    })
  }

  return result
}

// 获取所有 chats
export async function getChats(tagId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where tagId = $1 order by createdAt",
    [tagId]
  )
  return result
}

// 根据会话 ID 获取聊天记录（新方式）
export async function getChatsByConversation(conversationId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where conversationId = $1 order by createdAt",
    [conversationId]
  )
  return result
}

// 获取所有 chats（用于同步）
export async function getAllChats() {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats order by createdAt",
    []
  )
  return result
}

// 插入多条 chat（用于同步）
export async function insertChats(chats: Chat[]) {
  if (chats.length === 0) return
  const db = await getDb()

  // 单条 SQL 批量插入，天然原子（tauri-plugin-sql 底层是连接池，裸 BEGIN/COMMIT 不保证落在同一连接）
  const rows = chats.map(chat => ({
    tagId: chat.tagId,
    content: chat.content ?? null,
    role: chat.role,
    type: chat.type,
    image: chat.image ?? null,
    images: chat.images ?? null,
    inserted: chat.inserted ? 1 : 0,
    createdAt: chat.createdAt,
    ragSources: chat.ragSources ?? null,
  }))
  await db.execute(
    `insert into chats (tagId, content, role, type, image, images, inserted, createdAt, ragSources)
     select tagId, content, role, type, image, images, inserted, createdAt, ragSources
     from json_each($1)`,
    [JSON.stringify(rows)]
  )
}

// 删除所有 chats（用于同步）
export async function deleteAllChats() {
  const db = await getDb()
  return await db.execute(
    "delete from chats",
    []
  )
}

// 更新一条 chat（动态 SET：只更新传入的非 undefined 字段，避免把未传字段清成 NULL）
export async function updateChat(chat: Chat) {
  const db = await getDb()

  // 白名单字段与参数转换
  const allowedFields = [
    'tagId', 'conversationId', 'content', 'role', 'type', 'image', 'images',
    'ragSources', 'ragSourceDetails', 'agentHistory', 'thinking', 'quoteData',
    'condensedContent', 'condensedAt',
  ] as const

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const field of allowedFields) {
    const value = chat[field]
    if (value !== undefined) {
      setClauses.push(`${field} = $${paramIndex}`)
      values.push(value)
      paramIndex++
    }
  }

  if (chat.inserted !== undefined) {
    setClauses.push(`inserted = $${paramIndex}`)
    values.push(chat.inserted ? 1 : 0)
    paramIndex++
  }

  // 没有需要更新的字段时直接返回
  if (setClauses.length === 0) return

  values.push(chat.id)

  return await db.execute(
    `update chats set ${setClauses.join(', ')} where id = $${paramIndex}`,
    values
  )
}

// 清空 tagId 下的所有 chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where tagId = $1",
    [tagId])
}

// 已插入
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  return await db.execute(
    "update chats set inserted = $1 where id = $2",
    [true, id])
}

// 删除一条 chat
export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where id = $1",
    [id])
}

export async function updateChats(chats: Chat[]) {
  if (chats.length === 0) return
  const db = await getDb()

  // 单条 SQL 批量更新（json_each join），一条语句天然原子，避免逐条 IPC
  try {
    const rows = chats.map(chat => ({
      id: chat.id,
      tagId: chat.tagId,
      conversationId: chat.conversationId ?? null,
      content: chat.content ?? null,
      role: chat.role,
      type: chat.type,
      image: chat.image ?? null,
      images: chat.images ?? null,
      inserted: chat.inserted ? 1 : 0,
      ragSources: chat.ragSources ?? null,
      ragSourceDetails: chat.ragSourceDetails ?? null,
      agentHistory: chat.agentHistory ?? null,
      thinking: chat.thinking ?? null,
      quoteData: chat.quoteData ?? null,
      condensedContent: chat.condensedContent ?? null,
      condensedAt: chat.condensedAt ?? null,
    }))
    await db.execute(
      `update chats set
         tagId = j.tagId,
         conversationId = j.conversationId,
         content = j.content,
         role = j.role,
         type = j.type,
         image = j.image,
         images = j.images,
         inserted = j.inserted,
         ragSources = j.ragSources,
         ragSourceDetails = j.ragSourceDetails,
         agentHistory = j.agentHistory,
         thinking = j.thinking,
         quoteData = j.quoteData,
         condensedContent = j.condensedContent,
         condensedAt = j.condensedAt
       from (select * from json_each($1)) as j
       where chats.id = j.id`,
      [JSON.stringify(rows)]
    )
  } catch (error) {
    console.error('Error updating chats:', error);
    throw error;
  }
}

export async function deleteChats(ids: number[]) {
  if (ids.length === 0) return
  const db = await getDb()

  // 单条 SQL 批量删除，避免逐条 IPC
  try {
    await db.execute(
      "delete from chats where id in (select value from json_each($1))",
      [JSON.stringify(ids)]
    )
  } catch (error) {
    console.error('Error deleting chats:', error);
    throw error;
  }
}

/**
 * 更新消息的压缩摘要内容
 * @param chatId 消息 ID
 * @param condensedContent 压缩摘要内容
 */
export async function updateChatCondensedContent(chatId: number, condensedContent: string) {
  const db = await getDb()
  try {
    await db.execute(
      "update chats set condensedContent = $1, condensedAt = $2 where id = $3",
      [condensedContent, Date.now(), chatId]
    )
  } catch (error) {
    console.error('Error updating chat condensed content:', error);
    throw error;
  }
}
