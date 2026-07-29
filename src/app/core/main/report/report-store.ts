import { create } from 'zustand'
import {
  getOrCreateWeeklyReport,
  getWeeklyReportList,
  getWeekData,
  updateWeeklyReportContent,
  markWeeklyReportGenerated,
  getCurrentWeekStart,
  getWeekStartOffset,
  formatWeekRange,
  formatWeekLabel,
  type WeeklyReportRecord,
  type WeekData,
} from '@/db/weekly-reports'

// 周报 store：管理周报列表、当前选中周、周聚合数据、AI 生成状态。
// 组件订阅必须用 selector 精确取字段，禁止全量订阅。
interface ReportState {
  reports: WeeklyReportRecord[] // 周报列表（weekStart 倒序）
  currentReport: WeeklyReportRecord | null // 当前选中周的周报
  weekData: WeekData | null // 当前周聚合数据
  currentWeekStart: number // 当前选中周的 weekStart（周一 0 点）
  generating: boolean // AI 生成中
  streamingContent: string // AI 流式生成的实时内容（空串表示未在流式生成）
  initialized: boolean

  // Actions
  loadReports: () => Promise<void> // 首次加载（initialized 守卫）
  selectWeek: (weekStart: number) => Promise<void> // 切周 + 加载周报 + 加载周数据
  goToPrevWeek: () => Promise<void>
  goToNextWeek: () => Promise<void>
  goToCurrentWeek: () => Promise<void>
  saveContent: (content: string) => Promise<void> // 保存编辑
  markGenerated: (content: string) => Promise<void> // AI 生成完成
  setGenerating: (val: boolean) => void
  setStreamingContent: (content: string) => void // 更新流式内容
  refreshWeekData: () => Promise<void> // 刷新周聚合数据（待办/拜访变更后）
}

export const useReportStore = create<ReportState>((set, get) => ({
  reports: [],
  currentReport: null,
  weekData: null,
  currentWeekStart: getCurrentWeekStart(),
  generating: false,
  streamingContent: '',
  initialized: false,

  loadReports: async () => {
    if (get().initialized) return
    try {
      const records = await getWeeklyReportList(12)
      const currentWeekStart = get().currentWeekStart
      const report = await getOrCreateWeeklyReport(currentWeekStart)
      const data = await getWeekData(currentWeekStart, currentWeekStart + 7 * 86400000)
      set({
        reports: records,
        currentReport: report,
        weekData: data,
        initialized: true,
      })
    } catch (err) {
      console.error('[ReportStore] 加载周报列表失败:', err)
      set({ initialized: true })
    }
  },

  selectWeek: async (weekStart) => {
    try {
      const report = await getOrCreateWeeklyReport(weekStart)
      const data = await getWeekData(weekStart, weekStart + 7 * 86400000)
      set({
        currentWeekStart: weekStart,
        currentReport: report,
        weekData: data,
      })
      // 刷新列表（新周报可能需要加入列表）
      const records = await getWeeklyReportList(12)
      set({ reports: records })
    } catch (err) {
      console.error('[ReportStore] 切换周失败:', err)
    }
  },

  goToPrevWeek: async () => {
    const prev = getWeekStartOffset(get().currentWeekStart, -1)
    await get().selectWeek(prev)
  },

  goToNextWeek: async () => {
    const next = getWeekStartOffset(get().currentWeekStart, 1)
    await get().selectWeek(next)
  },

  goToCurrentWeek: async () => {
    await get().selectWeek(getCurrentWeekStart())
  },

  saveContent: async (content) => {
    const report = get().currentReport
    if (!report) return
    try {
      await updateWeeklyReportContent(report.id, content)
      set((state) => ({
        currentReport: state.currentReport
          ? { ...state.currentReport, content, updatedAt: Date.now() }
          : null,
      }))
    } catch (err) {
      console.error('[ReportStore] 保存周报失败:', err)
      throw err
    }
  },

  markGenerated: async (content) => {
    const report = get().currentReport
    if (!report) return
    try {
      await markWeeklyReportGenerated(report.id, content)
      const now = Date.now()
      set((state) => ({
        currentReport: state.currentReport
          ? { ...state.currentReport, content, aiGenerated: 1, generatedAt: now, updatedAt: now }
          : null,
        generating: false,
        streamingContent: '',
      }))
      // 刷新列表
      const records = await getWeeklyReportList(12)
      set({ reports: records })
    } catch (err) {
      console.error('[ReportStore] 标记 AI 生成失败:', err)
      set({ generating: false })
      throw err
    }
  },

  setGenerating: (val) => set({ generating: val, streamingContent: val ? '' : get().streamingContent }),

  setStreamingContent: (content) => set({ streamingContent: content }),

  refreshWeekData: async () => {
    const weekStart = get().currentWeekStart
    try {
      const data = await getWeekData(weekStart, weekStart + 7 * 86400000)
      set({ weekData: data })
    } catch (err) {
      console.error('[ReportStore] 刷新周数据失败:', err)
    }
  },
}))

// 导出工具函数供组件使用
export { formatWeekRange, formatWeekLabel }
