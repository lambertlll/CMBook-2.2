import { Store } from '@tauri-apps/plugin-store'
import type { AbstractIntlMessages } from 'next-intl'
import {
  LANGUAGE_STORAGE_KEY,
  loadMessagesWithFallback,
  normalizeLocale,
  type SupportedLocale,
} from '@/i18n/config'
import useSettingStore from '@/stores/setting'
import { useVisitTodosStore } from '@/stores/visit-todos'

// 待办到期系统提醒（B2-7）：
// 应用启动后检查一次，之后每 6 小时定时复查；对 done=0 且 dueDate>0 且
// dueDate ≤ 今天 23:59 的待办（即已逾期 + 今天到期）发送系统通知。
// 同一天同一条待办只提醒一次，已提醒记录持久化在 store.json 的 todoNotifyLog
// （结构 { 'YYYY-MM-DD': [todoId...] }，每次检查后只保留当天记录）。
// 总开关为 setting store 的 notifyTodoEnabled（默认 true），关闭时完全跳过。
// 通知权限不可用时运行时降级，仅 console.warn，不影响其他功能。

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 小时定时复查
const NOTIFY_LOG_KEY = 'todoNotifyLog'
const SINGLE_BODY_MAX_LEN = 30 // 单条通知正文取待办内容前 30 字
const MERGE_THRESHOLD = 3 // 超过 3 条合并为一条汇总通知

// 模块级调度状态：已启动标记 + 定时器句柄，保证重复调用幂等
let schedulerStarted = false
let recheckTimer: ReturnType<typeof setInterval> | null = null

// ---- 模块级 i18n（组件卸载后定时复查仍需可达，不能依赖组件内 useTranslations） ----
// 与 visit-generate-manager.ts 同一模式：按 localStorage 中的当前语言加载 messages 并缓存
let cachedMessages: {
  locale: SupportedLocale
  messages: AbstractIntlMessages
} | null = null

/** 按当前语言读取 notify 命名空间的文案模板（读取失败返回 null） */
async function getNotifyTemplate(key: string): Promise<string | null> {
  try {
    const locale = normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY))
    if (!cachedMessages || cachedMessages.locale !== locale) {
      const messages = await loadMessagesWithFallback(locale)
      cachedMessages = { locale, messages }
    }
    const ns = (cachedMessages.messages as Record<string, unknown>).notify
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

/** 本地日期键（YYYY-MM-DD），作为去重记录的日期维度 */
function localDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 今天 23:59:59.999 的时间戳（本地时区） */
function endOfTodayTs(now: Date): number {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

/**
 * 发送一条系统通知；权限未授予时先请求，仍不可用或插件调用失败时
 * 运行时降级为 console.warn 并返回 false（不抛出，不影响检查流程）。
 */
async function sendSystemNotification(title: string, body: string): Promise<boolean> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    )
    let granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
    if (!granted) {
      console.warn('[todo-notify] 系统通知权限未授予，跳过本次提醒')
      return false
    }
    sendNotification({ title, body })
    return true
  } catch (err) {
    console.warn('[todo-notify] 系统通知不可用，已降级跳过:', err)
    return false
  }
}

/** 检查一次到期/逾期待办并按需提醒（去重：同一天同一条只提醒一次） */
export async function checkDueTodosOnce(): Promise<void> {
  try {
    // 总开关关闭时完全跳过（含去重记录的读写）
    if (!useSettingStore.getState().notifyTodoEnabled) return

    // 只读消费待办 store：确保已初始化后取当前列表
    await useVisitTodosStore.getState().loadTodos()
    const { todos } = useVisitTodosStore.getState()

    const now = new Date()
    const endOfToday = endOfTodayTs(now)
    const todayKey = localDateKey(now)

    // 到期口径：未删除 + 未完成 + 有时限 + 时限 ≤ 今天 23:59（覆盖已逾期与今天到期）
    const dueTodos = todos.filter(
      (todo) =>
        todo.deleted === 0 &&
        todo.done === 0 &&
        todo.dueDate > 0 &&
        todo.dueDate <= endOfToday
    )

    const store = await Store.load('store.json')
    const log =
      (await store.get<Record<string, string[]>>(NOTIFY_LOG_KEY)) ?? {}
    const notifiedToday = new Set(log[todayKey] ?? [])

    const pendingTodos = dueTodos.filter((todo) => !notifiedToday.has(todo.id))

    if (pendingTodos.length > 0) {
      const title =
        (await getNotifyTemplate('notificationTitle')) ?? '待办到期提醒'
      const singleTemplate = (await getNotifyTemplate('singleTodo')) ?? '{content}'
      const multiTemplate =
        (await getNotifyTemplate('multiTodo')) ?? '{count} 项待办今天到期/已逾期'

      const sentIds: string[] = []
      if (pendingTodos.length <= MERGE_THRESHOLD) {
        // 不超过 3 条：逐条提醒，正文为待办内容前 30 字
        for (const todo of pendingTodos) {
          const content =
            todo.content.length > SINGLE_BODY_MAX_LEN
              ? `${todo.content.slice(0, SINGLE_BODY_MAX_LEN)}…`
              : todo.content
          const ok = await sendSystemNotification(
            title,
            interpolate(singleTemplate, { content })
          )
          // 仅发送成功才计入去重，失败的下轮复查会重试
          if (ok) sentIds.push(todo.id)
        }
      } else {
        // 超过 3 条：合并为一条汇总通知
        const ok = await sendSystemNotification(
          title,
          interpolate(multiTemplate, { count: pendingTodos.length })
        )
        if (ok) sentIds.push(...pendingTodos.map((todo) => todo.id))
      }

      if (sentIds.length > 0) {
        // 记录当天已提醒的待办，同时只保留当天键（历史日期已无意义，顺手清理）
        await store.set(NOTIFY_LOG_KEY, {
          [todayKey]: [...notifiedToday, ...sentIds],
        })
        await store.save()
      }
    } else if (Object.keys(log).some((key) => key !== todayKey)) {
      // 无需提醒时也顺手清理历史日期的去重记录，避免 store.json 膨胀
      await store.set(NOTIFY_LOG_KEY, { [todayKey]: [...notifiedToday] })
      await store.save()
    }
  } catch (err) {
    console.warn('[todo-notify] 待办到期检查失败:', err)
  }
}

/**
 * 启动待办到期提醒调度：立即检查一次 + 每 6 小时定时复查。
 * 幂等：重复调用直接返回（参照会议模块模块级单例的管理方式）。
 * 在桌面端 core layout 完成设置与数据库初始化后调用。
 */
export function initTodoNotifyScheduler(): void {
  if (schedulerStarted || typeof window === 'undefined') return
  schedulerStarted = true

  void checkDueTodosOnce()
  recheckTimer = setInterval(() => {
    void checkDueTodosOnce()
  }, RECHECK_INTERVAL_MS)

  // 页面卸载时清理定时器（桌面端 layout 常驻，此处仅兜底）
  window.addEventListener('beforeunload', () => {
    if (recheckTimer) {
      clearInterval(recheckTimer)
      recheckTimer = null
    }
  })
}
