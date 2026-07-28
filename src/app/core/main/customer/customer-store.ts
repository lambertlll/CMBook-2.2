import { create } from 'zustand'
import {
  createCustomerRecord,
  deleteCustomerRecord,
  getCustomerList,
  toggleCustomerPin,
  type CustomerRecord,
  type CustomerType,
} from '@/db/customers'
import {
  createVisitRecord,
  deleteVisitRecord,
  deleteVisitsByCustomer,
  getVisitsByCustomer,
  updateVisitRecord,
  type VisitRecord,
  type VisitType,
} from '@/db/visits'
import { deleteVisitTodosByCustomer } from '@/db/visit-todos'
import { clearMeetingCustomerLink } from '@/db/meetings'
import { deleteVectorDocumentsByFolderPrefix } from '@/db/vector'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { useMeetingStore } from '../meeting/meeting-store'
import { ensureCustomerFolderStructure } from '@/lib/customer-folders'

/** 本地日期 YYYY-MM-DD（补建拜访标题兜底用） */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * 自动补建拜访记录：已关联该客户但尚未关联拜访的会议（含 2.4 修复前的历史存量），
 * 每场补一条 stage=visited 的拜访并回写 meeting.visitId（幂等，无遗漏时零写入）。
 * 保证"会议关联客户 → 拜访时间线/拜访次数"始终一致。
 */
async function backfillVisitsFromMeetings(customerId: string): Promise<void> {
  try {
    const meetingStore = useMeetingStore.getState()
    if (!meetingStore.initialized) {
      await meetingStore.loadMeetings()
    }
    const unlinked = useMeetingStore
      .getState()
      .meetings.filter((m) => m.customerId === customerId && !m.visitId)
    for (const m of unlinked) {
      const title = m.title?.trim() || `${formatDate(m.createdAt)} 拜访`
      const visit = await createVisitRecord({
        customerId,
        title,
        visitDate: m.createdAt,
        stage: 'visited',
        meetingId: m.id,
      })
      useMeetingStore.getState().updateMeeting(m.id, { visitId: visit.id })
    }
    if (unlinked.length > 0) {
      console.log(
        `[CustomerStore] 已为客户 ${customerId} 补建 ${unlinked.length} 条拜访记录`
      )
    }
  } catch (err) {
    console.warn('[CustomerStore] 补建拜访记录失败（不影响加载）:', err)
  }
}

interface CustomerStoreState {
  customers: CustomerRecord[]
  currentCustomerId: string | null // 当前查看的客户
  initialized: boolean
  visits: VisitRecord[] // 当前客户的拜访列表（按拜访时间倒序）
  visitsLoadedFor: string | null // visits 已加载的客户 ID（避免重复加载）

  // Actions
  loadCustomers: () => Promise<void>
  createCustomer: (input: {
    name: string
    type: CustomerType
    industry?: string
  }) => Promise<string> // 返回新客户 ID，失败时抛错由调用方提示
  selectCustomer: (id: string | null) => void
  removeCustomer: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>

  // 拜访 Actions
  loadVisits: (customerId: string) => Promise<void>
  createVisit: (input: {
    customerId: string
    title?: string
    visitDate?: number
    visitType?: VisitType
    notes?: string
  }) => Promise<VisitRecord> // 失败时抛错由调用方提示
  updateVisit: (
    id: string,
    fields: Partial<
      Pick<
        VisitRecord,
        'title' | 'visitDate' | 'stage' | 'visitType' | 'previsitDocPath' | 'meetingId' | 'noteDocPath' | 'postDocs' | 'notes'
      >
    >
  ) => Promise<void>
  removeVisit: (id: string) => Promise<void>
}

export const useCustomerStore = create<CustomerStoreState>((set, get) => ({
  customers: [],
  currentCustomerId: null,
  initialized: false,
  visits: [],
  visitsLoadedFor: null,

  loadCustomers: async () => {
    try {
      const records = await getCustomerList()
      set({ customers: records, initialized: true })
    } catch (err) {
      console.error('[CustomerStore] 加载客户列表失败:', err)
      set({ initialized: true })
    }
  },

  createCustomer: async (input) => {
    // 先建工作区客户文件夹（含访前/访中/访后/资料子目录），再把路径落库
    const folderPath = await ensureCustomerFolderStructure(input.name)
    const record = await createCustomerRecord({
      name: input.name.trim(),
      type: input.type,
      industry: input.industry?.trim() || '',
      folderPath,
    })
    // 新记录 isPinned=0、updatedAt 最新，排在置顶之后的最前
    set((state) => ({
      customers: [
        ...state.customers.filter((c) => c.isPinned),
        record,
        ...state.customers.filter((c) => !c.isPinned),
      ],
      currentCustomerId: record.id,
    }))
    return record.id
  },

  selectCustomer: (id) => {
    // 切换客户时同步清空拜访列表，避免新客户名下短暂显示旧客户拜访、
    // 以及生成产物回写时拿到旧客户数据（loadVisits 内部以 visitsLoadedFor 去重）
    set({ currentCustomerId: id, visits: [], visitsLoadedFor: null })
    if (id) {
      void get().loadVisits(id)
    }
  },

  removeCustomer: async (id) => {
    // 乐观删除前取出客户记录快照（级联清理向量索引需要 folderPath）
    const target = get().customers.find((c) => c.id === id)
    // 乐观删除（保留快照用于失败回滚）
    const snapshot = {
      customers: get().customers,
      currentCustomerId: get().currentCustomerId,
      visits: get().visits,
      visitsLoadedFor: get().visitsLoadedFor,
    }
    set((state) => ({
      customers: state.customers.filter((c) => c.id !== id),
      currentCustomerId:
        state.currentCustomerId === id ? null : state.currentCustomerId,
      // 删除的客户正是当前加载拜访列表的客户时，同步清空避免残留
      ...(state.currentCustomerId === id || state.visitsLoadedFor === id
        ? { visits: [], visitsLoadedFor: null }
        : {}),
    }))
    try {
      // 级联删除该客户的 visits 与待办记录；客户文件夹（含拜访产物）保留在工作区中，避免误删数据
      await deleteVisitsByCustomer(id)
      await deleteVisitTodosByCustomer(id)
      // 清空该客户名下会议的客户/拜访关联（会议本身保留，避免悬空指向已删客户）
      await clearMeetingCustomerLink(id)
      // 清理该客户知识库文件夹对应的向量索引（folderPath 为空说明未建文件夹，跳过）
      if (target?.folderPath) {
        await deleteVectorDocumentsByFolderPrefix(`${target.folderPath}/`)
      }
      await deleteCustomerRecord(id)
      // 同步剔除待办面板中该客户的条目，避免面板残留已删客户的待办
      useVisitTodosStore.getState().dropTodosByCustomer(id)
    } catch (err) {
      // 失败回滚快照，由调用方提示
      set(snapshot)
      console.error('[CustomerStore] 删除客户失败:', err)
      throw err
    }
  },

  togglePin: async (id) => {
    const next = await toggleCustomerPin(id)
    set((state) => ({
      customers: state.customers
        .map((c) =>
          c.id === id ? { ...c, isPinned: next, updatedAt: Date.now() } : c
        )
        // 与 getCustomerList 排序保持一致：置顶优先，其余按更新时间倒序
        .sort((a, b) => b.isPinned - a.isPinned || b.updatedAt - a.updatedAt),
    }))
  },

  loadVisits: async (customerId) => {
    try {
      // 先自动补建归类会议的拜访记录（含历史存量），保证时间线与拜访次数完整
      await backfillVisitsFromMeetings(customerId)
      const records = await getVisitsByCustomer(customerId)
      // 加载期间用户可能已切换到其他客户，避免覆盖新客户的列表
      if (get().currentCustomerId === customerId) {
        set({ visits: records, visitsLoadedFor: customerId })
      }
    } catch (err) {
      console.error('[CustomerStore] 加载拜访列表失败:', err)
    }
  },

  createVisit: async (input) => {
    const record = await createVisitRecord(input)
    set((state) => ({
      // 与 getVisitsByCustomer 排序保持一致：visitDate 倒序，其次 updatedAt 倒序
      visits: [...state.visits, record].sort(
        (a, b) => b.visitDate - a.visitDate || b.updatedAt - a.updatedAt
      ),
    }))
    return record
  },

  updateVisit: async (id, fields) => {
    await updateVisitRecord(id, fields)
    set((state) => ({
      visits: state.visits.map((v) =>
        v.id === id ? { ...v, ...fields, updatedAt: Date.now() } : v
      ),
    }))
  },

  removeVisit: async (id) => {
    // 乐观删除（保留快照用于失败回滚）
    const snapshot = get().visits
    set((state) => ({
      visits: state.visits.filter((v) => v.id !== id),
    }))
    try {
      // 仅删除 visits 记录：客户文件夹中的文件都保留
      await deleteVisitRecord(id)
      // 清空关联会议的 visitId（否则 ensureVisitForMeeting 会因 visitId 非空跳过重建）
      const meeting = useMeetingStore.getState().meetings.find((m) => m.visitId === id)
      if (meeting) {
        useMeetingStore.getState().updateMeeting(meeting.id, { visitId: '' })
      }
    } catch (err) {
      // 失败回滚快照，由调用方提示
      set({ visits: snapshot })
      console.error('[CustomerStore] 删除拜访失败:', err)
      throw err
    }
  },
}))

/**
 * 获取当前选中的客户（供组件配合 selector 订阅使用）
 */
export function getCurrentCustomer(
  state: Pick<CustomerStoreState, 'customers' | 'currentCustomerId'>
): CustomerRecord | undefined {
  return state.customers.find((c) => c.id === state.currentCustomerId)
}
