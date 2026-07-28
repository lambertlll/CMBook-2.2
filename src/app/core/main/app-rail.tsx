'use client'

import { useEffect } from 'react'
import { Files, Mic, Users, BotMessageSquare, Settings } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useSidebarStore, type LeftSidebarTab } from '@/stores/sidebar'
import { useVisitTodosStore } from '@/stores/visit-todos'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// 左侧图标导轨（2.1 全局框架）：笔记 / 会议 / 客户 + 底部 AI 助手、设置
const RAIL_TABS: Array<{ id: LeftSidebarTab; icon: typeof Files }> = [
  { id: 'files', icon: Files },
  { id: 'meeting', icon: Mic },
  { id: 'customer', icon: Users },
]

// 导轨按钮激活态样式：浅底 + 主色图标/文字 + 左侧 3px 指示条（对齐原型 .rail-btn.active）
function railButtonClass(active: boolean) {
  return cn(
    'paper-rail-btn group relative flex h-[42px] w-[42px] flex-col items-center justify-center gap-[2px] rounded-lg text-[10px] transition-colors duration-150',
    active
      ? 'bg-accent font-semibold text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  )
}

// 激活态左侧 3px 指示条（相对导轨左边缘对齐）
function ActiveIndicator() {
  return (
    <span className="paper-rail-indicator absolute left-[-7px] top-[9px] bottom-[9px] w-[3px] rounded-full bg-primary" />
  )
}

export function AppRail() {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const leftSidebarTab = useSidebarStore((s) => s.leftSidebarTab)
  const setLeftSidebarTab = useSidebarStore((s) => s.setLeftSidebarTab)
  const leftSidebarVisible = useSidebarStore((s) => s.leftSidebarVisible)
  const toggleLeftSidebar = useSidebarStore((s) => s.toggleLeftSidebar)
  const rightSidebarVisible = useSidebarStore((s) => s.rightSidebarVisible)
  const toggleRightSidebar = useSidebarStore((s) => s.toggleRightSidebar)
  const newTodoCount = useVisitTodosStore((s) => s.newTodoCount)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)

  // 预加载待办列表（initialized 守卫），保证客户角标与右栏待办数据就绪
  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  // 导轨点击 = 切换 leftSidebarTab；二级面板处于收起状态时先展开
  const handleTabClick = (tab: LeftSidebarTab) => {
    if (tab !== leftSidebarTab) {
      void setLeftSidebarTab(tab)
    }
    if (!leftSidebarVisible) {
      void toggleLeftSidebar()
    }
  }

  return (
    <TooltipProvider>
      <nav
        aria-label={t('navigation.navigate')}
        className="paper-rail flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-background py-2.5"
      >
        {/* 品牌 Logo：品牌红圆角方块 + 白字「招」（paper 主题下为朱砂方印） */}
        <div className="paper-seal paper-seal-lg mb-2.5 flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand text-sm font-semibold text-brand-foreground">
          招
        </div>

        {RAIL_TABS.map((tab) => {
          const Icon = tab.icon
          const active = leftSidebarTab === tab.id
          // 客户入口保留新待办数字角标（打开待办面板即清零）
          const badge = tab.id === 'customer' ? newTodoCount : 0
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={railButtonClass(active)}
            >
              {active && <ActiveIndicator />}
              <Icon className="size-[19px] shrink-0" />
              <span className="whitespace-nowrap leading-none">{t(`navigation.${tab.id}`)}</span>
              {badge > 0 && (
                <span className="absolute right-[2px] top-[2px] flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          )
        })}

        <div className="flex-1" />

        {/* AI 助手：切换右侧 AI 面板 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('navigation.aiAssistant')}
              onClick={() => void toggleRightSidebar()}
              className={railButtonClass(rightSidebarVisible)}
            >
              {rightSidebarVisible && <ActiveIndicator />}
              <BotMessageSquare className="size-[19px] shrink-0" />
              <span className="whitespace-nowrap leading-none">{t('navigation.aiAssistant')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t('navigation.aiAssistant')}</p>
          </TooltipContent>
        </Tooltip>

        {/* 设置：跳转设置页 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('navigation.setting')}
              onClick={() => router.push('/core/setting')}
              className={railButtonClass(pathname.includes('/core/setting'))}
            >
              {pathname.includes('/core/setting') && <ActiveIndicator />}
              <Settings className="size-[19px] shrink-0" />
              <span className="whitespace-nowrap leading-none">{t('navigation.setting')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t('navigation.setting')}</p>
          </TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  )
}
