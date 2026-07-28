import { create } from 'zustand'
import {
  confirmVisitTodo,
  createVisitTodo,
  deleteVisitTodo,
  getVisitTodoList,
  toggleVisitTodoDone,
  type VisitTodoRecord,
} from '@/db/visit-todos'

// 待办面板 store：纪要自动提取 + 手动个人待办的统一消费入口。
// 组件订阅必须用 selector 精确取字段（useVisitTodosStore((s) => s.todos)），禁止全量订阅。
// 确认制（2.3）：AI 提取的待办 confirmed=0 只进"待确认"区；confirmTodo 确认后进入正式分组；
// "忽略"直接复用 removeTodo（删除）。
interface VisitTodosState {
  todos: VisitTodoRecord[] // 排序与 getVisitTodoList 一致：未完成优先 → 时限近者优先（0 无时限排最后）→ 新创建优先
  initialized: boolean
  newTodoCount: number // 未读新待办角标计数（面板打开时 markTodosSeen 清零）

  // Actions
  loadTodos: () => Promise<void> // 首次加载（initialized 守卫，重复调用直接返回）
  refreshTodos: () => Promise<void> // 强制重载（纪要提取成功后由挂载点调用）
  toggleDone: (id: string) => Promise<void> // 失败时抛错由调用方提示
  confirmTodo: (id: string) => Promise<void> // 确认 AI 提取的待办（乐观更新 + 失败回滚）
  addManualTodo: (input: {
    content: string
    customerId?: string
    owner?: string
    dueDate?: number
  }) => Promise<VisitTodoRecord> // 返回新记录；内容为空或失败时抛错由调用方提示
  removeTodo: (id: string) => Promise<void> // 乐观删除 + 失败回滚，失败时抛错
  markTodosSeen: () => void // 清零新待办角标（待办面板打开时调用）
  noteExtractedTodos: (count: number) => void // 累加新待办角标（纪要提取成功后由挂载点调用）
  dropTodosByCustomer: (customerId: string) => void // 本地剔除某客户的待办（删除客户级联后调用，避免残留）
}

// 与 getVisitTodoList 的 SQL 排序保持一致，本地增改后重排
function compareTodos(a: VisitTodoRecord, b: VisitTodoRecord): number {
  if (a.done !== b.done) return a.done - b.done
  // dueDate 为 0（无时限）排最后
  const aDue = a.dueDate === 0 ? Number.MAX_SAFE_INTEGER : a.dueDate
  const bDue = b.dueDate === 0 ? Number.MAX_SAFE_INTEGER : b.dueDate
  if (aDue !== bDue) return aDue - bDue
  return b.createdAt - a.createdAt
}

export const useVisitTodosStore = create<VisitTodosState>((set, get) => ({
  todos: [],
  initialized: false,
  newTodoCount: 0,

  loadTodos: async () => {
    if (get().initialized) return
    try {
      const records = await getVisitTodoList()
      set({ todos: records, initialized: true })
    } catch (err) {
      console.error('[VisitTodosStore] 加载待办列表失败:', err)
      set({ initialized: true })
    }
  },

  refreshTodos: async () => {
    try {
      const records = await getVisitTodoList()
      set({ todos: records, initialized: true })
    } catch (err) {
      console.error('[VisitTodosStore] 刷新待办列表失败:', err)
    }
  },

  toggleDone: async (id) => {
    const done = await toggleVisitTodoDone(id)
    set((state) => ({
      todos: state.todos
        .map((t) => (t.id === id ? { ...t, done: done ? 1 : 0, updatedAt: Date.now() } : t))
        .sort(compareTodos),
    }))
  },

  confirmTodo: async (id) => {
    // 乐观更新 + 失败回滚
    const snapshot = get().todos
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id ? { ...t, confirmed: 1, updatedAt: Date.now() } : t
      ),
    }))
    try {
      await confirmVisitTodo(id)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 确认待办失败:', err)
      throw err
    }
  },

  addManualTodo: async (input) => {
    const content = input.content.trim()
    if (!content) {
      throw new Error('待办内容不能为空')
    }
    const record = await createVisitTodo({
      content,
      customerId: input.customerId,
      owner: input.owner,
      dueDate: input.dueDate,
    })
    set((state) => ({ todos: [...state.todos, record].sort(compareTodos) }))
    return record
  },

  removeTodo: async (id) => {
    // 乐观删除（保留快照用于失败回滚）
    const snapshot = get().todos
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }))
    try {
      await deleteVisitTodo(id)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 删除待办失败:', err)
      throw err
    }
  },

  markTodosSeen: () => {
    if (get().newTodoCount !== 0) {
      set({ newTodoCount: 0 })
    }
  },

  noteExtractedTodos: (count) => {
    if (count <= 0) return
    set((state) => ({ newTodoCount: state.newTodoCount + count }))
  },

  dropTodosByCustomer: (customerId) => {
    set((state) => ({
      todos: state.todos.filter((t) => t.customerId !== customerId),
    }))
  },
}))
