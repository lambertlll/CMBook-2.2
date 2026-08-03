'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { debounce } from 'lodash-es'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Building2, File, FolderTree, Mic, NotebookPen, SearchX, Tags } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import useArticleStore from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { useSidebarStore } from '@/stores/sidebar'
import { useMeetingStore } from '@/app/core/main/meeting/meeting-store'
import { useCustomerStore } from '@/app/core/main/customer/customer-store'
import { searchMeetings, type MeetingSearchResult } from '@/db/meetings'
import { usePathname, useRouter } from 'next/navigation'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import { search, type SearchableItem } from '@/lib/search-utils'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SearchFilter = 'all' | 'record' | 'article'

interface EnhancedSearchResult {
  id: string
  markId?: number
  path?: string
  article?: string
  content?: string
  desc?: string
  title: string
  searchType: 'article' | 'record'
  tagId?: number
  tagName?: string
  type?: string
  url?: string
  highlightText: string
  score: number
  firstMatchIndex?: number
}

// 客户内存搜索结果（名称/行业/备注匹配）
interface CustomerSearchResult {
  id: string
  name: string
  type: string // enterprise | individual
  industry: string
  matchSource: 'name' | 'industry' | 'profile'
  snippet: string // 备注命中时的上下文片段
}

// 会议状态 → meeting 命名空间文案键（与会议列表 StatusBadge 保持一致）
const MEETING_STATUS_KEYS: Record<string, string> = {
  idle: 'meeting.statusIdle',
  recording: 'meeting.statusRecording',
  paused: 'meeting.statusPaused',
  transcribing: 'meeting.statusTranscribing',
  generating: 'meeting.statusGenerating',
  completed: 'meeting.statusCompleted',
}

/**
 * 从文本中截取关键词前后约 radius*2 字的上下文片段（无法定位时取开头）
 */
function extractSnippet(text: string, query: string, radius = 30): string {
  if (!text) return ''
  const q = query.trim().toLowerCase()
  const idx = q ? text.toLowerCase().indexOf(q) : -1
  if (idx === -1) return text.slice(0, radius * 2)
  const start = Math.max(idx - radius, 0)
  const end = Math.min(start + radius * 2, text.length)
  return `${start > 0 ? '…' : ''}${text.substring(start, end)}${end < text.length ? '…' : ''}`
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<EnhancedSearchResult[]>([])
  const [meetingResults, setMeetingResults] = useState<MeetingSearchResult[]>([])
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all')
  const { allArticle, loadAllArticle, setActiveFilePath, setMatchPosition, setPendingSearchKeyword, setCollapsibleList } = useArticleStore()
  const { allMarks, fetchAllMarks, setPendingScrollMarkId } = useMarkStore()
  const { tags, fetchTags, setCurrentTagId } = useTagStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const customers = useCustomerStore((s) => s.customers)
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const isMobileRoute = pathname.startsWith('/mobile')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // 异步搜索序号：丢弃过期的会议查询结果，避免慢查询覆盖新结果
  const searchSeqRef = useRef(0)

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  // 会议结果日期（与会议列表一致：当年显示月日，跨年显示年月日）
  function formatMeetingDate(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  // 高亮搜索关键词
  function highlightText(text: string, query: string) {
    if (!query.trim() || !text) return text
    
    const parts: React.ReactNode[] = []
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase().trim()
    
    let lastIndex = 0
    let index = lowerText.indexOf(lowerQuery)
    
    while (index !== -1) {
      // 添加匹配前的文本
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index))
      }
      
      // 添加高亮的匹配文本
      parts.push(
        <mark key={index} className="bg-warning/40 dark:bg-warning/30 text-foreground px-0.5 rounded">
          {text.substring(index, index + lowerQuery.length)}
        </mark>
      )
      
      lastIndex = index + lowerQuery.length
      index = lowerText.indexOf(lowerQuery, lastIndex)
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    
    return <>{parts}</>
  }

  function getResultMeta(item: EnhancedSearchResult) {
    if (item.searchType === 'record') {
      return {
        icon: Tags,
        primary: item.tagName || t('search.item.record'),
        secondary: item.type || null,
      }
    }

    return {
      icon: FolderTree,
      primary: item.path || t('search.item.article'),
      secondary: null,
    }
  }

  function getResultTone(item: EnhancedSearchResult) {
    return item.searchType === 'record'
      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20'
      : 'bg-warning/10 text-warning border-warning/20'
  }

  const performSearch = useCallback(async (value: string) => {
    const seq = ++searchSeqRef.current
    if (!value.trim()) {
      setSearchResult([])
      setMeetingResults([])
      return
    }

    // 构建文章搜索项
    const articleItems: SearchableItem[] = allArticle.map((item, index) => ({
      id: `article-${index}-${item.path?.replace(/[^a-zA-Z0-9]/g, '-')}`,
      title: extractTitleFromPath(item.path || ''),
      content: item.article || '',
      metadata: {
        path: item.path,
        article: item.article,
        searchType: 'article'
      }
    }))

    // 准备记录搜索数据
    const markItems: SearchableItem[] = allMarks.map((item, index) => {
      const tag = tags.find(tag => tag.id === item.tagId)
      return {
        id: `mark-${index}-${item.id}`,
        title: item.desc || item.content?.slice(0, 50) || '',
        content: `${item.content || ''} ${item.desc || ''} ${tag?.name || ''}`,
        metadata: {
          markId: item.id,
          content: item.content,
          desc: item.desc,
          tagName: tag?.name,
          tagId: item.tagId,
          type: item.type,
          url: item.url,
          searchType: 'record'
        }
      }
    })

    // 合并所有搜索项
    const allItems = [...articleItems, ...markItems]

    // 执行搜索（自动合并精确和模糊结果）
    const searchResults = search(allItems, value, {
      maxResults: 50
    })

    // 转换为组件需要的格式
    const results: EnhancedSearchResult[] = searchResults.map(result => {
      const metadata = result.item.metadata || {}
      const firstMatch = result.matches[0]

      return {
        id: result.item.id,
        title: result.item.title,
        searchType: metadata.searchType as 'article' | 'record',
        highlightText: result.highlightText,
        score: result.score,
        firstMatchIndex: firstMatch?.index,
        // 文章特定字段
        path: metadata.path,
        article: metadata.article,
        // 记录特定字段
        markId: metadata.markId,
        content: metadata.content,
        desc: metadata.desc,
        tagName: metadata.tagName,
        tagId: metadata.tagId,
        type: metadata.type,
        url: metadata.url
      }
    })

    if (seq !== searchSeqRef.current) return
    setSearchResult(results)

    // 会议：SQLite LIKE 搜索（标题优先，其次纪要内容）；移动端无会议页，跳过
    if (isMobileRoute) {
      setMeetingResults([])
      return
    }
    try {
      const meetings = await searchMeetings(value)
      if (seq !== searchSeqRef.current) return
      setMeetingResults(meetings)
    } catch (err) {
      console.error('[SearchDialog] 会议搜索失败:', err)
      if (seq === searchSeqRef.current) setMeetingResults([])
    }
  }, [allArticle, allMarks, tags, isMobileRoute])

  // 防抖搜索，300ms 延迟
  const debouncedSearch = useMemo(
    () => debounce(performSearch, 300),
    [performSearch]
  )

  const filteredSearchResult = useMemo(() => {
    if (searchFilter === 'all') {
      return searchResult
    }
    return searchResult.filter((item) => item.searchType === searchFilter)
  }, [searchFilter, searchResult])

  // 客户：内存过滤（名称/行业/备注），名称命中优先；移动端无客户页，跳过
  const customerResults = useMemo<CustomerSearchResult[]>(() => {
    const q = searchValue.trim().toLowerCase()
    if (!q || isMobileRoute) return []
    const matched: CustomerSearchResult[] = []
    for (const c of customers) {
      const name = c.name || ''
      const industry = c.industry || ''
      const profile = c.profile || ''
      let matchSource: CustomerSearchResult['matchSource'] | null = null
      if (name.toLowerCase().includes(q)) matchSource = 'name'
      else if (industry.toLowerCase().includes(q)) matchSource = 'industry'
      else if (profile.toLowerCase().includes(q)) matchSource = 'profile'
      if (!matchSource) continue
      matched.push({
        id: c.id,
        name,
        type: c.type,
        industry,
        matchSource,
        snippet: matchSource === 'profile' ? extractSnippet(profile, q) : '',
      })
      if (matched.length >= 20) break
    }
    return matched
  }, [customers, searchValue, isMobileRoute])

  // 结果总数（笔记组按筛选器过滤后 + 会议 + 客户）
  const totalResultCount =
    filteredSearchResult.length + meetingResults.length + customerResults.length

  // 跳转会议：切换到会议 Tab 并激活目标会议
  async function handleSelectMeeting(meeting: MeetingSearchResult) {
    onOpenChange(false)
    await setLeftSidebarTab('meeting')
    const meetingStore = useMeetingStore.getState()
    // 会议列表未加载时先加载，否则 setActiveMeeting 找不到列表项
    if (!meetingStore.initialized) {
      await meetingStore.loadMeetings()
    }
    useMeetingStore.getState().setActiveMeeting(meeting.id)
    if (!pathname.startsWith('/core/main')) {
      router.push('/core/main')
    }
  }

  // 跳转客户：切换到客户 Tab 并选中目标客户
  async function handleSelectCustomer(customer: CustomerSearchResult) {
    onOpenChange(false)
    await setLeftSidebarTab('customer')
    useCustomerStore.getState().selectCustomer(customer.id)
    if (!pathname.startsWith('/core/main')) {
      router.push('/core/main')
    }
  }

  async function handleSelect(item: EnhancedSearchResult) {
    // 如果是记录类型，跳转到记录页面并设置对应的 tag
    if (item.searchType === 'record') {
      onOpenChange(false)
      setPendingSearchKeyword('')
      setMatchPosition(null)
      setPendingScrollMarkId(item.markId ?? null)

      if (item.tagId) {
        await setCurrentTagId(item.tagId)
      }

      if (!isMobileRoute) {
        // PC 端：原切换到记录标签页；「记录」Tab 已移除，兜底回笔记 Tab
        await setLeftSidebarTab('files')
      } else {
        // 移动端路由已移除（/mobile/record 不存在），兜底回笔记 Tab
        await setLeftSidebarTab('files')
      }

      emitter.emit(EmitterRecordEvents.refreshMarks)

      return
    }
    
    onOpenChange(false)
    setPendingScrollMarkId(null)

    // PC 端切换到笔记标签页；移动端直接跳转写作页
    if (!isMobileRoute) {
      await setLeftSidebarTab('files')
    }
    
    // 如果是文章类型，跳转到文章页面
    if (item.firstMatchIndex !== undefined) {
      setMatchPosition(item.firstMatchIndex)
    }
    setPendingSearchKeyword(searchValue.trim())
    
    const filePath = item.path as string
    
    const setupAndNavigate = async () => {
      // 展开文件夹路径
      const pathParts = filePath.split('/')
      pathParts.pop()
      
      let currentPath = ''
      for (const part of pathParts) {
        if (currentPath) {
          currentPath += '/' + part
        } else {
          currentPath = part
        }
        
        if (currentPath) {
          await setCollapsibleList(currentPath, true)
        }
      }
      
      // 设置活动文件路径
      await setActiveFilePath(filePath)
      
      // 读取文件内容
      const { readArticle } = useArticleStore.getState()
      await readArticle(filePath)
      
      // 跳转到主界面（移动端路由已移除，PC/窄窗口统一回主界面）
      router.push('/core/main')
    }
    
    setupAndNavigate()
  }

  useEffect(() => {
    if (open) {
      loadAllArticle()
      fetchAllMarks()
      fetchTags()
      // 客户走内存过滤，首次打开时加载到内存
      if (!customersInitialized) {
        void loadCustomers()
      }
    }
  }, [open])

  useEffect(() => {
    const loadSearchFilter = async () => {
      const store = await Store.load('store.json')
      const savedFilter = await store.get<SearchFilter>('globalSearchFilter')
      if (savedFilter === 'all' || savedFilter === 'record' || savedFilter === 'article') {
        setSearchFilter(savedFilter)
      }
    }

    loadSearchFilter()
  }, [])

  useEffect(() => {
    const persistSearchFilter = async () => {
      const store = await Store.load('store.json')
      await store.set('globalSearchFilter', searchFilter)
    }

    persistSearchFilter()
  }, [searchFilter])

  useEffect(() => {
    debouncedSearch(searchValue)
  }, [searchValue, debouncedSearch])

  useEffect(() => {
    if (!open || isMobileRoute) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 60)
    return () => clearTimeout(timer)
  }, [open, isMobileRoute])

  const handleDrawerAnimationEnd = useCallback((drawerOpen: boolean) => {
    if (!drawerOpen) return

    searchInputRef.current?.focus()
  }, [])

  const searchContent = (
    <>
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <CommandInput
            ref={searchInputRef}
            autoFocus={!isMobileRoute}
            placeholder={t('search.placeholder')}
            value={searchValue}
            onValueChange={setSearchValue}
            className="h-10 text-base font-medium"
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-sm font-semibold tracking-tight text-foreground/90">
            {t('search.results', { count: totalResultCount })}
          </div>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 p-1">
            <Button
              type="button"
              variant={searchFilter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('all')}
            >
              {t('common.all')}
            </Button>
            <Button
              type="button"
              variant={searchFilter === 'record' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('record')}
            >
              {t('search.item.record')}
            </Button>
            <Button
              type="button"
              variant={searchFilter === 'article' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSearchFilter('article')}
            >
              {t('search.item.article')}
            </Button>
          </div>
        </div>
      </div>
      <CommandList className={isMobileRoute ? "h-[64vh] max-h-[64vh]" : "min-h-0 flex-1 max-h-none"}>
        {!searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.placeholder')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {totalResultCount === 0 && searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.noResultsAll')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {filteredSearchResult.length > 0 && (
          <CommandGroup
            heading={
              <span className="flex items-center gap-2">
                <NotebookPen className="size-4" />
                <span>{t('search.group.notes')}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {filteredSearchResult.length}
                </span>
              </span>
            }
          >
            <div className="flex flex-col divide-y divide-border/60">
              {filteredSearchResult.map((item) => {
              const resultMeta = getResultMeta(item)
              const MetaIcon = resultMeta.icon
              return (
                <CommandItem
                  key={item.id}
                  value={`${item.searchType}-${item.title || item.path}`}
                  onSelect={() => handleSelect(item)}
                  className={cn(
                    isMobileRoute
                      ? "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                      : "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                  )}
                >
                  {isMobileRoute ? (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {item.title ? (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightText(item.title, searchValue)}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[120px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {highlightText(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              {item.title && (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightText(item.title, searchValue)}
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[180px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                            {highlightText(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CommandItem>
              )
            })}
            </div>
          </CommandGroup>
        )}
        {meetingResults.length > 0 && (
          <CommandGroup
            heading={
              <span className="flex items-center gap-2">
                <Mic className="size-4" />
                <span>{t('search.group.meetings')}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {meetingResults.length}
                </span>
              </span>
            }
          >
            <div className="flex flex-col divide-y divide-border/60">
              {meetingResults.map((meeting) => (
                <CommandItem
                  key={meeting.id}
                  value={`meeting-${meeting.id}-${meeting.title}`}
                  onSelect={() => handleSelectMeeting(meeting)}
                  className="group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                >
                  <div className="w-full py-3">
                    <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                        <Mic className="size-3.5" />
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <div className="flex min-w-0 items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                              {highlightText(meeting.title || t('meeting.untitledMeeting'), searchValue)}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px]">
                              {t(MEETING_STATUS_KEYS[meeting.status] ?? 'meeting.statusIdle')}
                            </Badge>
                            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px]">
                              {meeting.matchSource === 'title'
                                ? t('search.match.title')
                                : t('search.match.summary')}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {formatMeetingDate(meeting.createdAt)}
                            </span>
                          </div>
                        </div>

                        {meeting.matchSource === 'summary' && meeting.snippet ? (
                          <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                            {highlightText(meeting.snippet, searchValue)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </div>
          </CommandGroup>
        )}
        {customerResults.length > 0 && (
          <CommandGroup
            heading={
              <span className="flex items-center gap-2">
                <Building2 className="size-4" />
                <span>{t('search.group.customers')}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {customerResults.length}
                </span>
              </span>
            }
          >
            <div className="flex flex-col divide-y divide-border/60">
              {customerResults.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={`customer-${customer.id}-${customer.name}`}
                  onSelect={() => handleSelectCustomer(customer)}
                  className="group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                >
                  <div className="w-full py-3">
                    <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                        <Building2 className="size-3.5" />
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <div className="flex min-w-0 items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                              {highlightText(customer.name, searchValue)}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px]">
                              {customer.type === 'individual'
                                ? t('customer.typeIndividual')
                                : t('customer.typeEnterprise')}
                            </Badge>
                            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px]">
                              {customer.matchSource === 'name'
                                ? t('search.match.name')
                                : customer.matchSource === 'industry'
                                  ? t('search.match.industry')
                                  : t('search.match.profile')}
                            </Badge>
                          </div>
                        </div>

                        {customer.matchSource === 'profile' && customer.snippet ? (
                          <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                            {highlightText(customer.snippet, searchValue)}
                          </div>
                        ) : customer.industry ? (
                          <div className="truncate text-[12px] leading-5 text-muted-foreground">
                            {highlightText(customer.industry, searchValue)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </div>
          </CommandGroup>
        )}
      </CommandList>
    </>
  )

  if (isMobileRoute) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} onAnimationEnd={handleDrawerAnimationEnd}>
        <DrawerContent className="h-[88vh] rounded-t-[28px] border-border/70 bg-background p-0 shadow-2xl">
          <div className="min-h-0 flex-1 px-3 pb-3 pt-3">
        <Command
          shouldFilter={false}
          className={cn(
            "h-full rounded-[22px] border border-border/70 bg-background shadow-sm",
            "[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
                "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
                "[&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
                "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
                "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2 [&_[cmdk-item]]:rounded-2xl [&_[cmdk-item]]:px-0 [&_[cmdk-item]]:py-0"
              )}
            >
              {searchContent}
            </Command>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="h-[56vh] max-h-[56vh] max-w-4xl overflow-hidden border-border/70 bg-background p-0 shadow-2xl">
        <DialogTitle className="sr-only">{t('search.placeholder')}</DialogTitle>
        <Command
          shouldFilter={false}
          className={cn(
            "h-full bg-transparent",
            "[&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-base [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
            "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
            "[&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
            "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
            "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2"
          )}
        >
          {searchContent}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
