'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { AppRail } from "./app-rail"
import { EditorLayout } from './editor/editor-layout'
import { MeetingPanel } from './meeting'
import { CustomerPanel } from './customer/customer-panel'
import { MeetingLiveTranscriptPanel } from './meeting/meeting-live-transcript-panel'
import { TodoPanel } from '@/components/todo/todo-panel'
import { TodoConfirmDialog } from './meeting/todo-confirm-dialog'
import { AppStatusBar } from '@/components/app-footbar'
import Chat from './chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import useArticleStore from '@/stores/article'
import { useCustomerStore } from './customer/customer-store'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { useTranslations } from 'next-intl'
import { PanelRightClose } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// 右栏模式：AI 对话 | 待办面板
type RightPanelMode = 'chat' | 'todo'

// 2.1 全局框架尺寸：图标导轨 56px、二级面板 246px、右侧 AI 面板 322px
const RAIL_WIDTH_PX = 56
const SECONDARY_PANEL_WIDTH_PX = 246
const AI_PANEL_WIDTH_PX = 322
// 面板最小像素宽度
const MIN_SECONDARY_WIDTH_PX = 200
const MIN_EDITOR_WIDTH_PX = 400

// 将像素宽度换算为 ResizablePanelGroup 百分比（相对导轨右侧的主区宽度）
function pxToPanelPercent(px: number) {
  if (typeof window === 'undefined') return 25
  const mainWidth = Math.max(640, window.innerWidth - RAIL_WIDTH_PX)
  return Math.min(45, (px / mainWidth) * 100)
}

/**
 * 右栏情境化容器（2.3 规则）：
 * - 文件 Tab 且无打开文件（启动首页）→ 默认待办
 * - 客户 Tab 未选客户（工作台）→ 默认待办
 * - 客户 Tab 已选客户 / 文件打开中 → 默认 AI 对话
 * - 顶部「对话 / 待办」分段切换：默认跟随情境，手动覆盖仅在当前情境内有效，情境切换后回归默认
 * 头部对齐原型：分段切换 + 右侧收起按钮
 */
function RightPanel() {
  const t = useTranslations('todos')
  const tNav = useTranslations('navigation')
  const leftSidebarTab = useSidebarStore((s) => s.leftSidebarTab)
  const toggleRightSidebar = useSidebarStore((s) => s.toggleRightSidebar)
  const activeFilePath = useArticleStore((s) => s.activeFilePath)
  const activeTabId = useArticleStore((s) => s.activeTabId)
  const currentCustomerId = useCustomerStore((s) => s.currentCustomerId)

  // 启动首页：文件 Tab 且编辑器处于空态（无活动文件/记录页签）
  const isFileHome = leftSidebarTab === 'files' && !activeFilePath && !activeTabId
  // 工作台：客户 Tab 且未选中客户
  const isCustomerWorkbench = leftSidebarTab === 'customer' && !currentCustomerId
  const defaultMode: RightPanelMode = isFileHome || isCustomerWorkbench ? 'todo' : 'chat'

  // 情境标识：仅在 Tab / 空态 / 客户选中态变化时变化，用于让手动覆盖随情境切换自动失效
  const contextKey = `${leftSidebarTab}|${isFileHome ? 1 : 0}|${currentCustomerId ? 1 : 0}`
  const [override, setOverride] = useState<{ key: string; mode: RightPanelMode } | null>(null)
  const mode = override && override.key === contextKey ? override.mode : defaultMode

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <div className="relative flex h-12 shrink-0 items-center justify-center border-b px-4">
          <div className="flex items-center gap-0.5 rounded-md border bg-muted p-0.5">
            {(['chat', 'todo'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setOverride({ key: contextKey, mode: m })}
                className={cn(
                  'h-6 rounded px-3 text-xs transition-colors',
                  mode === m
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'chat' ? t('switchChat') : t('switchTodo')}
              </button>
            ))}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={tNav('hideRightSidebar')}
                onClick={() => void toggleRightSidebar()}
                className="absolute right-3 flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelRightClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{tNav('hideRightSidebar')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1">
          {mode === 'todo' ? <TodoPanel /> : <Chat />}
        </div>
      </div>
    </TooltipProvider>
  )
}

/** 右栏内容滑入动画：可见时自右侧 translateX 淡入（对齐原型 AI 面板滑出效果） */
function SlideInRight({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!visible) {
      setEntered(false)
      return
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [visible])

  return (
    <div
      className={cn(
        'h-full w-full transition-[transform,opacity] duration-200 ease-out',
        entered && visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
      )}
    >
      {children}
    </div>
  )
}

function getDefaultLayout(layoutKey: string) {
  const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
  const layout = localStorage.getItem(storageKey);

  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      // 验证总和是否为 100
      const sum = parsed.reduce((a: number, b: number) => a + b, 0);
      if (Math.abs(sum - 100) < 0.1) {
        return parsed;
      }
      // 如果总和不是 100，清除这个无效的值
      console.warn(`Invalid layout sum ${sum} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }

  // 根据布局组合返回默认值（按 2.1 框架像素规格换算：AI 面板为压缩式第三栏）
  const left = pxToPanelPercent(SECONDARY_PANEL_WIDTH_PX)
  const right = pxToPanelPercent(AI_PANEL_WIDTH_PX)
  switch (layoutKey) {
    case 'left-center':
      return [left, 100 - left, 0]
    case 'left-center-right':
      return [left, 100 - left - right, right]
    case 'center-right':
      return [0, 100 - right, right]
    case 'left':
      return [left, 0, 0]
    case 'center':
      return [0, 100, 0]
    case 'left-right':
      return [left, 0, 100 - left]
    case 'right':
      return [0, 0, 100]
    default:
      return [left, 100 - left - right, right] // 默认三栏
  }
}

function ResizableWrapper() {
  const leftSidebarVisible = useSidebarStore((s) => s.leftSidebarVisible)
  const centerPanelVisible = useSidebarStore((s) => s.centerPanelVisible)
  const rightSidebarVisible = useSidebarStore((s) => s.rightSidebarVisible)
  const leftSidebarTab = useSidebarStore((s) => s.leftSidebarTab)
  const initSidebarState = useSidebarStore((s) => s.initSidebarState)
  const applyRightSidebarContext = useSidebarStore((s) => s.applyRightSidebarContext)
  const currentCustomerId = useCustomerStore((s) => s.currentCustomerId)

  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const centerPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  const [minSecondarySize, setMinSecondarySize] = useState(16)
  const [minEditorSize, setMinEditorSize] = useState(30)

  // 使用稳定的 layoutKey 用于存储，但不作为 React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')

  const calculateMinSizes = () => {
    // 以导轨右侧主区宽度为基准换算最小百分比
    const mainWidth = Math.max(640, window.innerWidth - RAIL_WIDTH_PX)
    const minSecondaryPercent = Math.max(10, (MIN_SECONDARY_WIDTH_PX / mainWidth) * 100)
    const minEditorPercent = Math.max(25, (MIN_EDITOR_WIDTH_PX / mainWidth) * 100)
    setMinSecondarySize(Math.min(minSecondaryPercent, 30))
    setMinEditorSize(Math.min(minEditorPercent, 50))
  }

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
    calculateMinSizes()

    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [])

  // 右栏情境规则（2.1 框架）：工作台（客户 Tab 未选客户）默认展开，其余情境默认收起
  useEffect(() => {
    applyRightSidebarContext(leftSidebarTab === 'customer' && !currentCustomerId ? 'workbench' : 'default')
  }, [leftSidebarTab, currentCustomerId, applyRightSidebarContext])

  // 当面板可见性变化时，控制面板的折叠和展开
  useEffect(() => {
    const timer = setTimeout(() => {
      // 左侧面板
      if (leftPanelRef.current) {
        if (leftSidebarVisible) {
          leftPanelRef.current.expand()
        } else {
          leftPanelRef.current.collapse()
        }
      }

      // 中间面板
      if (centerPanelRef.current) {
        if (centerPanelVisible) {
          centerPanelRef.current.expand()
        } else {
          centerPanelRef.current.collapse()
        }
      }

      // 右侧 AI 面板（压缩式：展开时压缩中栏，中栏内容自适应调整）
      if (rightPanelRef.current) {
        if (rightSidebarVisible) {
          rightPanelRef.current.expand()
        } else {
          rightPanelRef.current.collapse()
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [leftSidebarVisible, centerPanelVisible, rightSidebarVisible])

  // 根据面板可见性渲染布局
  // 注意：左侧面板始终渲染，所以 layoutKey 用于存储，但实际布局计算需要考虑左侧始终存在

  // 计算实际需要的默认尺寸（二级面板 / 主区 / AI 面板 三栏）
  const getActualLayout = () => {
    const savedLayout = getDefaultLayout(layoutKey)

    if (savedLayout.length === 3) {
      return savedLayout
    }

    // 默认布局：二级面板 246px / AI 面板 322px，其余给主区
    const left = pxToPanelPercent(SECONDARY_PANEL_WIDTH_PX)
    const right = pxToPanelPercent(AI_PANEL_WIDTH_PX)
    return [left, 100 - left - right, right]
  }

  const actualLayout = getActualLayout()

  const onLayout = (sizes: number[]) => {
    // 保存当前面板布局
    const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  };

  // 根据可见面板数量动态构建布局
  const renderLayout = () => {
    const panels = []
    let index = 0

    // 左侧面板（二级面板：文件树 / 会议列表 / 客户列表）
    panels.push(
      <ResizablePanel
        key="left"
        ref={leftPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minSecondarySize}
        collapsible={true}
        collapsedSize={0}
      >
        <LeftSidebar />
      </ResizablePanel>
    )

    // 左侧和中间之间的分隔条
    // 当中间面板可见时显示；当中间面板不可见但左右都可见时也显示（作为左右分隔条）
    const shouldShowLeftHandle = leftSidebarVisible && (centerPanelVisible || rightSidebarVisible)
    panels.push(
      <ResizableHandle
        key="handle-left-center"
        className={`${!shouldShowLeftHandle ? 'hidden' : ''}`}
      />
    )

    // 中间面板
    panels.push(
      <ResizablePanel
        key="center"
        ref={centerPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minEditorSize}
        collapsible={true}
        collapsedSize={0}
      >
        {leftSidebarTab === 'meeting' ? <MeetingPanel /> : leftSidebarTab === 'customer' ? <CustomerPanel /> : <EditorLayout />}
      </ResizablePanel>
    )

    // 中间和右侧之间的分隔条
    panels.push(
      <ResizableHandle
        key="handle-center-right"
        className={`${!centerPanelVisible || !rightSidebarVisible ? 'hidden' : ''}`}
      />
    )

    // 右侧 AI 面板（压缩式：对话 / 待办；会议 Tab 下为实时转写）
    panels.push(
      <ResizablePanel
        key="right"
        ref={rightPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={15}
        collapsible={true}
        collapsedSize={0}
      >
        <SlideInRight visible={rightSidebarVisible}>
          {leftSidebarTab === 'meeting' ? <MeetingLiveTranscriptPanel /> : <RightPanel />}
        </SlideInRight>
      </ResizablePanel>
    )

    return panels
  }

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={onLayout}
      className="h-full"
    >
      {renderLayout()}
    </ResizablePanelGroup>
  )
}

function Page() {
  useEffect(() => {
    // 保存当前页面路径
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()
  }, [])

  // 2.1 全局框架：图标导轨 +（二级面板 / 主区 / AI 面板压缩式三栏）+ 底部状态栏
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <AppRail />
        <div className="min-w-0 flex-1">
          <ResizableWrapper />
        </div>
      </div>
      <AppStatusBar />
      <TodoConfirmDialog />
    </div>
  )
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
