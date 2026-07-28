import { create } from 'zustand'
import { exists, stat } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import useChatStore from '@/stores/chat'
import { useCustomerStore } from './customer-store'
import { getVisit } from '@/db/visits'
import type { CustomerRecord } from '@/db/customers'
import type { VisitRecord } from '@/db/visits'
import type { Chat } from '@/db/chats'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import {
  LANGUAGE_STORAGE_KEY,
  loadMessagesWithFallback,
  normalizeLocale,
  type SupportedLocale,
} from '@/i18n/config'
import type { AbstractIntlMessages } from 'next-intl'

/** 生成类型：访前尽调报告（拜访级） / 财报分析 / 审贷会材料（客户级） */
export type VisitGenerateKind = 'previsit' | 'financial' | 'credit'

/** 兜底轮询间隔（主信号是 loading 跳变，轮询仅在跳变漏接时补判） */
const POLL_INTERVAL_MS = 3000
/** 生成结果最长等待时间（超出后停止任务并提示） */
const POLL_TIMEOUT_MS = 10 * 60 * 1000
/** 发送后等待聊天进入 loading 的宽限时间（超时视为消息未发出/未启动） */
const START_GRACE_MS = 15000
/** 会话结束后判定失败前的落盘宽限（无错误语义时再等一次文件出现） */
const END_GRACE_MS = 5000

/** 生成任务（queued 排队中 / running 进行中；同一时刻最多一个 running） */
export interface VisitGenerateTask {
  key: string // 拜访级任务 `${visitId}:${kind}`；客户级任务 `${customerId}:${kind}`
  visitId: string // 客户级任务（财报分析/审贷会材料）为空串
  customerId: string
  customerName: string // 客户名（任务横条展示与会话命名用，避免激活时再查库）
  kind: VisitGenerateKind
  targetPath: string // 目标文件工作区相对路径
  prompt: string // 发送到 Agent 聊天的提示词
  status: 'queued' | 'running'
  startedAt: number // 激活（发送）时间，排队中为 0
}

interface VisitGenerateState {
  tasks: VisitGenerateTask[]
  // A5 完成提醒：刚完成任务的 key 列表（阶段区块据此显示"新"徽标，组件消费后经 consumeRecentlyFinished 清除）
  recentlyFinishedKeys: string[]
}

/**
 * 生成任务列表（模块级，组件卸载不清除）：
 * 组件用 selector 按 key 精确订阅，如 s.tasks.find((t) => t.key === `${visitId}:previsit`)
 */
export const useVisitGenerateStore = create<VisitGenerateState>(() => ({
  tasks: [],
  recentlyFinishedKeys: [],
}))

/** A5：组件消费掉"新"徽标后调用，把 key 从 recentlyFinishedKeys 中移除 */
export function consumeRecentlyFinished(key: string) {
  useVisitGenerateStore.setState({
    recentlyFinishedKeys: useVisitGenerateStore
      .getState()
      .recentlyFinishedKeys.filter((k) => k !== key),
  })
}

// ---- 模块级运行时状态（活跃任务的定时器与订阅；不放入 store，避免无关重渲染） ----
let activeTaskKey: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let chatUnsubscribe: (() => void) | null = null
let idleUnsubscribe: (() => void) | null = null
let graceTimer: ReturnType<typeof setTimeout> | null = null

/** 本地日期 YYYY-MM-DD（与 visit-timeline 的文件命名约定一致） */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 目标文件路径：`<客户文件夹>/访前|访后/YYYY-MM-DD-<后缀>.md`（客户级任务无拜访，按今天日期命名） */
function buildTargetPath(
  customer: CustomerRecord,
  visit: VisitRecord | undefined,
  kind: VisitGenerateKind
): string {
  const dateStr = formatDate(
    kind === 'previsit' ? visit?.visitDate || Date.now() : Date.now()
  )
  const subfolder = kind === 'previsit' ? '访前' : '访后'
  const suffix =
    kind === 'previsit'
      ? '尽调报告.md'
      : kind === 'financial'
        ? '财报分析.md'
        : '审贷会准备.md'
  return `${customer.folderPath}/${subfolder}/${dateStr}-${suffix}`
}

/** 构造发送到 Agent 聊天的提示词（客户类型/行业带入；行业可能为空） */
function buildPrompt(
  customer: CustomerRecord,
  kind: VisitGenerateKind,
  targetPath: string
): string {
  const typeLabel = customer.type === 'individual' ? '个人客户' : '企业客户'
  const promptLines =
    kind === 'previsit'
      ? [
          `请使用 client-research skill 为客户「${customer.name}」生成访前尽调报告。`,
          '',
          `- 客户名称：${customer.name}`,
          `- 客户类型：${typeLabel}`,
          customer.industry ? `- 所属行业：${customer.industry}` : null,
          `- 客户文件夹：${customer.folderPath}`,
          `- 确切输出路径：${targetPath}`,
          '',
          '要求：先用知识库检索客户文件夹内的历史拜访纪要与资料（内部已知信息），再用 web_search/web_fetch 补充公开信息（重点近 3 个月），按 skill 中对应客户类型的报告模板生成，【内部信息】与【公开信息】分别标注来源，最后用写文件工具把报告写入上面的确切输出路径（已存在则覆盖更新），并在回复中汇报关键发现摘要。',
        ]
      : kind === 'financial'
        ? [
            `请使用 financial-report-analyzer skill 为客户「${customer.name}」生成财报分析报告。`,
            '',
            `- 客户名称：${customer.name}`,
            `- 客户类型：${typeLabel}`,
            customer.industry ? `- 所属行业：${customer.industry}` : null,
            `- 客户文件夹：${customer.folderPath}`,
            `- 确切输出路径：${targetPath}`,
            '',
            '要求：先用知识库检索客户文件夹内的历史拜访纪要、尽调报告与资料，整理内部已知经营信息（客户自述的产能、订单、资金安排等，逐条注明出处文件名）；再按 skill 流程获取公开财报信息（简化版用 web_search 搜索财经媒体数据，详细版用 web_fetch 抓取年报原文，PDF 无法解析时说明局限并按简化版加深搜索补充；需要我选择简化版/详细版时先在对话中询问我）。按 skill 对应版本模板生成十章结构报告，【内部信息】与【公开信息】逐条标注来源，最后用写文件工具把报告写入上面的确切输出路径（已存在则覆盖更新），并在回复中汇报关键结论摘要。',
          ]
        : [
            `请使用 credit-committee-assistant skill 为客户「${customer.name}」生成审贷会准备材料。`,
            '',
            `- 客户名称：${customer.name}`,
            `- 客户类型：${typeLabel}`,
            customer.industry ? `- 所属行业：${customer.industry}` : null,
            `- 客户文件夹：${customer.folderPath}`,
            `- 确切输出路径：${targetPath}`,
            '',
            '要求：先用知识库检索客户文件夹内的历史拜访纪要与资料，整理"本行掌握情况"（客户承诺口径及进展、授信线索、待办进展，逐条注明出处文件名）；再用 web_search/web_fetch 获取最新财报、战略调整与行业动态（先按当前日期确定最新财报期，重点近 3 个月）。按 skill 模板生成审贷会准备材料，提问预测需包含评委可能追问的拜访细节（结合本行掌握情况），【内部信息】与【公开信息】逐条标注来源，最后用写文件工具把材料写入上面的确切输出路径（已存在则覆盖更新），并在回复中汇报关键结论摘要。',
          ]
  return promptLines.filter((line) => line !== null).join('\n')
}

// ---- 模块级 i18n toast（组件卸载后完成/失败提示仍需可达，不能依赖组件内的 useTranslations） ----
let cachedMessages: {
  locale: SupportedLocale
  messages: AbstractIntlMessages
} | null = null

/** 按当前语言读取 customer 命名空间的文案模板（读取失败返回 null） */
async function getCustomerMessageTemplate(key: string): Promise<string | null> {
  try {
    const locale = normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY))
    if (!cachedMessages || cachedMessages.locale !== locale) {
      const messages = await loadMessagesWithFallback(locale)
      cachedMessages = { locale, messages }
    }
    const ns = (cachedMessages.messages as Record<string, unknown>).customer
    const value = (ns as Record<string, unknown> | undefined)?.[key]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** 简易插值（与 next-intl 的 {var} 形式一致） */
function interpolate(
  template: string,
  values?: Record<string, string | number>
): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    values[name] !== undefined ? String(values[name]) : raw
  )
}

/** 模块级 toast：按当前语言输出 customer 命名空间文案，找不到文案时回退 key */
async function customerToast(
  key: string,
  options?: { values?: Record<string, string | number>; variant?: 'destructive' }
) {
  const template = await getCustomerMessageTemplate(key)
  toast({
    description: template ? interpolate(template, options?.values) : key,
    variant: options?.variant,
  })
}

/** 探测目标文件是否已由本次任务生成（文件出现且修改时间不早于激活时间） */
async function probeTargetFile(
  targetPath: string,
  startedAt: number
): Promise<boolean> {
  try {
    const fileOptions = await getFilePathOptions(targetPath)
    const statOptions = fileOptions.baseDir
      ? { baseDir: fileOptions.baseDir }
      : undefined
    const fileExists = await exists(fileOptions.path, statOptions)
    if (!fileExists) return false
    try {
      const info = await stat(fileOptions.path, statOptions)
      const modifiedAt = info.mtime ? new Date(info.mtime).getTime() : 0
      return modifiedAt >= startedAt - POLL_INTERVAL_MS
    } catch {
      // stat 失败时按文件已出现处理
      return true
    }
  } catch {
    return false
  }
}

/** 从聊天记录中提取本次任务最近一次 Agent 错误（错误消息以 "Error:" 开头写入） */
function extractLatestChatError(chats: Chat[], startedAt: number): string | null {
  for (let i = chats.length - 1; i >= 0; i--) {
    const chat = chats[i]
    // chats 按时间升序，早于任务激活时间的消息不再相关（留少量时钟余量）
    if (chat.createdAt < startedAt - 10000) break
    const content = chat.content?.trim()
    if (content && content.startsWith('Error:')) {
      const firstLine = content.slice('Error:'.length).trim().split('\n')[0]
      return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
    }
  }
  return null
}

/** 取本次任务激活后最近一条 Agent 回复（role 为 system）的内容 */
function findLatestAgentMessage(chats: Chat[], startedAt: number): string | null {
  for (let i = chats.length - 1; i >= 0; i--) {
    const chat = chats[i]
    if (chat.createdAt < startedAt - 10000) break
    if (chat.role === 'system' && chat.content?.trim()) {
      return chat.content.trim()
    }
  }
  return null
}

/** 错误语义判定："Error:" 前缀，或内容含 失败/无法 等失败措辞 */
function hasErrorSemantics(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  return (
    text.startsWith('Error:') || text.includes('失败') || text.includes('无法')
  )
}

/**
 * 提取本次运行的失败原因：优先 "Error:" 前缀消息（原始错误），
 * 其次最近一条 Agent 回复中的失败/无法措辞（截取首行作为原因展示）
 */
function extractRunError(chats: Chat[], startedAt: number): string | null {
  const prefixed = extractLatestChatError(chats, startedAt)
  if (prefixed) return prefixed
  const latest = findLatestAgentMessage(chats, startedAt)
  if (latest && hasErrorSemantics(latest)) {
    const firstLine = latest.split('\n')[0]
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
  }
  return null
}

/** 清理活跃任务的定时器与聊天订阅 */
function clearTaskRuntime() {
  if (pollTimer) clearInterval(pollTimer)
  if (timeoutTimer) clearTimeout(timeoutTimer)
  if (graceTimer) clearTimeout(graceTimer)
  pollTimer = null
  timeoutTimer = null
  graceTimer = null
  chatUnsubscribe?.()
  chatUnsubscribe = null
  activeTaskKey = null
}

/** 从任务列表移除指定任务 */
function removeTask(key: string) {
  useVisitGenerateStore.setState({
    tasks: useVisitGenerateStore.getState().tasks.filter((t) => t.key !== key),
  })
}

/**
 * 生成完成收尾：清理运行时、回写拜访记录、toast、发事件，然后推进队列。
 * 全部在模块级完成，组件卸载（切客户/离开页面）不影响。
 */
async function finishTask(task: VisitGenerateTask) {
  // 防重入：轮询与聊天监听可能同时判定完成，只有首个进入者生效
  if (activeTaskKey !== task.key) return
  clearTaskRuntime()
  removeTask(task.key)
  // A5 完成提醒：记录已完成 key，对应阶段区块显示"新"徽标（组件消费后清除）
  useVisitGenerateStore.setState({
    recentlyFinishedKeys: [
      ...useVisitGenerateStore.getState().recentlyFinishedKeys,
      task.key,
    ],
  })

  try {
    if (task.kind === 'previsit') {
      await useCustomerStore.getState().updateVisit(task.visitId, {
        previsitDocPath: task.targetPath,
      })
    } else if (task.visitId) {
      // 仅拜访级任务回写 postDocs（客户级任务无拜访可写）；
      // stage 的 'followed' 语义已废弃：报告生成提升到客户级后不再推进拜访阶段
      // （visited 仍由纪要导出触发），这里不再改 stage
      // 从 DB 读最新记录合并 postDocs（切客户后 store 中可能已不是该客户的数据）
      const latest = await getVisit(task.visitId)
      if (latest) {
        let paths: string[] = []
        try {
          const parsed = JSON.parse(latest.postDocs || '[]')
          if (Array.isArray(parsed)) {
            paths = parsed.filter((p): p is string => typeof p === 'string')
          }
        } catch {
          // 非法数据按空数组处理，直接重建
        }
        if (!paths.includes(task.targetPath)) {
          paths.push(task.targetPath)
        }
        await useCustomerStore.getState().updateVisit(task.visitId, {
          postDocs: JSON.stringify(paths),
        })
      }
    }
  } catch (err) {
    console.error('[VisitGenerate] 回写拜访产物路径失败:', err)
  }

  await customerToast(
    task.kind === 'previsit' ? 'previsitReadyToast' : 'reportsReadyToast'
  )
  emitter.emit('customer-visit-doc-generated', {
    customerId: task.customerId,
    visitId: task.visitId,
    kind: task.kind,
    path: task.targetPath,
  })
  pumpQueue()
}

/** 生成失败/中止收尾：清理运行时、toast 失败原因，然后推进队列 */
async function failTask(
  task: VisitGenerateTask,
  message: { key: string; values?: Record<string, string | number> }
) {
  // 防重入：与 finishTask 同理，只有首个进入者生效
  if (activeTaskKey !== task.key) return
  clearTaskRuntime()
  removeTask(task.key)
  await customerToast(message.key, {
    values: message.values,
    variant: 'destructive',
  })
  pumpQueue()
}

/**
 * 会话结束（loading true→false）后的结构化判定：
 * 1. 目标文件已生成 → 完成收尾
 * 2. 文件未生成且最近一条 Agent 回复含错误语义（Error:/失败/无法），
 *    或运行状态为 failed → 失败收尾（附错误原因）
 * 3. 否则给一次落盘宽限（END_GRACE_MS 后再查一次文件），仍无 → 失败收尾
 */
async function handleRunEnded(task: VisitGenerateTask) {
  const found = await probeTargetFile(task.targetPath, task.startedAt)
  if (found) {
    await finishTask(task)
    return
  }
  const state = useChatStore.getState()
  const errorText = extractRunError(state.chats, task.startedAt)
  if (errorText !== null) {
    await failTask(task, {
      key: 'generateFailedToast',
      values: { error: errorText },
    })
    return
  }
  if (state.agentState.status === 'failed') {
    // 运行已失败但聊天记录中没有可读原因
    await failTask(task, { key: 'generateNoFileToast' })
    return
  }
  // completed/stopped 且无错误语义：可能是文件落盘略晚于状态跳变，宽限后再查一次
  graceTimer = setTimeout(() => {
    graceTimer = null
    void (async () => {
      const retryFound = await probeTargetFile(task.targetPath, task.startedAt)
      if (retryFound) {
        await finishTask(task)
      } else {
        // 宽限后仍无文件：失败收尾，不再空等超时
        await failTask(task, { key: 'generateNoFileToast' })
      }
    })()
  }, END_GRACE_MS)
}

/** 订阅聊天状态：run 结束（loading true→false）或迟迟未启动时尽早收尾 */
function armChatWatcher(task: VisitGenerateTask) {
  let sawLoading = false
  let startGuardTimer: ReturnType<typeof setTimeout> | null = null

  chatUnsubscribe = useChatStore.subscribe((state) => {
    if (state.loading) {
      sawLoading = true
      if (startGuardTimer) {
        clearTimeout(startGuardTimer)
        startGuardTimer = null
      }
      return
    }
    if (!sawLoading) return
    // run 已结束：做最终文件判定（结束回调里先取消订阅，避免重复触发）
    chatUnsubscribe?.()
    chatUnsubscribe = null
    if (startGuardTimer) {
      clearTimeout(startGuardTimer)
      startGuardTimer = null
    }
    void handleRunEnded(task)
  })

  // 宽限期内聊天未进入 loading：消息未发出或 Agent 未启动，直接失败提示
  startGuardTimer = setTimeout(() => {
    if (sawLoading) return
    chatUnsubscribe?.()
    chatUnsubscribe = null
    void failTask(task, { key: 'generateNoFileToast' })
  }, START_GRACE_MS)
}

/** A1 会话命名：生成类型对应的会话标题片段（走模块级 i18n，与 customerToast 同机制） */
async function getTaskKindLabel(kind: VisitGenerateKind): Promise<string> {
  const key =
    kind === 'previsit'
      ? 'taskKindPrevisit'
      : kind === 'financial'
        ? 'taskKindFinancial'
        : 'taskKindCredit'
  return (await getCustomerMessageTemplate(key)) ?? kind
}

/**
 * A1 任务中心：任务激活发送前，为本次任务新建独立会话并命名为 `客户名·任务类型 MM-DD`
 * （如"宁德时代·访前尽调 07-23"），便于在历史会话中回溯，且不污染用户当前会话。
 * 创建失败时静默降级为沿用当前会话（不影响生成主流程）。
 */
async function prepareTaskConversation(task: VisitGenerateTask) {
  try {
    const kindLabel = await getTaskKindLabel(task.kind)
    const now = new Date()
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
    const title = `${task.customerName}·${kindLabel} ${mmdd}`
    const chatStore = useChatStore.getState()
    // 新建会话并切换过去（switchConversation 会清空旧会话的消息视图，加载新会话）
    const conversationId = await chatStore.createConversation(title)
    await useChatStore.getState().switchConversation(conversationId)
  } catch (err) {
    console.error('[VisitGenerate] 创建任务会话失败，沿用当前会话:', err)
  }
}

/** 激活一个排队任务：置 running、订阅聊天、发送提示词、启动轮询与超时 */
function startTask(task: VisitGenerateTask) {
  const startedAt = Date.now()
  activeTaskKey = task.key
  const running: VisitGenerateTask = { ...task, status: 'running', startedAt }
  useVisitGenerateStore.setState({
    tasks: useVisitGenerateStore
      .getState()
      .tasks.map((t) => (t.key === task.key ? running : t)),
  })

  // A1：先为任务准备独立命名会话，再订阅聊天并发送（会话切换是异步的，需等其完成，
  // 否则提示词会发进旧会话）；会话准备失败时降级沿用当前会话直接发送
  void (async () => {
    await prepareTaskConversation(running)

    // 先订阅聊天状态再发送，避免错过快速结束的 run
    armChatWatcher(running)

    // 程序化发送到右侧 Agent 聊天（chat-input 监听该事件后填入并自动发送）
    emitter.emit('send-chat-message', { content: running.prompt })
  })()

  // 兜底轮询：完成判定的主信号是 loading true→false 跳变（见 armChatWatcher），
  // 这里仅在聊天已空闲而跳变信号漏接时补一次文件判定；
  // 聊天仍在 loading 时不抢判（Agent 可能在写入文件后继续总结，提前收尾会让下个任务的提示词变成 steering 污染）
  pollTimer = setInterval(() => {
    void (async () => {
      if (useChatStore.getState().loading) return
      const found = await probeTargetFile(running.targetPath, startedAt)
      if (found) {
        await finishTask(running)
      }
    })()
  }, POLL_INTERVAL_MS)

  // 超时停止任务（生成可能仍在对话中继续，由用户自行查看）
  timeoutTimer = setTimeout(() => {
    void failTask(running, {
      key:
        running.kind === 'previsit'
          ? 'previsitTimeoutToast'
          : 'reportsTimeoutToast',
    })
  }, POLL_TIMEOUT_MS)
}

/** 聊天空闲后推进队列（用户自己的对话在跑时不插队，避免提示词变成 steering 污染） */
function armIdleWaiter() {
  if (idleUnsubscribe) return
  idleUnsubscribe = useChatStore.subscribe((state) => {
    if (state.loading) return
    idleUnsubscribe?.()
    idleUnsubscribe = null
    pumpQueue()
  })
}

/** 推进队列：无活跃任务且聊天空闲时激活下一个排队任务 */
function pumpQueue() {
  if (activeTaskKey) return
  const next = useVisitGenerateStore
    .getState()
    .tasks.find((t) => t.status === 'queued')
  if (!next) return
  if (useChatStore.getState().loading) {
    armIdleWaiter()
    return
  }
  startTask(next)
}

/**
 * 请求生成拜访/客户产物（访前尽调为拜访级；财报分析/审贷会材料为客户级）。
 * 任务进入模块级 FIFO 队列串行执行，组件卸载不中断；
 * 完成/失败均通过 toast 与 `customer-visit-doc-generated` 事件通知。
 * 客户级任务 visit 不传，visitId 置空、key 用 `${customerId}:${kind}`。
 *
 * 返回 'started'（立即开始）/ 'queued'（排队中）/ 'duplicate'（同类任务已存在）
 */
export function requestVisitGeneration(input: {
  customer: CustomerRecord
  visit?: VisitRecord // 拜访级任务（访前尽调）必传；客户级任务不传
  kind: VisitGenerateKind
}): 'started' | 'queued' | 'duplicate' {
  const { customer, visit, kind } = input
  const visitId = kind === 'previsit' ? visit?.id ?? '' : ''
  const key = visitId ? `${visitId}:${kind}` : `${customer.id}:${kind}`
  if (useVisitGenerateStore.getState().tasks.some((t) => t.key === key)) {
    return 'duplicate'
  }

  const targetPath = buildTargetPath(customer, visit, kind)
  const task: VisitGenerateTask = {
    key,
    visitId,
    customerId: customer.id,
    customerName: customer.name,
    kind,
    targetPath,
    prompt: buildPrompt(customer, kind, targetPath),
    status: 'queued',
    startedAt: 0,
  }
  useVisitGenerateStore.setState({
    tasks: [...useVisitGenerateStore.getState().tasks, task],
  })
  pumpQueue()
  return useVisitGenerateStore.getState().tasks.find((t) => t.key === key)
    ?.status === 'running'
    ? 'started'
    : 'queued'
}
