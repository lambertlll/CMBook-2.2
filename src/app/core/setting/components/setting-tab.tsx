"use client";

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation";
import { settingNavGroups, settingSearchAliases, SettingNavItem } from '../config'
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Search, ArrowLeft } from "lucide-react";

// 高级分组展开状态记忆（localStorage），默认折叠
const ADVANCED_EXPANDED_KEY = 'setting-nav-advanced-expanded'

export function SettingTab() {
  const [currentPage, setCurrentPage] = useState('general')
  const [keyword, setKeyword] = useState('')
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('settings')
  const { setLastSettingPage } = useSettingStore()

  // 初始化时恢复高级分组的折叠状态
  useEffect(() => {
    try {
      setAdvancedExpanded(window.localStorage.getItem(ADVANCED_EXPANDED_KEY) === '1')
    } catch {
      // localStorage 不可用时保持默认折叠
    }
  }, [])

  function toggleAdvanced() {
    setAdvancedExpanded((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(ADVANCED_EXPANDED_KEY, next ? '1' : '0')
      } catch {
        // 忽略写入失败
      }
      return next
    })
  }

  function handleNavigation(anchor: string) {
    setCurrentPage(anchor)
    router.push(`/core/setting/${anchor}`)
    // 记录最后访问的设置页面
    setLastSettingPage(anchor)
  }

  useEffect(() => {
    // 从当前URL路径中提取当前页面
    const pageName = pathname.split('/').pop()
    if (pageName && pageName !== 'setting') {
      setCurrentPage(pageName)
      // 记录最后访问的设置页面
      setLastSettingPage(pageName)
    }
  }, [pathname, setLastSettingPage])

  const query = keyword.trim().toLowerCase()

  // D1 设置搜索：按标题/描述/内置别名（中英文）匹配
  const matches = (anchor: string): boolean => {
    if (!query) return true
    const title = t(`${anchor}.title`).toLowerCase()
    const desc = t(`${anchor}.desc`).toLowerCase()
    if (title.includes(query) || desc.includes(query)) return true
    const aliases = settingSearchAliases[anchor] ?? []
    return aliases.some((alias) => alias.toLowerCase().includes(query))
  }

  // 搜索时跨分组平铺命中项，保持分组声明顺序；忽略高级分组折叠状态
  const searchResults = useMemo(() => {
    if (!query) return []
    const results: SettingNavItem[] = []
    for (const group of settingNavGroups) {
      for (const item of group.items) {
        if (matches(item.anchor)) results.push(item)
      }
    }
    return results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchResults.length > 0) {
      handleNavigation(searchResults[0].anchor)
    }
  }

  function renderItem(item: SettingNavItem) {
    return (
      <li
        key={item.anchor}
        className={`
          w-full px-4 py-2.5 rounded-md cursor-pointer flex items-center gap-3 text-sm transition-colors
          ${currentPage === item.anchor
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-accent hover:text-accent-foreground text-foreground/80'
          }
        `}
        onClick={() => handleNavigation(item.anchor)}
      >
        <span className="size-4 shrink-0 flex items-center justify-center">
          {item.icon}
        </span>
        <span className="truncate">{t(`${item.anchor}.title`)}</span>
      </li>
    )
  }

  return (
    <div className="flex flex-col w-56 h-full bg-sidebar border-r">
      {/* 明显的退出通道：返回主界面（对新手友好，不再依赖顶栏小按钮） */}
      <div className="p-4 pb-2">
        <button
          type="button"
          onClick={() => router.push('/core/main')}
          className="flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <ArrowLeft className="size-4 shrink-0" />
          {t('backToMain')}
        </button>
      </div>
      {/* D1 设置搜索 */}
      <div className="p-4 pt-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('search.placeholder')}
            className="pl-8 h-9"
          />
        </div>
      </div>
      <ul className="w-full px-4 pb-4 flex flex-col flex-1 overflow-y-auto">
        {query ? (
          searchResults.length > 0 ? (
            searchResults.map(renderItem)
          ) : (
            <li className="px-4 py-8 text-sm text-muted-foreground text-center">
              {t('search.empty')}
            </li>
          )
        ) : (
          settingNavGroups.map((group) => {
            const collapsed = group.collapsible && !advancedExpanded
            return (
              <li key={group.id} className="flex flex-col mt-1 first:mt-0">
                {group.collapsible ? (
                  <button
                    type="button"
                    onClick={toggleAdvanced}
                    className="w-full px-4 pt-3 pb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>{t(`groups.${group.id}`)}</span>
                    {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                ) : (
                  <div className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
                    {t(`groups.${group.id}`)}
                  </div>
                )}
                {!collapsed && (
                  <ul className="flex flex-col">
                    {group.items.map(renderItem)}
                  </ul>
                )}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
