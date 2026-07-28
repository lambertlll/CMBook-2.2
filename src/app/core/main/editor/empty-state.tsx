'use client'

import { Clock, FileText, Mic, Search, Users } from 'lucide-react'
import useArticleStore, { type DirTree } from '@/stores/article'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import useShortcutStore from '@/stores/shortcut'
import { useSidebarStore } from '@/stores/sidebar'
import { useVisitTodosStore } from '@/stores/visit-todos'
import useSettingStore from '@/stores/setting'
import { getUpcomingVisits } from '@/db/visits'
import { computedParentPath } from '@/lib/path'
import { cn } from '@/lib/utils'
import { getActiveOnboardingStep, getNextOnboardingStep, type OnboardingProgress, type OnboardingStepId } from './onboarding-state'
import { createNewNoteFromEmptyState, isUntitledNoteName, resolveFirstLineTitle, stripNoteExtension } from './empty-state-actions'
import { quickStartMeeting } from '../meeting/meeting-quick-start'

// 最近编辑列表条数上限（对齐原型 5 行）
const RECENT_LIMIT = 5
// 笔记类文件（最近编辑候选）
const NOTE_FILE_RE = /\.(md|txt|markdown)$/i
// record:// 开头的 tab 是记录详情页，不是文件
const RECORD_TAB_PREFIX = 'record://'

interface RecentItem {
  path: string
  name: string
  modifiedAt?: string
}

interface EmptyStateProps {
  onboardingProgress: OnboardingProgress
  activeOnboardingStep: OnboardingStepId | null
  visibleOnboardingStep: OnboardingStepId | null
  completedOnboardingStep: OnboardingStepId | null
  onStartOnboardingStep: (step: OnboardingStepId) => void | Promise<void>
  onContinueToNextStep: () => void | Promise<void>
  onDismissOnboarding: () => void | Promise<void>
}

// 问候语按时段选择：5–12 点早上好，12–18 点下午好，其余晚上好
function getGreetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

// 最近编辑时间展示：当天显示「今天 HH:mm」，跨天显示「MM/dd HH:mm」
function formatRecentTime(ts: string | undefined, todayLabel: string, locale: string): string {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const hm = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === new Date().toDateString()) {
    return `${todayLabel} ${hm}`
  }
  return `${date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })} ${hm}`
}

export function EmptyState({
  onboardingProgress,
  activeOnboardingStep,
  visibleOnboardingStep,
  completedOnboardingStep,
  onStartOnboardingStep,
  onContinueToNextStep,
  onDismissOnboarding,
}: EmptyStateProps) {
  const newFile = useArticleStore((s) => s.newFile)
  const fileTree = useArticleStore((s) => s.fileTree)
  const openTabs = useArticleStore((s) => s.openTabs)
  const setActiveFilePath = useArticleStore((s) => s.setActiveFilePath)
  const setLeftSidebarTab = useSidebarStore((s) => s.setLeftSidebarTab)
  const todos = useVisitTodosStore((s) => s.todos)
  const loadTodos = useVisitTodosStore((s) => s.loadTodos)
  const t = useTranslations('article.emptyState')
  const tHome = useTranslations('article.home')
  const locale = useLocale()
  const shortcuts = useShortcutStore((s) => s.shortcuts)
  const [meetingShortcut, setMeetingShortcut] = useState('')
  // 本周待拜访场数（近 7 天，来源 visits 表）
  const [weeklyVisitCount, setWeeklyVisitCount] = useState(0)
  // Untitled 文件的首行标题（path → 标题）
  const [firstLineTitles, setFirstLineTitles] = useState<Record<string, string>>({})
  const requestedTitlesRef = useRef<Set<string>>(new Set())

  const handleCreateNote = async () => {
    await createNewNoteFromEmptyState({
      setLeftSidebarTab,
      newFile,
    })
  }

  // 注册快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N 创建笔记
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void handleCreateNote()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [newFile, setLeftSidebarTab])

  // 读取开始会议快捷键
  useEffect(() => {
    const shortcut = shortcuts.find(s => s.key === 'startMeeting')
    if (shortcut) {
      // 转换快捷键格式：CommandOrControl+Shift+M -> ⌘ ⇧ M
      const formatted = shortcut.value
        .replace('CommandOrControl', '⌘')
        .replace('Command', '⌘')
        .replace('Control', 'Ctrl')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replaceAll('+', ' ')
      setMeetingShortcut(formatted)
    }
  }, [shortcuts])

  // 欢迎条概览数据：待办列表（store 有 initialized 守卫，重复调用安全）
  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  // 欢迎条概览数据：近 7 天待拜访场数
  useEffect(() => {
    getUpcomingVisits(7)
      .then((records) => setWeeklyVisitCount(records.length))
      .catch((err) => console.error('[EmptyState] 加载本周拜访失败:', err))
  }, [])

  const handleGlobalSearch = () => {
    // 触发全局搜索弹窗 (Cmd/Ctrl + F)
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      ctrlKey: true,
      bubbles: true
    })
    window.dispatchEvent(event)
  }

  // 快速操作：开始会议（品牌红强调）/ 创建笔记 / 客户拜访 / 全局搜索，行为与原入口一致
  const quickActions = [
    {
      key: 'startMeeting',
      icon: <Mic className="h-[17px] w-[17px]" />,
      title: tHome('quickActions.startMeeting.title'),
      description: tHome('quickActions.startMeeting.desc'),
      shortcut: meetingShortcut || undefined,
      brand: true,
      onClick: () => void quickStartMeeting(),
    },
    {
      key: 'newNote',
      icon: <FileText className="h-[17px] w-[17px]" />,
      title: tHome('quickActions.newNote.title'),
      description: tHome('quickActions.newNote.desc'),
      shortcut: '⌘ N',
      brand: false,
      onClick: () => void handleCreateNote(),
    },
    {
      key: 'customerVisit',
      icon: <Users className="h-[17px] w-[17px]" />,
      title: tHome('quickActions.customerVisit.title'),
      description: tHome('quickActions.customerVisit.desc'),
      shortcut: undefined,
      brand: false,
      onClick: () => void setLeftSidebarTab('customer'),
    },
    {
      key: 'globalSearch',
      icon: <Search className="h-[17px] w-[17px]" />,
      title: tHome('quickActions.globalSearch.title'),
      description: tHome('quickActions.globalSearch.desc'),
      shortcut: '⌘ F',
      brand: false,
      onClick: handleGlobalSearch,
    },
  ]

  // 最近编辑：优先「最近打开」（openTabs 持久化，后打开的在前），
  // 不足时按文件树 modifiedAt 倒序补充；按路径去重，最多 RECENT_LIMIT 条
  const recentItems = useMemo<RecentItem[]>(() => {
    const seen = new Set<string>()
    const result: RecentItem[] = []

    // 文件树拍平：path → 修改时间（openTabs 不带时间戳，从此处补齐）
    const modifiedMap = new Map<string, string>()
    const treeFiles: RecentItem[] = []
    const walk = (nodes: DirTree[]) => {
      for (const node of nodes) {
        if (node.isFile && node.name && NOTE_FILE_RE.test(node.name)) {
          const path = computedParentPath(node)
          if (node.modifiedAt) modifiedMap.set(path, node.modifiedAt)
          treeFiles.push({ path, name: node.name, modifiedAt: node.modifiedAt })
        }
        if (node.children) walk(node.children)
      }
    }
    walk(fileTree)

    for (const tab of [...openTabs].reverse()) {
      if (tab.kind === 'record' || tab.path.startsWith(RECORD_TAB_PREFIX)) continue
      if (!NOTE_FILE_RE.test(tab.path) || seen.has(tab.path)) continue
      seen.add(tab.path)
      result.push({
        path: tab.path,
        name: tab.path.split('/').pop() || tab.path,
        modifiedAt: modifiedMap.get(tab.path),
      })
      if (result.length >= RECENT_LIMIT) return result
    }

    treeFiles.sort((a, b) => {
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
      return bTime - aTime
    })
    for (const file of treeFiles) {
      if (seen.has(file.path)) continue
      seen.add(file.path)
      result.push(file)
      if (result.length >= RECENT_LIMIT) break
    }
    return result
  }, [openTabs, fileTree])

  // Untitled 文件异步解析首行标题（每个路径只请求一次）
  useEffect(() => {
    const targets = recentItems.filter(
      (item) => isUntitledNoteName(item.name) && !requestedTitlesRef.current.has(item.path)
    )
    if (targets.length === 0) return
    targets.forEach((item) => requestedTitlesRef.current.add(item.path))
    let cancelled = false
    void Promise.all(
      targets.map(async (item) => ({ path: item.path, title: await resolveFirstLineTitle(item.path) }))
    ).then((entries) => {
      if (cancelled) return
      setFirstLineTitles((prev) => {
        const next = { ...prev }
        for (const entry of entries) next[entry.path] = entry.title
        return next
      })
    })
    return () => { cancelled = true }
  }, [recentItems])

  // 欢迎条：时段问候 + 本周概览 + 当前日期
  // 称呼：用户自定义名字（设置页可改），空串时按界面语言显示产品名
  const userDisplayName = useSettingStore((s) => s.userDisplayName)
  const displayName = userDisplayName.trim() || tHome('defaultName')
  const greeting = tHome(`greeting.${getGreetingKey(new Date().getHours())}`, {
    name: displayName,
  })
  const openTodoCount = todos.filter((todo) => todo.done === 0).length
  const now = new Date()
  const dateText = now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
  const weekdayText = now.toLocaleDateString(locale, { weekday: 'long' })

  const onboardingSteps: Array<{ id: OnboardingStepId; title: string; description: string }> = [
    {
      id: 'organize-note',
      title: t('onboarding.steps.organizeNote.title'),
      description: t('onboarding.steps.organizeNote.desc'),
    },
    {
      id: 'ai-polish',
      title: t('onboarding.steps.aiPolish.title'),
      description: t('onboarding.steps.aiPolish.desc'),
    },
  ]
  const completedStep = onboardingSteps.find((step) => step.id === completedOnboardingStep) || null
  const nextOnboardingStepId = getNextOnboardingStep(onboardingProgress, completedOnboardingStep)
  const hasPendingNextStep = getActiveOnboardingStep(onboardingProgress) !== null
  const currentOnboardingStep = onboardingSteps.find((step) => step.id === activeOnboardingStep)
    || onboardingSteps.find((step) => step.id === nextOnboardingStepId)
    || null
  const currentOnboardingIndex = currentOnboardingStep
    ? onboardingSteps.findIndex((step) => step.id === currentOnboardingStep.id)
    : -1
  const completedOnboardingIndex = completedStep
    ? onboardingSteps.findIndex((step) => step.id === completedStep.id)
    : -1
  const showCompletedCard = Boolean(completedStep && hasPendingNextStep)
  const showOnboardingCard = !onboardingProgress.dismissed && (showCompletedCard || Boolean(currentOnboardingStep))

  return (
    <div className="h-full flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[960px] px-8 pb-10 pt-[26px]">
        {/* 欢迎条：问候语 + 本周概览 + 日期（替代原大 logo hero） */}
        <section className="paper-welcome mb-4 flex items-center gap-4 rounded-lg border bg-card px-6 py-[18px]">
          <div className="min-w-0">
            <h2 className="paper-welcome-greeting text-[17px] font-semibold">{greeting}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {tHome('weeklyOverview', { visits: weeklyVisitCount, todos: openTodoCount })}
            </p>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <div className="paper-welcome-date text-[13px] font-medium">{dateText}</div>
            <div className="mt-0.5 text-xs text-muted-foreground/70">{weekdayText}</div>
          </div>
        </section>

        {/* 快速操作：四卡横排（paper 主题下经 CSS counter 转为 01–04 编号目录列表） */}
        <div className="paper-quick-list mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {quickActions.map((action) => (
            <button
              key={action.key}
              onClick={action.onClick}
              className="paper-quick-row flex items-center gap-3 rounded-lg border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/30 hover:bg-accent/40"
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  action.brand ? "bg-brand/10 text-brand" : "bg-accent text-accent-foreground"
                )}
              >
                {action.icon}
              </span>
              <span className="min-w-0">
                <span className="paper-quick-title block truncate text-[13px] font-medium">{action.title}</span>
                <span className="paper-quick-desc mt-0.5 block truncate text-xs text-muted-foreground/70">{action.description}</span>
              </span>
              {action.shortcut && (
                <kbd className="ml-auto hidden shrink-0 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground/70 md:inline-flex">
                  {action.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>

        {/* 新手引导：保留原逻辑，视觉收敛为普通卡片 */}
        {showOnboardingCard && (
          <section className="mb-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{t('onboarding.title')}</h3>
                <p className="text-xs text-muted-foreground">{t('onboarding.subtitle')}</p>
              </div>
              <button
                onClick={() => void onDismissOnboarding()}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('onboarding.dismiss')}
              </button>
            </div>

            {showCompletedCard && completedStep ? (
              <div className="mt-3 rounded-md border border-success/40 bg-success/5 p-3.5 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-success/80">
                      {t('onboarding.stepCompletedLabel', { current: completedOnboardingIndex + 1, total: onboardingSteps.length })}
                    </p>
                    <h4 className="text-sm font-medium text-success">
                      {t(`onboarding.completedStates.${completedStep.id}.title`)}
                    </h4>
                    <p className="text-xs text-success/80">
                      {t(`onboarding.completedStates.${completedStep.id}.desc`)}
                    </p>
                  </div>
                  <button
                    onClick={() => void onContinueToNextStep()}
                    className="shrink-0 rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-success"
                  >
                    {t('onboarding.continue')}
                  </button>
                </div>
              </div>
            ) : currentOnboardingStep ? (
              <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3.5 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('onboarding.stepLabel', { current: currentOnboardingIndex + 1, total: onboardingSteps.length })}
                    </p>
                    <h4 className="text-sm font-medium">{currentOnboardingStep.title}</h4>
                    <p className="text-xs text-muted-foreground">{currentOnboardingStep.description}</p>
                  </div>
                  <button
                    onClick={() => void onStartOnboardingStep(currentOnboardingStep.id)}
                    className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
                  >
                    {visibleOnboardingStep === currentOnboardingStep.id ? t('onboarding.viewHint') : t('onboarding.start')}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* 最近编辑 */}
        <section className="paper-sec rounded-lg border bg-card">
          <header className="flex items-center gap-2 border-b px-[18px] py-[13px]">
            <Clock className="h-[15px] w-[15px] text-primary" />
            <h3 className="text-sm font-semibold">{tHome('recent.title')}</h3>
            <span className="ml-auto text-xs font-normal text-muted-foreground/70">{tHome('recent.sortHint')}</span>
          </header>
          {recentItems.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-[22px] text-[13px] text-muted-foreground/70">
              <FileText className="h-4 w-4" />
              {tHome('recent.empty')}
            </div>
          ) : (
            recentItems.map((item) => {
              const timeText = formatRecentTime(item.modifiedAt, tHome('recent.today'), locale)
              return (
                <button
                  key={item.path}
                  onClick={() => setActiveFilePath(item.path)}
                  className="flex w-full items-center gap-3 border-b px-[18px] py-[11px] text-left transition-colors last:border-b-0 hover:bg-accent/40"
                >
                  <FileText className="h-[15px] w-[15px] shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {firstLineTitles[item.path] || stripNoteExtension(item.name)}
                  </span>
                  {timeText && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">
                      {timeText}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}
