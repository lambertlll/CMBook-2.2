import { db } from './index';

// 向量数据库表结构定义
export interface VectorDocument {
  id: number;
  filename: string;   // 文件名
  chunk_id: number;   // 分块ID
  content: string;    // 分块内容
  embedding: string;  // 存储为JSON字符串的向量
  updated_at: number; // 时间戳
}

// 向量缓存项
interface CachedVector {
  id: number;
  filename: string;
  content: string;
  embedding: number[];  // 解析后的向量
  updated_at: number;
}

// 向量缓存管理
class VectorCache {
  private cache: Map<number, CachedVector> = new Map();
  private vectorsByFilename: Map<string, number[]> = new Map(); // 文件名到向量ID列表的映射
  private lastUpdate: number = 0;
  private cacheVersion: number = 0;

  // 获取缓存版本号，用于判断缓存是否过期
  getVersion(): number {
    return this.cacheVersion;
  }

  // 从缓存获取所有向量
  getAll(): CachedVector[] {
    return Array.from(this.cache.values());
  }

  // 按文件名获取向量
  getByFilename(filename: string): CachedVector[] {
    const ids = this.vectorsByFilename.get(filename) || [];
    return ids.map(id => this.cache.get(id)).filter(Boolean) as CachedVector[];
  }

  // 更新缓存
  async update() {
    const docs = await db.select<VectorDocument[]>(`
      select id, filename, content, embedding, updated_at from vector_documents
    `);

    // 清空旧缓存
    this.cache.clear();
    this.vectorsByFilename.clear();

    // 构建新缓存
    for (const doc of docs) {
      try {
        const embedding = JSON.parse(doc.embedding) as number[];
        const cached: CachedVector = {
          id: doc.id,
          filename: doc.filename,
          content: doc.content,
          embedding,
          updated_at: doc.updated_at
        };
        this.cache.set(doc.id, cached);

        // 按文件名索引
        if (!this.vectorsByFilename.has(doc.filename)) {
          this.vectorsByFilename.set(doc.filename, []);
        }
        this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      } catch (error) {
        console.error(`Failed to parse embedding for doc ${doc.id}:`, error);
      }
    }

    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  // 添加单个向量到缓存
  add(doc: VectorDocument) {
    try {
      const embedding = JSON.parse(doc.embedding) as number[];
      const cached: CachedVector = {
        id: doc.id,
        filename: doc.filename,
        content: doc.content,
        embedding,
        updated_at: doc.updated_at
      };
      this.cache.set(doc.id, cached);

      if (!this.vectorsByFilename.has(doc.filename)) {
        this.vectorsByFilename.set(doc.filename, []);
      }
      this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      this.cacheVersion++;
    } catch (error) {
      console.error(`Failed to add vector to cache for doc ${doc.id}:`, error);
    }
  }

  // 删除文件的所有向量
  deleteByFilename(filename: string) {
    const ids = this.vectorsByFilename.get(filename) || [];
    for (const id of ids) {
      this.cache.delete(id);
    }
    this.vectorsByFilename.delete(filename);
    this.cacheVersion++;
  }

  // 按文件夹前缀删除缓存中的向量（filename 以 prefix 开头的所有条目）
  deleteByFolderPrefix(prefix: string) {
    for (const filename of Array.from(this.vectorsByFilename.keys())) {
      if (filename.startsWith(prefix)) {
        const ids = this.vectorsByFilename.get(filename) || [];
        for (const id of ids) {
          this.cache.delete(id);
        }
        this.vectorsByFilename.delete(filename);
      }
    }
    this.cacheVersion++;
  }

  // 检查是否需要更新缓存（5分钟过期）
  needsUpdate(): boolean {
    return Date.now() - this.lastUpdate > 5 * 60 * 1000 || this.cache.size === 0;
  }
}

// 全局向量缓存实例
const vectorCache = new VectorCache();

// 初始化向量数据库表
export async function initVectorDb() {
  await db.execute(`
    create table if not exists vector_documents (
      id integer primary key autoincrement,
      filename text not null,
      chunk_id integer not null,
      content text not null,
      embedding text not null,
      updated_at integer not null,
      unique(filename, chunk_id)
    )
  `);

  // 创建用于快速查找文件的索引
  await db.execute(`
    create index if not exists idx_vector_documents_filename
    on vector_documents(filename)
  `);

  // 初始化缓存
  await vectorCache.update();
}

// 插入或更新向量文档
export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  // 使用 returning id 直接取回行 id，避免 upsert 后再回查整行
  const inserted = await db.select<{ id: number }[]>(
    "insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at returning id",
    [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at]);

  if (inserted.length > 0) {
    vectorCache.add({ id: inserted[0].id, ...doc });
  }
}

// 获取指定文件名的所有向量文档
export async function getVectorDocumentsByFilename(filename: string) {
  return await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 order by chunk_id",
    [filename]);
}

// 通过文件名删除向量文档
export async function deleteVectorDocumentsByFilename(filename: string) {
  await db.execute(
    "delete from vector_documents where filename = $1",
    [filename]);

  // 从缓存中删除
  vectorCache.deleteByFilename(filename);
}

// 按文件夹前缀删除向量文档（删除客户时清理其知识库索引，prefix 为客户 folderPath）
export async function deleteVectorDocumentsByFolderPrefix(prefix: string) {
  // 统一去掉末尾斜杠后再补 '/%'，调用方传不传末尾 '/' 都能正确匹配该文件夹下的所有文件
  const normalized = prefix.replace(/\/+$/, '');
  if (!normalized) return;
  // LIKE 通配符（\、%、_）转义后按参数绑定传入
  const escaped = normalized.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  await db.execute(
    "DELETE FROM vector_documents WHERE filename LIKE $1 ESCAPE '\\'",
    [`${escaped}/%`]);

  // 从缓存中删除（缓存键为原始 filename，用未转义的前缀匹配）
  vectorCache.deleteByFolderPrefix(`${normalized}/`);
}

// 检查文件是否已存在于向量数据库中
export async function checkVectorDocumentExists(filename: string) {
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from vector_documents where filename = $1",
    [filename]);
  
  return result[0]?.count > 0;
}

// 获取最相似的文档片段（优化版本：使用缓存）
export async function getSimilarDocuments(
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.7
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  // 检查是否需要更新缓存
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  // 从缓存获取所有向量（已解析，避免重复 JSON.parse）
  const cachedVectors = vectorCache.getAll();

  if (!cachedVectors.length) return [];

  // 计算余弦相似度并排序
  const allSimilarities = cachedVectors.map(doc => {
    const similarity = cosineSimilarity(queryEmbedding, doc.embedding);

    return {
      id: doc.id,
      filename: doc.filename,
      content: doc.content,
      similarity
    };
  });

  const results = allSimilarities
  .filter(doc => doc.similarity >= threshold)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit);

  return results;
}

// 余弦相似度计算
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('向量维度不匹配');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 清空向量数据库
export async function clearVectorDb() {
  await db.execute(`
    delete from vector_documents
  `);

  // 清空缓存
  await vectorCache.update();
}

// 获取所有向量文档的文件名列表
export async function getAllVectorDocumentFilenames() {
  return await db.select<{filename: string}[]>(`
    select distinct filename from vector_documents
  `);
}

// 手动刷新向量缓存
export async function refreshVectorCache() {
  await vectorCache.update();
}
