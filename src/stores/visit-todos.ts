import { create } from 'zustand'
import {
  confirmVisitTodo,
  createVisitTodo,
  deleteVisitTodo,
  deleteVisitTodoPermanently,
  getVisitTodoList,
  restoreVisitTodo,
  toggleVisitTodoDone,
  updateVisitTodo,
  type VisitTodoRecord,
} from '@/db/visit-todos'

// 待办面板 store：纪要自动提取 + 手动个人待办的统一消费入口。
// 组件订阅必须用 selector 精确取字段（useVisitTodosStore((s) => s.todos)），禁止全量订阅。
// 确认制（2.3）：AI 提取的待办 confirmed=0 只进"待确认"区；confirmTodo 确认后进入正式分组；
// "忽略"直接复用 removeTodo（软删除）。
// 软删除制（2.5）：removeTodo 标记 deleted=1 而非物理删除，可在"已删除"区恢复。
interface VisitTodosState {
  todos: VisitTodoRecord[] // 含已删除项（deleted=1），由组件按状态过滤展示
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
  removeTodo: (id: string) => Promise<void> // 软删除（乐观更新 + 失败回滚）
  restoreTodo: (id: string) => Promise<void> // 恢复已删除的待办
  permanentDeleteTodo: (id: string) => Promise<void> // 永久删除（不可恢复）
  editTodo: (id: string, updates: { content?: string; owner?: string; dueDate?: number }) => Promise<void>
  markTodosSeen: () => void // 清零新待办角标（待办面板打开时调用）
  noteExtractedTodos: (count: number) => void // 累加新待办角标（纪要提取成功后由挂载点调用）
  dropTodosByCustomer: (customerId: string) => void // 本地剔除某客户的待办（删除客户级联后调用，避免残留）
}

// 与 getVisitTodoList 的 SQL 排序保持一致，本地增改后重排
// 已删除（deleted=1）排最后，避免干扰正常列表
function compareTodos(a: VisitTodoRecord, b: VisitTodoRecord): number {
  // 已删除排最后
  if (a.deleted !== b.deleted) return a.deleted - b.deleted
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
      // includeDeleted: true 加载全部（含已删除），由组件按 deleted 状态分组展示
      const records = await getVisitTodoList({ includeDeleted: true })
      set({ todos: records, initialized: true })
    } catch (err) {
      console.error('[VisitTodosStore] 加载待办列表失败:', err)
      set({ initialized: true })
    }
  },

  refreshTodos: async () => {
    try {
      const records = await getVisitTodoList({ includeDeleted: true })
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
    // 软删除：乐观标记 deleted=1（保留在列表中，可恢复）
    const snapshot = get().todos
    set((state) => ({
      todos: state.todos
        .map((t) => (t.id === id ? { ...t, deleted: 1, updatedAt: Date.now() } : t))
        .sort(compareTodos),
    }))
    try {
      await deleteVisitTodo(id)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 删除待办失败:', err)
      throw err
    }
  },

  restoreTodo: async (id) => {
    // 恢复已删除的待办
    const snapshot = get().todos
    set((state) => ({
      todos: state.todos
        .map((t) => (t.id === id ? { ...t, deleted: 0, updatedAt: Date.now() } : t))
        .sort(compareTodos),
    }))
    try {
      await restoreVisitTodo(id)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 恢复待办失败:', err)
      throw err
    }
  },

  permanentDeleteTodo: async (id) => {
    // 永久删除：从列表中移除
    const snapshot = get().todos
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }))
    try {
      await deleteVisitTodoPermanently(id)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 永久删除待办失败:', err)
      throw err
    }
  },

  editTodo: async (id, updates) => {
    // 乐观更新 + 失败回滚
    const snapshot = get().todos
    set((state) => ({
      todos: state.todos
        .map((t) =>
          t.id === id
            ? {
                ...t,
                ...('content' in updates ? { content: updates.content! } : {}),
                ...('owner' in updates ? { owner: updates.owner! } : {}),
                ...('dueDate' in updates ? { dueDate: updates.dueDate! } : {}),
                updatedAt: Date.now(),
              }
            : t
        )
        .sort(compareTodos),
    }))
    try {
      await updateVisitTodo(id, updates)
    } catch (err) {
      set({ todos: snapshot })
      console.error('[VisitTodosStore] 编辑待办失败:', err)
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
