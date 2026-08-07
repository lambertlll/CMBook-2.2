import { create } from 'zustand';
import { Store } from "@tauri-apps/plugin-store";
import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import emitter from '@/lib/emitter';

interface Shortcut {
  key: string,
  value: string,
}

interface SettingState {
  shortcuts: Shortcut[],
  initShortcut: () => Promise<void>,
  setShortcut: (key: string, value: string) => Promise<void>,
  resetDefault: (key: string) => Promise<void>,
}

const defaultShortcuts: Shortcut[] = [
  {
    key: "openWindow",
    value: "CommandOrControl+Shift+W"
  },
  {
    key: 'startMeeting',
    value: 'CommandOrControl+Shift+M'
  }
]

function emitShortcutEvent(key: string) {
  // screenshotRecord（原记录截图快捷键）已随「记录」模块移除，不再发出失效事件
  emitter.emit(key)
}

// 串行化 bindShortcuts 调用，防止 React StrictMode 双重调用或快速连续调用时
// unregisterAll / register 交叉执行导致 "HotKey already registered" 竞态
let bindChain: Promise<void> = Promise.resolve()
// 模块级初始化守卫：开发模式 React 会 double-invoke effect，
// 避免第二次 initShortcut 在系统级快捷键尚未释放时重复注册同一组合键
let shortcutInitialized = false

async function bindShortcuts(shortcuts: Shortcut[]) {
  bindChain = bindChain.then(async () => {
    await unregisterAll()

    const registeredValues = new Set<string>()

    for (const shortcut of shortcuts) {
      try {
        if (shortcut.value && !registeredValues.has(shortcut.value)) {
          await register(shortcut.value, (event) => {
          if (event.state === 'Pressed') {
              emitShortcutEvent(shortcut.key)
          }
        });
          registeredValues.add(shortcut.value)
        }
      } catch (error) {
        // 注册失败：Windows 上系统级快捷键释放有延迟，同键重试一次；
        // 仍失败则静默降级（快捷键不可用不影响主流程）
        console.error(`Failed to register shortcut ${shortcut.value}:`, error);
        try {
          await unregister(shortcut.value)
          await register(shortcut.value, (event) => {
            if (event.state === 'Pressed') {
              emitShortcutEvent(shortcut.key)
            }
          })
        } catch (retryError) {
          console.warn(`Retry failed for shortcut ${shortcut.value}:`, retryError)
        }
      }
    }
  })
  // 如果链中某次调用抛错，不能让后续调用永远 pending
  bindChain = bindChain.catch(() => {})
  return bindChain
}

const useShortcutStore = create<SettingState>((set, get) => ({
  shortcuts: [],

  initShortcut: async () => {
    // 幂等守卫：开发模式 React StrictMode 会 double-invoke effect，第二次调用直接跳过，
    // 避免与第一次的注册在系统级快捷键释放窗口内冲突（"HotKey already registered"）
    if (shortcutInitialized) return
    shortcutInitialized = true
    const store = await Store.load('store.json');
    const shortcuts = await store.get<Shortcut[]>('shortcuts')
    if (shortcuts && shortcuts.length) {
      const mergeShortcuts = defaultShortcuts.map((shortcut) => {
        const existShortcut = shortcuts.find((shortcutItem) => shortcutItem.key === shortcut.key)
        if (existShortcut) {
          return existShortcut
        } else {
          return shortcut
        }
      })
      set({ shortcuts: mergeShortcuts })
      await bindShortcuts(mergeShortcuts)
    } else {
      await store.set('shortcuts', defaultShortcuts)
      set({ shortcuts: defaultShortcuts })
      await bindShortcuts(defaultShortcuts)
    }
  },

  setShortcut: async (key: string, value: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    await bindShortcuts(newShortcuts)
  },

  resetDefault: async (key: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value: defaultShortcuts.find((shortcut) => shortcut.key === key)?.value || '' }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    await bindShortcuts(newShortcuts)
  },
}))

export default useShortcutStore
