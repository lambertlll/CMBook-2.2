import { create } from 'zustand'
import { parseDueDate, parseVisitTodosFromSummary, type ParsedVisitTodo } from '@/lib/visit-todos'
import { replaceMeetingTodos } from '@/db/visit-todos'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { useMeetingStore } from '@/app/core/main/meeting/meeting-store'

/**
 * 待办确认弹窗 store：纪要生成成功后解析出待办 → 弹窗展示给用户确认 →
 * 用户确认的待办以 confirmed=1 写入 visit_todos（直接进入正式分组）；
 * 用户跳过的待办以 confirmed=0 写入（进入"待确认"区，可后续在待办面板处理）。
 *
 * 与 meeting-customer-export.ts 的 extractVisitTodos 互补：
 * - 关联客户的会议走 syncMeetingSummaryToCustomer → extractVisitTodos（confirmed=0，待确认区）
 * - 本 store 提供弹窗确认入口，用户确认后批量置 confirmed=1
 * - 未关联客户的会议也通过本 store 提取待办（meetingId 关联，customerId/visitId 为空）
 */
interface TodoConfirmState {
  open: boolean
  meetingId: string
  meetingTitle: string
  customerId: string
  visitId: string
  todos: ParsedVisitTodo[]
  selected: boolean[]

  /** 解析纪要中的待办并弹窗展示（无待办时不弹窗，返回 false） */
  showFromSummary: (params: {
    meetingId: string
    meetingTitle: string
    customerId: string
    visitId: string
    summary: string
  }) => boolean
  toggle: (index: number) => void
  toggleAll: (selected: boolean) => void
  /** 编辑某条待办的内容 */
  updateTodoContent: (index: number, content: string) => void
  /** 编辑某条待办的负责人 */
  updateTodoOwner: (index: number, owner: string) => void
  /** 确认选中项 → confirmed=1 写入；未选中项 → confirmed=0 写入；关闭弹窗 */
  confirm: () => Promise<void>
  /** 跳过：全部以 confirmed=0 写入（待确认区），关闭弹窗 */
  skip: () => Promise<void>
  close: () => void
}

export const useTodoConfirmStore = create<TodoConfirmState>((set, get) => ({
  open: false,
  meetingId: '',
  meetingTitle: '',
  customerId: '',
  visitId: '',
  todos: [],
  selected: [],

  showFromSummary: (params) => {
    const todos = parseVisitTodosFromSummary(params.summary)
    if (todos.length === 0) return false
    set({
      open: true,
      meetingId: params.meetingId,
      meetingTitle: params.meetingTitle,
      customerId: params.customerId,
      visitId: params.visitId,
      todos,
      selected: todos.map(() => true),
    })
    return true
  },

  toggle: (index) => {
    set((state) => ({
      selected: state.selected.map((s, i) => (i === index ? !s : s)),
    }))
  },

  toggleAll: (selected) => {
    set((state) => ({
      selected: state.todos.map(() => selected),
    }))
  },

  updateTodoContent: (index, content) => {
    set((state) => ({
      todos: state.todos.map((todo, i) => (i === index ? { ...todo, content } : todo)),
    }))
  },

  updateTodoOwner: (index, owner) => {
    set((state) => ({
      todos: state.todos.map((todo, i) => (i === index ? { ...todo, owner } : todo)),
    }))
  },

  confirm: async () => {
    const state = get()
    if (state.todos.length === 0) {
      set({ open: false })
      return
    }
    // 获取最新的会议关联信息（弹窗打开期间可能被 autoClassifyMeeting 更新了 customerId/visitId）
    const latestMeeting = useMeetingStore.getState().meetings.find((m) => m.id === state.meetingId)
    const customerId = latestMeeting?.customerId || state.customerId
    const visitId = latestMeeting?.visitId || state.visitId
    // 选中的 → confirmed=1；未选中的 → confirmed=0
    const rows = state.todos.map((todo, i) => ({
      customerId,
      visitId,
      content: todo.content,
      owner: todo.owner,
      dueDate: parseDueDate(todo.dueText),
      confirmed: state.selected[i],
    }))
    await replaceMeetingTodos(state.meetingId, rows, { fullReset: true })
    await useVisitTodosStore.getState().refreshTodos()
    const confirmedCount = state.selected.filter(Boolean).length
    useVisitTodosStore.getState().noteExtractedTodos(confirmedCount)
    set({ open: false })
  },

  skip: async () => {
    const state = get()
    if (state.todos.length === 0) {
      set({ open: false })
      return
    }
    // 获取最新的会议关联信息（同 confirm）
    const latestMeeting = useMeetingStore.getState().meetings.find((m) => m.id === state.meetingId)
    const customerId = latestMeeting?.customerId || state.customerId
    const visitId = latestMeeting?.visitId || state.visitId
    // 全部以 confirmed=0 写入（待确认区）
    const rows = state.todos.map((todo) => ({
      customerId,
      visitId,
      content: todo.content,
      owner: todo.owner,
      dueDate: parseDueDate(todo.dueText),
      confirmed: false,
    }))
    await replaceMeetingTodos(state.meetingId, rows, { fullReset: true })
    await useVisitTodosStore.getState().refreshTodos()
    useVisitTodosStore.getState().noteExtractedTodos(state.todos.length)
    set({ open: false })
  },

  close: () => set({ open: false }),
}))
