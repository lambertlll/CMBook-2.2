'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Search, Minus, Square, Copy, X, PanelLeft, SquarePen, CalendarDays } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import { PinToggle } from './pin-toggle'
import { SyncToggle } from './title-bar-toolbars/sync-toggle'
import AppStatus from './app-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import React from 'react'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
  onActivityClick?: () => void
  activityOpen?: boolean
}

export function TitleBar({ onSearchClick, onActivityClick, activityOpen = false }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const [isMaximized, setIsMaximized] = useState(false)
  const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible, toggleLeftSidebar, toggleCenterPanel } = useSidebarStore()
  
  // 检查关闭面板后是否会导致"仅左"状态或无面板状态
  const wouldCauseLeftOnly = (currentVisible: boolean, panel: 'left' | 'center' | 'right') => {
    // 如果面板本来就不可见，不会导致问题（打开面板总是允许的）
    if (!currentVisible) return false
    
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    if (visibleCount === 1) return true // 不允许关闭最后一个面板
    
    if (visibleCount === 2) {
      // 只有当关闭中间或右侧面板会导致"仅左"状态时才阻止
      if (panel === 'center' && leftSidebarVisible && !rightSidebarVisible) return true
      if (panel === 'right' && leftSidebarVisible && !centerPanelVisible) return true
      // 关闭左侧面板不会导致"仅左"状态（它会变成"仅中"或"仅右"），所以允许
    }
    
    return false
  }
  const t = useTranslations()

  // 顶栏搜索触发框占位：全局搜索覆盖笔记 / 会议 / 客户（见 navigation.searchPlaceholder）
  const searchPlaceholder = t('navigation.searchPlaceholder')


  useEffect(() => {
    // 检查是否为移动设备
    setIsMobile(isMobileDevice())
    
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])

  // 同步窗口最大化状态：挂载时查询初始值，监听 onResized 实时更新（点击最大化后按钮图标切换为「还原」）
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false

    const syncMaximizeState = async () => {
      try {
        const window = getCurrentWindow()
        const maximized = await window.isMaximized()
        if (!cancelled) setIsMaximized(maximized)
      } catch (error) {
        console.error('Error checking maximized state:', error)
      }
    }

    void syncMaximizeState()

    const setupListener = async () => {
      try {
        const window = getCurrentWindow()
        const u = await window.onResized(() => {
          void syncMaximizeState()
        })
        if (cancelled) {
          u()
          return
        }
        unlisten = u
      } catch (error) {
        console.error('Error listening window resize:', error)
      }
    }
    void setupListener()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])



  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow()
      await window.minimize()
    } catch (error) {
      console.error('Error minimizing window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow()
      await window.toggleMaximize()
      // toggleMaximize 后 onResized 异步触发，这里主动刷新保证图标即时切换
      setIsMaximized(await window.isMaximized())
    } catch (error) {
      console.error('Error maximizing window:', error)
    }
  }

  const handleClose = async () => {
    try {
      const window = getCurrentWindow()
      await window.close()
    } catch (error) {
      console.error('Error closing window:', error)
    }
  }

  // 移动端不显示标题栏
  if (isMobile) {
    return null
  }

  // 平台未知时不显示
  if (currentPlatform === 'unknown') {
    return null
  }

  // macOS: 红绿灯按钮在左侧，拖拽区域需要避开
  // Windows/Linux: 控制按钮在右侧，拖拽区域需要避开
  const isMacOS = currentPlatform === 'macos'

  return (
    <TooltipProvider>
      <div
        className="h-[46px] w-full flex flex-nowrap items-center select-none shrink-0 fixed top-0 left-0 right-0 z-[9999] border-b bg-background"
        style={{
          // macOS 红绿灯按钮在左侧，需要留出空间（约 70px）
          paddingLeft: isMacOS ? '70px' : '0',
        }}
        data-tauri-drag-region
      >
        {/* 左侧品牌区：品牌红 Logo 方块 + 产品名与 slogan 横排 */}
        <div className="flex shrink-0 items-baseline gap-2 pl-3" data-tauri-drag-region>
          <span className="paper-seal flex size-5 items-center justify-center self-center rounded-[5px] bg-brand text-[11px] font-semibold leading-none text-brand-foreground">
            招
          </span>
          <span className="paper-brand-name text-[13px] font-semibold">招本</span>
          <span className="text-[12px] font-normal text-muted-foreground">CMBook</span>
          <span className="text-[10px] text-muted-foreground/70">
            · {t('navigation.slogan')}
          </span>
        </div>

        {/* 居中全局搜索触发框：点击打开 search-dialog（笔记/会议/客户），快捷键 Cmd/Ctrl+F */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,42vw)]" data-tauri-drag-region="false">
          <div
            role="button"
            aria-label={t('navigation.search')}
            className="relative flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-md border bg-muted px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => onSearchClick?.()}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">{searchPlaceholder}</span>
            <kbd className="pointer-events-none shrink-0 select-none rounded border bg-background px-1.5 py-px font-mono text-[11px] font-medium text-muted-foreground">
              {isMacOS ? '⌘F' : 'Ctrl F'}
            </kbd>
          </div>
        </div>

        {/* 右侧工具图标区 */}
        <div className="ml-auto flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          {/* 左侧边栏切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(leftSidebarVisible, 'left') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(leftSidebarVisible, 'left')) {
                    toggleLeftSidebar()
                  }
                }}
              >
                <PanelLeft className={`h-4 w-4 ${!leftSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{leftSidebarVisible ? t('navigation.hideLeftSidebar') : t('navigation.showLeftSidebar')}</p>
            </TooltipContent>
          </Tooltip>

          {/* 中间面板切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(centerPanelVisible, 'center') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(centerPanelVisible, 'center')) {
                    toggleCenterPanel()
                  }
                }}
              >
                <SquarePen className={`h-4 w-4 ${!centerPanelVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{centerPanelVisible ? t('navigation.hideCenterPanel') : t('navigation.showCenterPanel')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${activityOpen ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
                onClick={onActivityClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.activity')}</p>
            </TooltipContent>
          </Tooltip>

          <SyncToggle />

          <PinToggle />

          <AppStatus />
        </div>

        {/* Windows 控制按钮 */}
        {!isMacOS && (
          <div className="flex items-center shrink-0 relative z-10" data-tauri-drag-region="false">
            <span className="mx-1.5 h-[18px] w-px bg-border" data-tauri-drag-region="false" />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMinimize}
            >
              <Minus className="h-5 w-5" strokeWidth={2.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMaximize}
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? (
                <Copy className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
