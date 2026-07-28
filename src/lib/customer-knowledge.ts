import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getFilePathOptions, getWorkspacePath } from './workspace'
import { CUSTOMER_SUBFOLDERS } from './customer-folders'
import { getVectorDocumentKey } from './vector-document-key'
import { getAllVectorDocumentFilenames } from '@/db/vector'
import type { LinkedFolder } from './files'
import emitter from './emitter'
import useChatStore from '@/stores/chat'
import { useSidebarStore } from '@/stores/sidebar'

// 客户知识库中的单个文件
export interface CustomerKnowledgeFile {
  name: string // 文件名
  relativePath: string // 工作区相对路径（如 customers/宁德时代/资料/财报.md）
  size: number // 字节数
  mtime: number | null // 修改时间戳（毫秒）
}

// 按客户固定子目录分组（subfolder 为 '' 时表示客户根目录下的文件，如 客户档案.md）
export interface CustomerKnowledgeGroup {
  subfolder: string
  files: CustomerKnowledgeFile[]
}

// 「其他」分组名：用户自建的顶层目录（非固定子目录）统一归入该组显示，
// 面板按 subfolder 原文展示，故直接使用中文组名
export const CUSTOMER_KNOWLEDGE_OTHER_GROUP = '其他'

// 上传资料结果
export interface UploadMaterialsResult {
  canceled: boolean // 用户取消选择
  saved: { name: string; relativePath: string; indexed: boolean }[]
  failed: { name: string; error: string }[]
  embeddingAvailable: boolean // false 时文件已保存但未索引
}

// 批量重建索引结果
export interface ReindexResult {
  total: number
  success: number
  failed: number
  embeddingAvailable: boolean
}

// 可被向量索引的文本类文件扩展名
const INDEXABLE_EXTENSIONS = ['md', 'txt']

// 上传资料支持的扩展名（docx/pdf 会转换为 md 后入库）
const UPLOAD_EXTENSIONS = ['md', 'txt', 'docx', 'pdf']

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/** 判断文件是否可参与向量索引（.md/.txt） */
export function isKnowledgeFileIndexable(name: string): boolean {
  return INDEXABLE_EXTENSIONS.includes(getExtension(name))
}

/** 判断文件是否为上传资料支持的类型（.md/.txt/.docx/.pdf，拖拽上传的前端过滤用） */
export function isKnowledgeUploadSupported(name: string): boolean {
  return UPLOAD_EXTENSIONS.includes(getExtension(name))
}

/**
 * 递归列出客户文件夹下的全部文件，按 访前/访中/访后/资料 顺序分组，
 * 用户自建的顶层目录统一归入「其他」组，
 * 客户根目录下的散文件（如 客户档案.md）归入 subfolder 为 '' 的最后一组。
 */
export async function listCustomerKnowledgeFiles(
  folderPath: string
): Promise<CustomerKnowledgeGroup[]> {
  const groups = new Map<string, CustomerKnowledgeFile[]>()

  async function walk(dirRelative: string, topSubfolder: string): Promise<void> {
    let entries
    try {
      const options = await getFilePathOptions(dirRelative)
      entries = await readDir(
        options.path,
        options.baseDir ? { baseDir: options.baseDir } : undefined
      )
    } catch (err) {
      // 子目录可能已被用户手动删除，跳过即可
      console.warn(`[CustomerKnowledge] 读取目录失败: ${dirRelative}`, err)
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryRelative = `${dirRelative}/${entry.name}`
      if (entry.isDirectory) {
        // 顶层子目录决定分组；更深层级仍归入顶层分组
        const nextTop = topSubfolder || entry.name
        await walk(entryRelative, dirRelative === folderPath ? entry.name : nextTop)
      } else {
        try {
          const options = await getFilePathOptions(entryRelative)
          const fileStat = await stat(
            options.path,
            options.baseDir ? { baseDir: options.baseDir } : undefined
          )
          const groupKey = dirRelative === folderPath ? '' : topSubfolder
          if (!groups.has(groupKey)) groups.set(groupKey, [])
          groups.get(groupKey)!.push({
            name: entry.name,
            relativePath: entryRelative,
            size: fileStat.size,
            mtime: fileStat.mtime ? fileStat.mtime.getTime() : null,
          })
        } catch (err) {
          console.warn(`[CustomerKnowledge] 读取文件信息失败: ${entryRelative}`, err)
        }
      }
    }
  }

  await walk(folderPath, '')

  // 组内按修改时间倒序
  for (const files of groups.values()) {
    files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  }

  // 固定子目录顺序优先；未识别的用户自建顶层目录归入「其他」组；根目录散文件组排最后
  const ordered: CustomerKnowledgeGroup[] = []
  for (const sub of CUSTOMER_SUBFOLDERS) {
    const files = groups.get(sub)
    if (files && files.length > 0) ordered.push({ subfolder: sub, files })
  }
  const otherFiles: CustomerKnowledgeFile[] = []
  for (const [key, files] of groups) {
    if (key === '' || (CUSTOMER_SUBFOLDERS as readonly string[]).includes(key)) continue
    otherFiles.push(...files)
  }
  if (otherFiles.length > 0) {
    otherFiles.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    ordered.push({ subfolder: CUSTOMER_KNOWLEDGE_OTHER_GROUP, files: otherFiles })
  }
  const rootFiles = groups.get('')
  if (rootFiles && rootFiles.length > 0) ordered.push({ subfolder: '', files: rootFiles })
  return ordered
}

/**
 * 获取向量库中全部已索引文件的 key 集合（filename 为 getVectorDocumentKey 后的工作区相对路径）
 */
export async function getIndexedFilenameSet(): Promise<Set<string>> {
  const rows = await getAllVectorDocumentFilenames()
  return new Set(rows.map((r) => r.filename))
}

/** 判断某个知识库文件是否已有向量索引 */
export function isFileIndexed(indexedSet: Set<string>, relativePath: string): boolean {
  return indexedSet.has(getVectorDocumentKey(relativePath))
}

/**
 * 解决同名冲突：目标目录下已存在同名文件时，自动追加 -2、-3 后缀，
 * 返回可用的文件名（不含目录）。
 */
async function resolveUniqueFileName(dirRelative: string, fileName: string): Promise<string> {
  const dotIdx = fileName.lastIndexOf('.')
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : ''

  let candidate = fileName
  let suffix = 2
  while (true) {
    const options = await getFilePathOptions(`${dirRelative}/${candidate}`)
    const found = await exists(
      options.path,
      options.baseDir ? { baseDir: options.baseDir } : undefined
    )
    if (!found) return candidate
    candidate = `${base}-${suffix}${ext}`
    suffix++
  }
}

/** 写文本文件到工作区相对路径 */
async function writeWorkspaceTextFile(relativePath: string, content: string): Promise<void> {
  const options = await getFilePathOptions(relativePath)
  await writeTextFile(
    options.path,
    content,
    options.baseDir ? { baseDir: options.baseDir } : undefined
  )
}

/**
 * 从 docx 提取纯文本（mammoth，浏览器构建走 package.json browser 字段映射）
 */
async function extractTextFromDocx(absolutePath: string): Promise<string> {
  const data = await readFile(absolutePath)
  const mammoth = await import('mammoth')
  // 拷贝出独立 ArrayBuffer，避免 Uint8Array 共享 buffer 的偏移与类型问题
  const arrayBuffer = new Uint8Array(data).buffer
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value.trim()
}

/** 从拖拽上传的 docx File 提取纯文本（与 extractTextFromDocx 同走 mammoth） */
async function extractTextFromDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value.trim()
}

/**
 * 单个资料落盘的公共收尾（对话框上传与拖拽上传共用）：
 * 同名自动加 -2/-3 后缀 → 执行写入 → 可索引时尽力向量化（失败不阻断保存）。
 */
async function finalizeMaterial(
  materialDir: string,
  desiredName: string,
  write: (targetRelative: string) => Promise<void>,
  embeddingAvailable: boolean,
  processMarkdownFile: (path: string) => Promise<boolean>
): Promise<{ name: string; relativePath: string; indexed: boolean }> {
  const targetName = await resolveUniqueFileName(materialDir, desiredName)
  const targetRelative = `${materialDir}/${targetName}`
  await write(targetRelative)

  let indexed = false
  if (embeddingAvailable && isKnowledgeFileIndexable(targetName)) {
    try {
      indexed = await processMarkdownFile(targetRelative)
    } catch (err) {
      console.warn(`[CustomerKnowledge] 向量化失败: ${targetRelative}`, err)
    }
  }
  return { name: targetName, relativePath: targetRelative, indexed }
}

/**
 * 上传资料到客户文件夹的 资料/ 子目录：
 * - .md/.txt：原样复制
 * - .docx：提取文本转为 <原名>.md
 * - .pdf：提取文本转为 <原名>.md（复用 src/lib/pdf.ts）
 * 同名冲突自动加 -2/-3 后缀；落地成功后尽力向量化（embedding 未配置时不阻断保存）。
 */
export async function uploadCustomerMaterials(
  folderPath: string,
  dialogFilterName: string,
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<UploadMaterialsResult> {
  const result: UploadMaterialsResult = {
    canceled: false,
    saved: [],
    failed: [],
    embeddingAvailable: true,
  }

  const selected = await openDialog({
    multiple: true,
    directory: false,
    filters: [{ name: dialogFilterName, extensions: UPLOAD_EXTENSIONS }],
  })
  if (!selected) {
    result.canceled = true
    return result
  }
  const paths = Array.isArray(selected) ? selected : [selected]
  if (paths.length === 0) {
    result.canceled = true
    return result
  }

  // 幂等确保 资料/ 目录存在
  const materialDir = `${folderPath}/${CUSTOMER_SUBFOLDERS[3]}`
  const dirOptions = await getFilePathOptions(materialDir)
  await mkdir(dirOptions.path, {
    baseDir: dirOptions.baseDir,
    recursive: true,
  })

  // embedding 模型检查只做一次；不可用时仍然保存文件，只是跳过索引
  const { checkEmbeddingModelAvailable, processMarkdownFile } = await import('@/lib/rag')
  result.embeddingAvailable = await checkEmbeddingModelAvailable()

  for (let i = 0; i < paths.length; i++) {
    const sourcePath = paths[i]
    const sourceName = sourcePath.split(/[\\/]/).pop() || sourcePath
    onProgress?.(i + 1, paths.length, sourceName)

    try {
      const ext = getExtension(sourceName)
      if (!UPLOAD_EXTENSIONS.includes(ext)) {
        throw new Error(`unsupported type: .${ext}`)
      }

      let savedEntry: { name: string; relativePath: string; indexed: boolean }

      if (ext === 'md' || ext === 'txt') {
        // 原样复制
        savedEntry = await finalizeMaterial(
          materialDir,
          sourceName,
          async (targetRelative) => {
            const targetOptions = await getFilePathOptions(targetRelative)
            await copyFile(sourcePath, targetOptions.path, {
              toPathBaseDir: targetOptions.baseDir,
            })
          },
          result.embeddingAvailable,
          processMarkdownFile
        )
      } else {
        // docx/pdf 提取文本转 md
        const text =
          ext === 'docx'
            ? await extractTextFromDocx(sourcePath)
            : await (await import('@/lib/pdf')).extractTextFromPDF(sourcePath)
        if (!text) {
          throw new Error('empty text')
        }
        const baseName = sourceName.slice(0, sourceName.lastIndexOf('.')) || sourceName
        savedEntry = await finalizeMaterial(
          materialDir,
          `${baseName}.md`,
          (targetRelative) => writeWorkspaceTextFile(targetRelative, text),
          result.embeddingAvailable,
          processMarkdownFile
        )
      }
      result.saved.push(savedEntry)
    } catch (err) {
      console.error(`[CustomerKnowledge] 上传资料失败: ${sourceName}`, err)
      result.failed.push({
        name: sourceName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/**
 * 拖拽上传入口（C5）：与 uploadCustomerMaterials 共用 资料/ 落盘与索引管线，
 * 区别仅在来源是 HTML5 拖拽的 File 对象（仓库拖拽范式与 file-manager/chat-input 一致，
 * tauri.conf.json 已置 dragDropEnabled: false，OS 拖入走标准 HTML5 DnD）。
 * - .md/.txt：读取文本写入（与原样复制等价）
 * - .docx/.pdf：提取文本转为 <原名>.md
 * 调用方先经 isKnowledgeUploadSupported 过滤；混入的不支持类型逐个记入 failed。
 */
export async function uploadCustomerMaterialFiles(
  folderPath: string,
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<UploadMaterialsResult> {
  const result: UploadMaterialsResult = {
    canceled: false,
    saved: [],
    failed: [],
    embeddingAvailable: true,
  }
  if (files.length === 0) return result

  // 幂等确保 资料/ 目录存在
  const materialDir = `${folderPath}/${CUSTOMER_SUBFOLDERS[3]}`
  const dirOptions = await getFilePathOptions(materialDir)
  await mkdir(dirOptions.path, {
    baseDir: dirOptions.baseDir,
    recursive: true,
  })

  // embedding 模型检查只做一次；不可用时仍然保存文件，只是跳过索引
  const { checkEmbeddingModelAvailable, processMarkdownFile } = await import('@/lib/rag')
  result.embeddingAvailable = await checkEmbeddingModelAvailable()

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress?.(i + 1, files.length, file.name)

    try {
      const ext = getExtension(file.name)
      if (!UPLOAD_EXTENSIONS.includes(ext)) {
        throw new Error(`unsupported type: .${ext || 'unknown'}`)
      }

      let savedEntry: { name: string; relativePath: string; indexed: boolean }

      if (ext === 'md' || ext === 'txt') {
        // 读取文本写入（等价于原样复制）
        const text = await file.text()
        savedEntry = await finalizeMaterial(
          materialDir,
          file.name,
          (targetRelative) => writeWorkspaceTextFile(targetRelative, text),
          result.embeddingAvailable,
          processMarkdownFile
        )
      } else {
        // docx/pdf 提取文本转 md
        const text =
          ext === 'docx'
            ? await extractTextFromDocxFile(file)
            : await (await import('@/lib/pdf')).extractTextFromPDFFile(file)
        if (!text) {
          throw new Error('empty text')
        }
        const baseName = file.name.slice(0, file.name.lastIndexOf('.')) || file.name
        savedEntry = await finalizeMaterial(
          materialDir,
          `${baseName}.md`,
          (targetRelative) => writeWorkspaceTextFile(targetRelative, text),
          result.embeddingAvailable,
          processMarkdownFile
        )
      }
      result.saved.push(savedEntry)
    } catch (err) {
      console.error(`[CustomerKnowledge] 拖拽上传失败: ${file.name}`, err)
      result.failed.push({
        name: file.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/** 简单并发控制（与 rag.ts 内部实现同思路，限制并发避免打满 embedding API） */
async function runWithConcurrency(
  tasks: (() => Promise<boolean>)[],
  limit: number,
  onOneDone?: (completed: number, total: number, ok: boolean) => void
): Promise<boolean[]> {
  const results: boolean[] = new Array(tasks.length).fill(false)
  let cursor = 0
  let completed = 0

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor++
      let ok = false
      try {
        ok = await tasks[index]()
      } catch {
        ok = false
      }
      results[index] = ok
      completed++
      onOneDone?.(completed, tasks.length, ok)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/**
 * 对客户文件夹下全部 .md/.txt 文件批量重建向量索引。
 * 单个文件失败不阻断整体；embedding 模型未配置时直接返回 embeddingAvailable=false。
 */
export async function reindexCustomerKnowledge(
  folderPath: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ReindexResult> {
  const groups = await listCustomerKnowledgeFiles(folderPath)
  const files = groups
    .flatMap((g) => g.files)
    .filter((f) => isKnowledgeFileIndexable(f.name))

  const { checkEmbeddingModelAvailable, processMarkdownFile } = await import('@/lib/rag')
  const embeddingAvailable = await checkEmbeddingModelAvailable()
  if (!embeddingAvailable) {
    return { total: files.length, success: 0, failed: 0, embeddingAvailable: false }
  }

  const results = await runWithConcurrency(
    files.map((f) => () => processMarkdownFile(f.relativePath)),
    3,
    (completed, total) => onProgress?.(completed, total)
  )

  const success = results.filter(Boolean).length
  return {
    total: files.length,
    success,
    failed: files.length - success,
    embeddingAvailable: true,
  }
}

/**
 * 重建单个文件的向量索引（embedding 不可用时返回 'no-embedding'）
 */
export async function reindexSingleKnowledgeFile(
  relativePath: string
): Promise<'ok' | 'failed' | 'no-embedding'> {
  const { checkEmbeddingModelAvailable, processMarkdownFile } = await import('@/lib/rag')
  const available = await checkEmbeddingModelAvailable()
  if (!available) return 'no-embedding'
  const ok = await processMarkdownFile(relativePath)
  return ok ? 'ok' : 'failed'
}

/**
 * 基于知识库提问：把客户文件夹设为聊天关联文件夹（与文件模块 Ctrl+点击文件夹
 * 相同的 folderSelected 机制），确保右侧聊天面板可见，并预填提示词。
 * 发送消息时 chat-send.tsx 检测到关联资源为文件夹后会走 getContextForQueryInFolder
 * 做该客户文件夹范围内的检索。
 */
export async function askWithCustomerKnowledge(
  customer: { name: string; folderPath: string },
  prompt: string
): Promise<void> {
  const { collectMarkdownFiles } = await import('./files')
  const files = await collectMarkdownFiles(customer.folderPath)
  const indexedSet = await getIndexedFilenameSet()
  const indexedCount = files.filter((f) =>
    indexedSet.has(getVectorDocumentKey(f.path))
  ).length

  const workspace = await getWorkspacePath()
  const fullPath = workspace.isCustom
    ? `${workspace.path}/${customer.folderPath}`
    : customer.folderPath

  const folder: LinkedFolder = {
    name: customer.name,
    path: fullPath,
    relativePath: customer.folderPath,
    fileCount: files.length,
    indexedCount,
  }

  // 右侧聊天面板可能被收起，确保展开
  const sidebar = useSidebarStore.getState()
  if (!sidebar.rightSidebarVisible) {
    await sidebar.toggleRightSidebar()
  }

  // 与 chat-input 的 folderSelected 监听保持一致：本地 state + chat store 双写
  useChatStore.getState().setLinkedResource(folder)
  emitter.emit('folderSelected', folder)
  // 预填提示词并聚焦输入框（chat-input 监听 quick-prompt-insert）
  emitter.emit('quick-prompt-insert', prompt)
}
