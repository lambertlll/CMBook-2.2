import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

/**
 * 界面主题（2.1 UI 重设计）：
 * - classic：现有商务蓝明暗体系（无 data-theme，next-themes 管 .dark 类，完整保留）
 * - navy / obsidian / paper：三套新主题，挂 [data-theme] 下的完整令牌（globals.css）；
 *   obsidian 同时挂 .dark 类使 dark: 工具类生效，navy/paper 强制移除 .dark
 * 选择持久化在 store.json 的 uiTheme 键；切换即时生效（CSS 变量，无需刷新）。
 */
export type UiTheme = 'classic' | 'navy' | 'obsidian' | 'paper'

/** 经典主题的明暗模式记忆键（切离 classic 时暂存，切回时恢复） */
const CLASSIC_MODE_KEY = 'classic-theme-mode'
/** next-themes 的 localStorage 键 */
const NEXT_THEME_KEY = 'theme'

interface UiThemeState {
  uiTheme: UiTheme
  initUiTheme: () => Promise<void>
  setUiTheme: (theme: UiTheme) => Promise<void>
}

/** 把主题应用到根节点（data-theme 与 .dark 类的协调见文件头注释） */
function applyUiTheme(theme: UiTheme): void {
  const root = document.documentElement

  if (theme === 'classic') {
    delete root.dataset.theme
    // 恢复经典明暗：优先用暂存值，其次 next-themes 现值，最后 system
    const saved =
      localStorage.getItem(CLASSIC_MODE_KEY) ||
      localStorage.getItem(NEXT_THEME_KEY) ||
      'system'
    localStorage.setItem(NEXT_THEME_KEY, saved)
    const dark =
      saved === 'dark' ||
      (saved === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
    return
  }

  // 首次切离经典：暂存当前明暗模式，供切回时恢复
  if (!localStorage.getItem(CLASSIC_MODE_KEY)) {
    localStorage.setItem(
      CLASSIC_MODE_KEY,
      localStorage.getItem(NEXT_THEME_KEY) || 'system'
    )
  }
  root.dataset.theme = theme
  const dark = theme === 'obsidian'
  localStorage.setItem(NEXT_THEME_KEY, dark ? 'dark' : 'light')
  root.classList.toggle('dark', dark)
}

export const useUiThemeStore = create<UiThemeState>((set) => ({
  uiTheme: 'paper',

  initUiTheme: async () => {
    try {
      const store = await Store.load('store.json')
      const saved = (await store.get('uiTheme')) as UiTheme | null
      const theme: UiTheme =
        saved && ['classic', 'navy', 'obsidian', 'paper'].includes(saved)
          ? saved
          : 'paper'
      set({ uiTheme: theme })
      applyUiTheme(theme)
    } catch (err) {
      console.error('[UiTheme] 读取主题失败，使用默认主题(paper):', err)
      applyUiTheme('paper')
    }
  },

  setUiTheme: async (theme) => {
    set({ uiTheme: theme })
    applyUiTheme(theme)
    try {
      const store = await Store.load('store.json')
      await store.set('uiTheme', theme)
      await store.save()
    } catch (err) {
      console.error('[UiTheme] 保存主题失败:', err)
    }
  },
}))
