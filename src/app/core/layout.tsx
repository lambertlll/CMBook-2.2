'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { initNetworkListeners } from "@/stores/network"
import { useEffect, useState } from "react";
import { initAllDatabases } from "@/db"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import useImageStore from "@/stores/imageHosting"
import useShortcutStore from "@/stores/shortcut"
import useEditorShortcutStore from "@/stores/editor-shortcut"
import { useRouter, usePathname } from "next/navigation"
import initShowWindow from "@/lib/shortcut/show-window"
import { initMcp } from "@/lib/mcp/init"
import { SearchDialog } from "@/components/search-dialog"
import { ActivityDrawer } from "@/components/activity/activity-drawer"
import { TitleBar } from "@/components/title-bar"
import { Store } from '@tauri-apps/plugin-store'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { TextSizeProvider } from "@/contexts/text-size-context"
import { SyncConfirmDialog } from "@/components/sync-confirm-dialog"
import { AutoDataSyncConflictDialog } from "@/components/auto-data-sync-conflict-dialog"
import { applyThemeColors } from "@/lib/theme-utils"
import { applyAppFontFamily } from "@/lib/font-settings"
import emitter from "@/lib/emitter"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import useArticleStore from "@/stores/article"
import { resolveOpenedMarkdownPath } from "@/lib/opened-files"
import { useToast } from "@/hooks/use-toast"
import { initAutoDataSyncRuntime } from "@/lib/sync/auto-data-sync-queue"
import { useSidebarStore } from "@/stores/sidebar"
import { useTranslations } from "next-intl"
import { quickStartMeeting } from "@/app/core/main/meeting/meeting-quick-start"
import { installBuiltinSkills } from "@/lib/skills/builtin"
import { useSkillsStore } from "@/stores/skills"
import { initTodoNotifyScheduler } from "@/lib/todo-notify"
import { useUiThemeStore } from "@/stores/ui-theme"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initSettingData, uiScale, customThemeColors, appFontFamily } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  const { initShortcut } = useShortcutStore()
  const { initEditorShortcuts } = useEditorShortcutStore()
  const { initVectorDb } = useVectorStore()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const { toast } = useToast()
  const [searchOpen, setSearchOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  // 全局网络状态监听（online/offline 事件 → network store），离线会议模式依赖
  useEffect(() => {
    return initNetworkListeners()
  }, [])

  useEffect(() => {
    let cancelled = false
    let unlistenOpenFiles: (() => void) | undefined

    const openMarkdownFiles = async (paths: string[]) => {
      if (paths.length === 0) {
        return
      }

      const articleStore = useArticleStore.getState()
      let openedCount = 0

      for (const path of paths) {
        const resolvedPath = await resolveOpenedMarkdownPath(path)
        if (!resolvedPath) {
          continue
        }

        await articleStore.setActiveFilePath(resolvedPath)
        openedCount += 1
      }

      if (openedCount > 0 && pathname !== '/core/main') {
        router.replace('/core/main')
      }

      if (openedCount === 0) {
        toast({
          title: '无法打开文件',
          description: '请选择存在的 Markdown 文件',
          variant: 'destructive',
        })
      }
    }

    const registerOpenFileListener = async () => {
      const window = getCurrentWindow()
      const unlisten = await window.listen<string[]>('open-files', (event) => {
        void openMarkdownFiles(event.payload)
      })

      if (cancelled) {
        unlisten()
        return
      }
      unlistenOpenFiles = unlisten

      const pendingPaths = await invoke<string[]>('drain_pending_open_files')
      await openMarkdownFiles(pendingPaths)
    }

    void registerOpenFileListener()

    return () => {
      cancelled = true
      unlistenOpenFiles?.()
    }
  }, [pathname, router, toast])

  // 同步托盘菜单文案（托盘「快速记录」区已随记录 Tab 一并移除）
  useEffect(() => {
    void invoke('update_tray_menu_labels', {
      labels: {
        open: t('tray.open'),
        showMain: t('tray.showMain'),
        startMeeting: t('tray.startMeeting'),
        newNote: t('tray.newNote'),
        newFolder: t('tray.newFolder'),
        settings: t('tray.settings'),
        window: t('tray.window'),
        pinToggle: t('tray.pinToggle'),
        hideWindow: t('tray.hideWindow'),
        quit: t('tray.quit'),
      },
    }).catch((error) => {
      console.debug('Failed to sync tray menu labels:', error)
    })
  }, [t])

  useEffect(() => {
    let cancelled = false
    let unlistenTrayAction: (() => void) | undefined
    let unlistenOpenSettings: (() => void) | undefined
    let unlistenStartMeeting: (() => void) | undefined

    const navigateToMain = async () => {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()

      if (pathname !== '/core/main') {
        router.replace('/core/main')
      }
    }

    const showSidebarTab = async (tab: 'files') => {
      await navigateToMain()

      const sidebar = useSidebarStore.getState()
      if (!sidebar.leftSidebarVisible) {
        await sidebar.toggleLeftSidebar()
      }
      await useSidebarStore.getState().setLeftSidebarTab(tab)
    }

    const handleStartMeeting = async () => {
      // 全局快捷键触发时窗口可能隐藏/最小化，先显示并聚焦（托盘点击已由 Rust 侧聚焦，重复调用幂等）
      const window = getCurrentWindow()
      if (!(await window.isVisible())) {
        await window.show()
      }
      if (await window.isMinimized()) {
        await window.unminimize()
      }
      await window.setFocus()
      await navigateToMain()
      await quickStartMeeting()
    }

    const togglePin = async () => {
      const store = await Store.load('store.json')
      const currentPin = await store.get<boolean>('pin')
      const nextPin = !currentPin

      await getCurrentWindow().setAlwaysOnTop(nextPin)
      await store.set('pin', nextPin)
      await store.save()
      emitter.emit('window-pin-changed', nextPin)
    }

    const ensureFileTreeLoaded = async () => {
      const articleStore = useArticleStore.getState()
      if (articleStore.fileTree.length === 0) {
        await articleStore.loadFileTree()
      }
    }

    const handleTrayAction = async (action: string) => {
      switch (action) {
        case 'new-note':
          await showSidebarTab('files')
          await ensureFileTreeLoaded()
          await useArticleStore.getState().newFile()
          break
        case 'new-folder':
          await showSidebarTab('files')
          await ensureFileTreeLoaded()
          await useArticleStore.getState().newFolder()
          break
        case 'start-meeting':
          await handleStartMeeting()
          break
        case 'pin-window':
        case 'pin':
          await togglePin()
          break
        default:
          break
      }
    }

    const registerTrayListeners = async () => {
      const window = getCurrentWindow()
      const trayActionUnlisten = await window.listen<string>('tray-action', (event) => {
        void handleTrayAction(event.payload)
      })
      const openSettingsUnlisten = await window.listen<string>('open-settings', async () => {
        const store = await Store.load('store.json')
        await store.set('currentPage', '/core/setting')
        await store.save()
        router.replace('/core/setting')
      })

      // 全局快捷键（Ctrl+Shift+M）通过 emitter 触发，与托盘"开始会议"走同一逻辑
      const startMeetingHandler = () => {
        void handleStartMeeting()
      }
      emitter.on('startMeeting', startMeetingHandler)

      if (cancelled) {
        trayActionUnlisten()
        openSettingsUnlisten()
        emitter.off('startMeeting', startMeetingHandler)
        return
      }

      unlistenTrayAction = trayActionUnlisten
      unlistenOpenSettings = openSettingsUnlisten
      unlistenStartMeeting = () => emitter.off('startMeeting', startMeetingHandler)
    }

    void registerTrayListeners()

    return () => {
      cancelled = true
      unlistenTrayAction?.()
      unlistenOpenSettings?.()
      unlistenStartMeeting?.()
    }
    // O10：监听只注册一次（依赖 [pathname] 会导致每次路由变化重注册 + 重复 drain 打开文件）；
    // openMarkdownFiles 内部按需 router.replace，不依赖本 effect 重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 重定向旧路径到新的 /core/main
  useEffect(() => {
    async function redirectOldPaths() {
      if (pathname === '/core/article' || pathname === '/core/record') {
        const store = await Store.load('store.json')
        await store.set('currentPage', '/core/main')
        await store.save()
        router.replace('/core/main')
      }
    }
    redirectOldPaths()
  }, [pathname, router])

  useEffect(() => {
    let cancelled = false

    const initializeApp = async () => {
      try {
        // 界面主题（2.1）：置于初始化链最前，避免等待 DB/skills 等耗时初始化
        // 导致首屏先以 classic 渲染、后跳变为纸韵的闪烁
        await useUiThemeStore.getState().initUiTheme()
        await initSettingData()
        initMainHosting()

        // 先完成数据库和默认工作区初始化，避免首次启动时其他逻辑抢先读取空目录或未建表数据库。
        await initAllDatabases()
        if (cancelled) return
        await initAutoDataSyncRuntime()
        if (cancelled) return

        initShortcut()
        initEditorShortcuts()
        await initVectorDb()
        if (cancelled) return

        // 安装/更新内置 skills（幂等），然后刷新 skill 发现，确保 Agent 能匹配到最新内置版本
        await installBuiltinSkills()
        if (cancelled) return
        const skillsStore = useSkillsStore.getState()
        if (skillsStore.initialized) {
          await skillsStore.refreshSkills()
        } else {
          await skillsStore.initSkills()
        }
        if (cancelled) return

        initShowWindow()
        initMcp()
        // 待办到期系统提醒（B2-7）：设置与数据库就绪后启动，启动即检查一次，之后每 6 小时复查
        initTodoNotifyScheduler()
      } catch (error) {
        console.error('Failed to initialize app core:', error)
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [])

  // 应用界面缩放
  useEffect(() => {
    if (uiScale && uiScale !== 100) {
      document.documentElement.style.fontSize = `${uiScale}%`
    }
  }, [uiScale])

  // 应用字体
  useEffect(() => {
    applyAppFontFamily(appFontFamily)
  }, [appFontFamily])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  useEffect(() => {
    switch (currentLocale) {
      case 'zh':
        dayjs.locale(zh);
        break;
      case 'en':
        dayjs.locale(en);
        break;
      default:
        break;
    }
  }, [currentLocale])

  // 禁用浏览器后退快捷键（Backspace）和添加搜索快捷键（Cmd/Ctrl+F）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 搜索快捷键：Cmd+F (macOS) 或 Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // 检查焦点是否在编辑器内
        const target = e.target as HTMLElement
        const editorElement = document.getElementById('aritcle-md-editor')
        const isFocusInEditor = editorElement && editorElement.contains(target)

        // 如果焦点在编辑器内，触发编辑器搜索
        if (isFocusInEditor) {
          e.preventDefault()
          // 触发编辑器内搜索
          emitter.emit('editor-search-trigger' as any)
          return
        }

        // 否则打开全局搜索
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // 如果按下 Backspace 键，且不在可编辑元素中
      if (e.key === 'Backspace') {
        const editableTarget = isEditableKeyboardTarget(e.target)
        if (editableTarget) {
          return
        }

        // 否则阻止默认的后退行为
        e.preventDefault()
      }

    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TextSizeProvider>
        <TitleBar
          onSearchClick={() => setSearchOpen(true)}
          onActivityClick={() => setActivityOpen(open => !open)}
          activityOpen={activityOpen}
        />
        <main className="flex flex-1 flex-col overflow-hidden w-full h-[calc(100vh-46px)] mt-[46px]">
          {children}
        </main>
        <ActivityDrawer open={activityOpen} onOpenChange={setActivityOpen} />
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <SyncConfirmDialog />
        <AutoDataSyncConflictDialog />
      </TextSizeProvider>
    </ThemeProvider>
  );
}
