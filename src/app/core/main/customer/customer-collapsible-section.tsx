'use client'

import {
  useEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * 客户详情页可折叠区块容器（客户报告 / 拜访时间线 / 客户知识库共用）：
 * - 标题行常驻：图标衬底 + 标题 + 数量摘要 + 右侧操作区（headerExtra）+ chevron
 * - 折叠状态按区块维度全局持久化到 localStorage
 *   （键：customerPanel.collapse.<sectionId>，'true' = 收起；缺省/异常均按展开处理）
 * - 默认展开；收起时内容保持挂载（不销毁区块内部状态、不重复触发加载），
 *   用 grid-template-rows 0fr/1fr + visibility 做过渡动画（收起后内容不可聚焦）
 */

/** 读取区块折叠状态（localStorage 不可用时按默认展开处理） */
function readCollapsed(sectionId: string): boolean {
  try {
    return (
      window.localStorage.getItem(`customerPanel.collapse.${sectionId}`) ===
      'true'
    )
  } catch {
    return false
  }
}

interface CollapsibleCustomerSectionProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** 区块 ID（localStorage 键后缀：reports / timeline / knowledge） */
  sectionId: string
  /** 标题行图标（含主色浅底衬底，由各区块传入） */
  icon: ReactNode
  /** 区块标题（已翻译文案） */
  title: string
  /** 数量摘要（如「3 份报告」），标题旁弱化常驻展示 */
  summary?: ReactNode
  /** 标题行右侧操作区（徽标/按钮等，独立于折叠开关，点击不触发展开收起） */
  headerExtra?: ReactNode
  /** 覆盖整张卡片的浮层（如知识库拖拽悬停提示；传入后卡片自动加 relative 定位） */
  overlay?: ReactNode
  children: ReactNode
}

export function CollapsibleCustomerSection({
  sectionId,
  icon,
  title,
  summary,
  headerExtra,
  overlay,
  className,
  children,
  ...rest
}: CollapsibleCustomerSectionProps) {
  const t = useTranslations('customer')
  // 默认展开；挂载后再从 localStorage 恢复（静态导出场景避免水合不一致）
  const [collapsed, setCollapsed] = useState(false)

  // 初始化时恢复该区块的折叠状态
  useEffect(() => {
    setCollapsed(readCollapsed(sectionId))
  }, [sectionId])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(
          `customerPanel.collapse.${sectionId}`,
          String(next)
        )
      } catch {
        // localStorage 不可用时折叠状态仅本次会话内有效
      }
      return next
    })
  }

  const toggleLabel = collapsed
    ? t('expandSection', { title })
    : t('collapseSection', { title })

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4',
        overlay && 'relative',
        className
      )}
      {...rest}
    >
      {overlay}

      {/* 标题行常驻：左侧大面积为折叠开关；右侧操作区与 chevron 独立，不参与切换 */}
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={toggleLabel}
            className="flex w-full min-w-0 items-center gap-2 text-left"
          >
            {icon}
            <span className="truncate">{title}</span>
            {summary && (
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {summary}
              </span>
            )}
          </button>
        </h3>
        {headerExtra}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 transition-transform duration-300',
              collapsed && '-rotate-90'
            )}
          />
        </button>
      </div>

      {/* 内容区：0fr/1fr + visibility 过渡（收起动画结束后不可见、不可聚焦），内容保持挂载 */}
      <div
        aria-hidden={collapsed}
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-300 ease-in-out',
          collapsed ? 'invisible grid-rows-[0fr]' : 'visible grid-rows-[1fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
