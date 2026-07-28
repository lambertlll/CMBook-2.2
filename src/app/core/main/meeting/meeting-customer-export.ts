import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { getCustomer } from '@/db/customers'
import { getVisit, createVisitRecord } from '@/db/visits'
import {
  CUSTOMER_MEETING_SUBFOLDER,
  sanitizeCustomerFolderName,
} from '@/lib/customer-folders'
import { useCustomerStore } from '../customer/customer-store'
import { useMeetingStore, type Meeting } from './meeting-store'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { replaceMeetingTodos } from '@/db/visit-todos'
import { parseDueDate, parseVisitTodosFromSummary } from '@/lib/visit-todos'
import emitter from '@/lib/emitter'

/** 导出管线中可能失败的步骤（用于 CustomerSyncResult.failures 与定向重试） */
export type CustomerSyncFailureStep =
  | 'vectorize'
  | 'extractTodos'
  | 'writeFile'
  | 'advanceStage'

export interface CustomerSyncFailure {
  step: CustomerSyncFailureStep
  error: string // 底层错误 message，用于日志与「步骤+原因」提示
}

export interface CustomerSyncResult {
  ok: boolean // 文件导出成功（向量化/待办提取等附属步骤失败不影响该值）
  skipped?: boolean // 无关联客户/无纪要/客户记录缺失，未执行导出
  filePath?: string // 导出的工作区相对路径
  failures: CustomerSyncFailure[] // 各附属步骤收集到的失败（不阻断主流程，仅显式化）
}

/** 未知异常 → 可展示的 message 字符串 */
function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 将会议纪要导出到客户知识库（`<客户文件夹>/访中/YYYY-MM-DD-<标题>.md`），
 * 并对导出文件做 RAG 向量化；拜访阶段为 preparing 时联动置为 visited。
 *
 * 文件名去重：导出目录内同名文件已存在且不属于本会议时，追加 -2/-3 后缀，
 * 防止同日两次拜访同名覆盖丢数据；本会议自己的旧导出（exportedFilePath）则覆盖复用。
 * 标题/日期变化导致路径变化时，先清理旧导出文件及其向量索引，避免孤儿文件。
 *
 * 附属步骤（向量化/待办提取/拜访阶段联动）失败只 console.warn 并收集进
 * CustomerSyncResult.failures，绝不抛错阻断会议流程；文件写盘失败属整体失败
 * （ok:false 且 failures 含 writeFile）。
 * 纪要重新生成或用户手动同步时再次调用，同名覆盖写保证内容最新。
 */
export async function syncMeetingSummaryToCustomer(
  meeting: Pick<Meeting, 'id' | 'title' | 'summary' | 'customerId' | 'visitId' | 'createdAt' | 'exportedFilePath'>
): Promise<CustomerSyncResult> {
  try {
    if (!meeting.customerId || !meeting.summary.trim()) {
      return { ok: false, skipped: true, failures: [] }
    }

    // 客户记录不存在或 folderPath 为空时静默跳过（客户可能已被删除）
    const customer = await getCustomer(meeting.customerId)
    if (!customer || !customer.folderPath) {
      console.warn('[MeetingExport] 客户不存在或无文件夹，跳过导出:', meeting.customerId)
      return { ok: false, skipped: true, failures: [] }
    }

    // 文件名：YYYY-MM-DD-<清洗后的会议标题>.md（清洗复用客户文件夹名规则；空标题回退"未命名会议"）
    const dateStr = formatDate(meeting.createdAt)
    const safeTitle =
      sanitizeCustomerFolderName(meeting.title) || '未命名会议'
    const dirRelative = `${customer.folderPath}/${CUSTOMER_MEETING_SUBFOLDER}`

    // 幂等确保访中目录存在（客户文件夹可能被用户手动删除过）；
    // 目录创建失败与写盘失败同属整体失败（failures 含 writeFile）
    try {
      const dirOptions = await getFilePathOptions(dirRelative)
      await mkdir(dirOptions.path, {
        baseDir: dirOptions.baseDir,
        recursive: true,
      })
    } catch (err) {
      console.warn('[MeetingExport] 创建导出目录失败:', err)
      return {
        ok: false,
        failures: [{ step: 'writeFile', error: toErrorMessage(err) }],
      }
    }

    // 本会议上次成功导出的路径：同名时覆盖复用；标题变更后据此清理旧文件
    const previousPath = meeting.exportedFilePath?.trim() || ''

    // 导出目录内去重：目标文件已存在且不是本会议自己的旧导出时，追加 -2/-3 后缀
    const baseName = `${dateStr}-${safeTitle}`
    let relativePath = `${dirRelative}/${baseName}.md`
    for (let i = 2; i <= 99; i++) {
      if (relativePath === previousPath) break
      if (!(await exportedFileExists(relativePath))) break
      relativePath = `${dirRelative}/${baseName}-${i}.md`
    }

    // 文件内容：头部简要信息 + 空行 + 纪要 markdown 原文
    const now = new Date()
    const content = [
      `- **会议标题**：${meeting.title || '未命名会议'}`,
      `- **关联客户**：${customer.name}`,
      `- **会议时间**：${formatDateTime(new Date(meeting.createdAt))}`,
      `- **导出时间**：${formatDateTime(now)}`,
      '',
      '---',
      '',
      meeting.summary,
    ].join('\n')

    // 写盘（同名覆盖写，参照 meeting-result.tsx 保存为笔记的写法）：
    // 失败属整体失败，ok:false 且 failures 含 writeFile
    try {
      const pathOptions = await getFilePathOptions(relativePath)
      if (pathOptions.baseDir) {
        await writeTextFile(pathOptions.path, content, {
          baseDir: pathOptions.baseDir,
        })
      } else {
        await writeTextFile(pathOptions.path, content)
      }
    } catch (err) {
      console.warn('[MeetingExport] 纪要导出写盘失败:', err)
      return {
        ok: false,
        failures: [{ step: 'writeFile', error: toErrorMessage(err) }],
      }
    }

    // 标题/日期变化导致导出路径变化：清理旧导出文件及其向量索引，避免孤儿文件
    if (previousPath && previousPath !== relativePath) {
      await removeMeetingCustomerExport(previousPath)
    }

    // 附属步骤失败不阻断主流程：收集进 failures 交由调用方分级提示/定向重试
    const failures: CustomerSyncFailure[] = []

    // RAG 向量化：embedding 模型未配置属可预期跳过（不算失败）；处理失败收集进 failures
    try {
      await vectorizeExportedFile(relativePath, content)
    } catch (err) {
      console.warn('[MeetingExport] 向量化失败:', err)
      failures.push({ step: 'vectorize', error: toErrorMessage(err) })
    }

    // 记录导出路径（下次重新导出据此覆盖复用/清理旧文件，删除会议时级联清理）
    if (relativePath !== previousPath) {
      useMeetingStore.getState().updateMeeting(meeting.id, {
        exportedFilePath: relativePath,
      })
    }

    // 拜访阶段联动：导出成功后 preparing → visited（其余阶段不回退）
    try {
      await advanceVisitStage(meeting.visitId, meeting.id)
    } catch (err) {
      console.warn('[MeetingExport] 更新拜访阶段失败:', err)
      failures.push({ step: 'advanceStage', error: toErrorMessage(err) })
    }

    // 待办提取：解析纪要「待办事项」表格并按 meetingId 差异合并 visit_todos
    // （按 content+owner 匹配保留已完成状态，仅增删差异项）；失败收集进 failures
    try {
      await extractVisitTodos(meeting)
    } catch (err) {
      console.warn('[MeetingExport] 待办提取失败:', err)
      failures.push({ step: 'extractTodos', error: toErrorMessage(err) })
    }

    // 通知客户知识库面板等监听方刷新（组件未挂载时忽略即可）
    emitter.emit('customer-meeting-exported', {
      customerId: meeting.customerId,
      visitId: meeting.visitId || undefined,
      path: relativePath,
    })

    return { ok: true, filePath: relativePath, failures }
  } catch (err) {
    console.warn('[MeetingExport] 纪要导出客户知识库失败:', err)
    return { ok: false, failures: [] }
  }
}

/**
 * 定向重试导出管线的失败步骤（目前仅支持 vectorize / extractTodos，
 * writeFile / advanceStage 需走完整 syncMeetingSummaryToCustomer 重导）。
 * 向量化重试基于已归档文件重新读取内容；待办提取基于内存中的最新 summary。
 * 返回的 failures 仅包含本次重试仍失败的步骤，全部成功时 ok:true。
 */
export async function retryExportFailures(
  meeting: Pick<Meeting, 'id' | 'summary' | 'customerId' | 'visitId' | 'exportedFilePath'>,
  steps: CustomerSyncFailureStep[]
): Promise<CustomerSyncResult> {
  const filePath = meeting.exportedFilePath?.trim() || ''
  const retryable = steps.filter(
    (s) => s === 'vectorize' || s === 'extractTodos'
  )
  if (!filePath || retryable.length === 0) {
    return { ok: false, skipped: true, failures: [] }
  }

  const failures: CustomerSyncFailure[] = []

  if (retryable.includes('vectorize')) {
    try {
      const content = await readExportedFile(filePath)
      if (content === null) {
        throw new Error(`导出文件不存在: ${filePath}`)
      }
      await vectorizeExportedFile(filePath, content)
    } catch (err) {
      console.warn('[MeetingExport] 重试向量化失败:', err)
      failures.push({ step: 'vectorize', error: toErrorMessage(err) })
    }
  }

  if (retryable.includes('extractTodos')) {
    try {
      await extractVisitTodos(meeting)
    } catch (err) {
      console.warn('[MeetingExport] 重试待办提取失败:', err)
      failures.push({ step: 'extractTodos', error: toErrorMessage(err) })
    }
  }

  return { ok: failures.length === 0, filePath, failures }
}

/**
 * 读取已归档的导出文件内容（重试向量化用）；文件不存在返回 null
 */
async function readExportedFile(relativePath: string): Promise<string | null> {
  const pathOptions = await getFilePathOptions(relativePath)
  if (pathOptions.baseDir) {
    if (!(await exists(pathOptions.path, { baseDir: pathOptions.baseDir }))) {
      return null
    }
    return await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
  }
  if (!(await exists(pathOptions.path))) return null
  return await readTextFile(pathOptions.path)
}

/**
 * 删除会议导出的客户知识库文件及其向量索引。
 * 用于：标题/日期变化后重新导出清理旧文件；删除会议时级联清理。
 * 任何失败只 console.warn，不抛错。
 */
export async function removeMeetingCustomerExport(
  relativePath: string
): Promise<void> {
  if (!relativePath) return

  // 删除导出文件（工作区相对路径，自定义/默认工作区统一走 getFilePathOptions 解析）
  try {
    const pathOptions = await getFilePathOptions(relativePath)
    if (pathOptions.baseDir) {
      await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
    } else {
      await remove(pathOptions.path)
    }
  } catch (err) {
    console.warn('[MeetingExport] 删除旧导出文件失败:', relativePath, err)
  }

  // 删除向量索引：rag 模块未单独导出删除函数，这里与 rag.ts processMarkdownFile
  // 内部一致，直接走 db/vector 的 deleteVectorDocumentsByFilename（即 rag 的删除接口）
  try {
    const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
    const { getVectorDocumentKey } = await import('@/lib/vector-document-key')
    const vectorDocumentKey = getVectorDocumentKey(relativePath)
    await deleteVectorDocumentsByFilename(vectorDocumentKey)
    // 兼容旧数据：早期向量记录以纯文件名存储（清理逻辑与 rag.ts 一致）
    const legacyFilename = relativePath.split('/').pop() || relativePath
    if (legacyFilename !== vectorDocumentKey) {
      await deleteVectorDocumentsByFilename(legacyFilename)
    }
  } catch (err) {
    console.warn('[MeetingExport] 删除向量索引失败:', relativePath, err)
  }
}

/**
 * 判断导出目录内的目标文件是否已存在（自定义/默认工作区统一解析）
 */
async function exportedFileExists(relativePath: string): Promise<boolean> {
  try {
    const pathOptions = await getFilePathOptions(relativePath)
    if (pathOptions.baseDir) {
      return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    }
    return await exists(pathOptions.path)
  } catch (err) {
    console.warn('[MeetingExport] 检查导出文件是否存在失败:', relativePath, err)
    return false
  }
}

/**
 * 对导出的 md 文件做向量索引（与 vector-knowledge-menu.tsx 的单文件向量化方式一致，
 * 动态引入 rag 模块避免把 embedding 链路拉进会议主流程的加载路径）。
 * 未配置可用的 embedding 模型属可预期跳过（用户未启用 RAG），不算失败；
 * 处理失败/未生效则抛错，由调用方收集进 failures。
 */
async function vectorizeExportedFile(relativePath: string, content: string) {
  const { checkEmbeddingModelAvailable, processMarkdownFile } = await import(
    '@/lib/rag'
  )
  const available = await checkEmbeddingModelAvailable()
  if (!available) {
    console.warn('[MeetingExport] 未配置可用的 embedding 模型，跳过向量化')
    return
  }
  const ok = await processMarkdownFile(relativePath, content)
  if (!ok) {
    throw new Error(`processMarkdownFile 未生效: ${relativePath}`)
  }
}

/**
 * 拜访阶段联动：仅当当前为 preparing 时置为 visited；
 * 同步 customer-store 中已加载的拜访列表（若该拜访在当前客户的时间线中）。
 * 失败抛错由调用方收集进 failures。
 */
async function advanceVisitStage(visitId: string, meetingId?: string) {
  if (!visitId) return
  const visit = await getVisit(visitId)
  if (!visit) return
  const updates: { stage?: string; meetingId?: string } = {}
  if (visit.stage === 'preparing') {
    updates.stage = 'visited'
  }
  // 存量数据修复：早期 ensureVisitForMeeting 未回写 meetingId，此处补齐
  if (meetingId && !visit.meetingId) {
    updates.meetingId = meetingId
  }
  if (Object.keys(updates).length > 0) {
    await useCustomerStore.getState().updateVisit(visitId, updates)
  }
}

/**
 * 归类会议时确保存在对应的拜访记录：
 * 会议已关联拜访（visitId 非空）时直接返回；否则按会议标题/创建时间新建拜访
 * （stage=visited，归类即已拜访）并回写 meeting.visitId。
 * 这样自动归类/手动归类/工作台归类的会议都会进入拜访时间线并计入拜访次数。
 * 失败仅 console.warn，不阻断归类主流程。
 */
export async function ensureVisitForMeeting(
  meeting: Pick<Meeting, 'id' | 'title' | 'visitId' | 'createdAt'>,
  customerId: string
): Promise<void> {
  try {
    if (!customerId) return
    // visitId 非空时需验证 visit 是否仍存在（可能已被用户从时间线删除）
    if (meeting.visitId) {
      const existing = await getVisit(meeting.visitId)
      if (existing) return // visit 存在，无需重建
      // visit 已被删除，清空 meeting.visitId 后继续创建新 visit
      useMeetingStore.getState().updateMeeting(meeting.id, { visitId: '' })
    }
    const title = meeting.title?.trim() || `${formatDate(meeting.createdAt)} 拜访`
    const visit = await createVisitRecord({
      customerId,
      title,
      visitDate: meeting.createdAt,
      stage: 'visited',
      meetingId: meeting.id,
    })
    useMeetingStore.getState().updateMeeting(meeting.id, { visitId: visit.id })
    // 该客户时间线若已加载（当前选中），刷新以即时显示新拜访
    const customerStore = useCustomerStore.getState()
    if (customerStore.currentCustomerId === customerId) {
      await customerStore.loadVisits(customerId)
    }
  } catch (err) {
    console.warn('[MeetingExport] 归类时创建拜访记录失败（归类本身不受影响）:', err)
  }
}

/**
 * 待办提取挂载点（纪要生成成功收口）：对最新 summary 调解析器 → 按 meetingId 整批替换
 * visit_todos（空数组也调用，保证重新生成能清掉旧待办）→ 刷新待办 store → 累加新待办角标。
 * 自动导出（转写完成后自动生成纪要）与手动同步/重新生成两条来路都经过 syncMeetingSummaryToCustomer，
 * 且此处 customerId 已保证非空。解析/写库失败抛错由调用方收集进 failures，不阻断会议流程。
 */
async function extractVisitTodos(
  meeting: Pick<Meeting, 'id' | 'summary' | 'customerId' | 'visitId'>
): Promise<void> {
  const parsed = parseVisitTodosFromSummary(meeting.summary)
  await replaceMeetingTodos(
    meeting.id,
    parsed.map((todo) => ({
      customerId: meeting.customerId,
      visitId: meeting.visitId || '',
      content: todo.content,
      owner: todo.owner,
      dueDate: parseDueDate(todo.dueText),
    }))
  )
  const todosStore = useVisitTodosStore.getState()
  await todosStore.refreshTodos()
  // 有新增待办时累加角标（面板打开时 markTodosSeen 清零）
  todosStore.noteExtractedTodos(parsed.length)
}

/** 本地日期 YYYY-MM-DD（用于文件名与拜访日期展示） */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 本地日期时间 YYYY-MM-DD HH:mm */
function formatDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(d.getTime())} ${hh}:${mm}`
}
