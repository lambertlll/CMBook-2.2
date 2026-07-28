import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'


export interface SidebarState {
  fileSidebarVisible: boolean
  toggleFileSidebar: () => Promise<void>
  showFileSidebar: () => Promise<void>
  noteSidebarVisible: boolean
  toggleNoteSidebar: () => Promise<void>
  showNoteSidebar: () => Promise<void>
  leftSidebarVisible: boolean
  toggleLeftSidebar: () => Promise<void>
  centerPanelVisible: boolean
  toggleCenterPanel: () => Promise<void>
  showCenterPanel: () => Promise<void>
  rightSidebarVisible: boolean
  toggleRightSidebar: () => Promise<void>
  // 右栏情境（2.1 框架规则）：workbench=客户工作台（客户 Tab 未选客户）
  rightSidebarContext: RightSidebarContext
  // 情境切换时应用右栏默认可见性：工作台默认展开，其余默认收起；
  // 用户手动展开/收起的状态按情境记住，回到同一情境时恢复
  applyRightSidebarContext: (ctx: RightSidebarContext) => void
  leftSidebarTab: LeftSidebarTab
  setLeftSidebarTab: (tab: LeftSidebarTab) => Promise<void>
  initSidebarState: () => Promise<void>
}

// 左侧主标签：笔记 / 会议 / 客户（「记录」Tab 已移除）
export type LeftSidebarTab = 'files' | 'meeting' | 'customer'

// 右栏情境：workbench=客户工作台（默认展开），default=其余情境（默认收起）
export type RightSidebarContext = 'workbench' | 'default'

// 历史版本可能持久化了已移除的 'notes'，读取时兜底回 'files'
function normalizeLeftSidebarTab(tab: string): LeftSidebarTab {
  return tab === 'meeting' || tab === 'customer' ? tab : 'files'
}

// 从 localStorage 获取初始状态
const getInitialState = () => {
  if (typeof window === 'undefined') return { left: true, center: true, right: false }

  const leftState = localStorage.getItem('leftSidebarVisible')
  const centerState = localStorage.getItem('centerPanelVisible')

  return {
    left: leftState !== null ? leftState === 'true' : true,
    center: centerState !== null ? centerState === 'true' : true,
    // 2.1 框架规则：右栏（AI 面板）默认收起，不再沿用历史持久化状态；
    // 启动后由页面按情境应用默认值（工作台展开 / 其余收起）
    right: false,
  }
}

const initialState = getInitialState()

export const useSidebarStore = create<SidebarState>((set, get) => {
  // 各情境下用户手动展开/收起右栏的状态（仅会话内有效，不持久化）
  const rightManualOverride: Partial<Record<RightSidebarContext, boolean>> = {}

  return {
  fileSidebarVisible: true,
  toggleFileSidebar: async () => {
    const newState = !get().fileSidebarVisible
    set({ fileSidebarVisible: newState })
    const store = await Store.load('store.json')
    await store.set('fileSidebarVisible', newState)
    await store.save()
  },
  showFileSidebar: async () => {
    set({ fileSidebarVisible: true })
    const store = await Store.load('store.json')
    store.set('fileSidebarVisible', true)
  },
  noteSidebarVisible: true,
  toggleNoteSidebar: async () => {
    const newState = !get().noteSidebarVisible
    set({ noteSidebarVisible: newState })
    const store = await Store.load('store.json')
    await store.set('noteSidebarVisible', newState)
    await store.save()
  },
  showNoteSidebar: async () => {
    set({ noteSidebarVisible: true })
    const store = await Store.load('store.json')
    store.set('noteSidebarVisible', true)
  },
  leftSidebarVisible: initialState.left,
  toggleLeftSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    
    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    // 如果要关闭左侧面板，需要确保关闭后不会变成"仅左"状态（这是不可能的，因为关闭左侧）
    // 但要确保不会变成无面板状态
    if (leftSidebarVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }
    
    // 如果要打开左侧面板，总是允许
    const newState = !leftSidebarVisible
    set({ leftSidebarVisible: newState })
    localStorage.setItem('leftSidebarVisible', String(newState))
    const store = await Store.load('store.json')
    await store.set('leftSidebarVisible', newState)
    await store.save()
  },
  centerPanelVisible: initialState.center,
  showCenterPanel: async () => {
    if (get().centerPanelVisible) {
      return
    }

    set({ centerPanelVisible: true })
    localStorage.setItem('centerPanelVisible', 'true')
    const store = await Store.load('store.json')
    await store.set('centerPanelVisible', true)
    await store.save()
  },
  toggleCenterPanel: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    
    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    // 如果要关闭中间面板，需要确保关闭后不会变成"仅左"状态
    if (centerPanelVisible && visibleCount === 2 && leftSidebarVisible && !rightSidebarVisible) {
      return // 不允许关闭，否则会变成"仅左"状态
    }
    
    // 如果要关闭中间面板，也要确保不会变成无面板状态
    if (centerPanelVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }
    
    // 如果要打开中间面板，总是允许
    const newState = !centerPanelVisible
    set({ centerPanelVisible: newState })
    localStorage.setItem('centerPanelVisible', String(newState))
    const store = await Store.load('store.json')
    await store.set('centerPanelVisible', newState)
    await store.save()
  },
  rightSidebarVisible: initialState.right,
  toggleRightSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()

    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length

    // 如果要关闭右侧面板，需要确保关闭后不会变成"仅左"状态
    if (rightSidebarVisible && visibleCount === 2 && leftSidebarVisible && !centerPanelVisible) {
      return // 不允许关闭，否则会变成"仅左"状态
    }

    // 如果要关闭右侧面板，也要确保不会变成无面板状态
    if (rightSidebarVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }

    // 如果要打开右侧面板，总是允许
    const newState = !rightSidebarVisible
    // 记录为当前情境下的手动状态（情境内保持，不再持久化到 store.json/localStorage）
    rightManualOverride[get().rightSidebarContext] = newState
    set({ rightSidebarVisible: newState })
  },
  rightSidebarContext: 'default',
  applyRightSidebarContext: (ctx: RightSidebarContext) => {
    if (get().rightSidebarContext === ctx) return
    // 切换情境：优先恢复该情境记住的手动状态，否则用情境默认值（工作台展开 / 其余收起）
    const visible = rightManualOverride[ctx] ?? (ctx === 'workbench')
    set({ rightSidebarContext: ctx, rightSidebarVisible: visible })
  },
  leftSidebarTab: 'files',
  setLeftSidebarTab: async (tab: LeftSidebarTab) => {
    set({ leftSidebarTab: tab })
    localStorage.setItem('leftSidebarTab', tab)
    const store = await Store.load('store.json')
    await store.set('leftSidebarTab', tab)
    await store.save()
  },
  initSidebarState: async () => {
    const store = await Store.load('store.json')
    const leftState = await store.get<boolean>('leftSidebarVisible')
    const centerState = await store.get<boolean>('centerPanelVisible')
    const leftTab = await store.get<string>('leftSidebarTab')

    if (leftState !== null && leftState !== undefined) {
      set({ leftSidebarVisible: leftState })
      localStorage.setItem('leftSidebarVisible', String(leftState))
    }
    if (centerState !== null && centerState !== undefined) {
      set({ centerPanelVisible: centerState })
      localStorage.setItem('centerPanelVisible', String(centerState))
    }
    // 右栏不再恢复历史持久化状态：默认收起，由页面按情境应用默认值
    if (leftTab) {
      const normalizedTab = normalizeLeftSidebarTab(leftTab)
      set({ leftSidebarTab: normalizedTab })
      localStorage.setItem('leftSidebarTab', normalizedTab)
    }
  },
  }
})
