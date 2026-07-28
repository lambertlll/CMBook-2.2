'use client'

import { MessageSquare, Highlighter, SquarePen, Settings, User, Plus, Square, Folder, RefreshCw } from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'
import { cn } from "@/lib/utils"
import { Store } from "@tauri-apps/plugin-store"
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { UserInfo } from "@/lib/sync/github.types"
import { getUserInfo } from "@/lib/sync/github"
import { useEffect, useRef, useState } from "react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import { MobileRecordTools } from '@/components/mobile-record-tools'
import { OrganizeNotes } from "@/app/core/main/mark/organize-notes"
import {
  InteractiveMenu,
  type InteractiveMenuItem,
} from '@/components/ui/modern-mobile-menu'
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'
import useRecordingStore from "@/stores/recording"
import emitter from "@/lib/emitter"

type MobileSyncIndicator = 'none' | 'syncing' | 'warning' | 'attention'

type FootbarItem = InteractiveMenuItem & {
  url: string
  isQuickRecord?: boolean
}

function getSyncIndicatorClassName(indicator: MobileSyncIndicator) {
  switch (indicator) {
    case 'attention':
      return 'bg-destructive'
    case 'warning':
      return 'bg-warning'
    case 'syncing':
      return 'bg-primary animate-pulse'
    case 'none':
    default:
      return ''
  }
}

function SyncIndicator({ indicator }: { indicator: MobileSyncIndicator }) {
  if (indicator === 'none') {
    return null
  }

  return (
    <span
      className={cn(
        'absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-[hsl(var(--component-active-bg))]',
        getSyncIndicatorClassName(indicator)
      )}
    />
  )
}

function ProfileAvatarIcon({ avatarUrl }: { avatarUrl: string }) {
  return (
    <Avatar className="size-5">
      <AvatarImage
        src={avatarUrl}
        alt="Profile"
      />
      <AvatarFallback>
        <User className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  )
}

function RecordingDockIcon() {
  return (
    <span className="inline-flex size-5 items-center justify-center text-danger">
      <Square className="size-4 animate-pulse fill-current" />
    </span>
  )
}

function formatRecordingDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getMobileSyncIndicator(
  autoDataSyncEnabled: boolean,
  autoDataSyncState: AutoDataSyncState
): MobileSyncIndicator {
  if (!autoDataSyncEnabled) {
    return 'none'
  }

  if (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict') {
    return 'attention'
  }

  if (autoDataSyncState.phase === 'waiting_provider') {
    return 'warning'
  }

  if (
    autoDataSyncState.isSyncing ||
    autoDataSyncState.phase === 'checking_remote' ||
    autoDataSyncState.phase === 'uploading' ||
    autoDataSyncState.phase === 'downloading'
  ) {
    return 'syncing'
  }

  return 'none'
}

export function AppFootbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [quickRecordOpen, setQuickRecordOpen] = useState(false)
  const [autoDataSyncState, setAutoDataSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())
  const organizeRef = useRef<{ openOrganize: () => void }>(null)
  const { isRecording, recordingDuration } = useRecordingStore()
  const { 
    githubUsername,
    accessToken,
    primaryBackupMethod,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
    autoDataSyncEnabled,
    setGithubUsername,
    setGitlabUsername,
    setGiteaUsername,
  } = useSettingStore()
  const {
    setUserInfo,
    setSyncRepoInfo,
    setGiteeSyncRepoInfo,
    setGitlabSyncProjectInfo,
    setGiteeUserInfo,
    setGitlabUserInfo,
    setGiteaSyncRepoInfo,
    setGiteaUserInfo,
    giteeUserInfo,
    gitlabUserInfo,
    giteaUserInfo,
  } = useSyncStore()
  const t = useTranslations()
  
  // 检查是否有 GitHub、Gitee、Gitlab 或 Gitea 账号，用于显示头像
  const hasGithubAccount = Boolean(githubUsername && accessToken)
  const hasGiteeAccount = Boolean(giteeAccessToken)
  const hasGitlabAccount = Boolean(gitlabAccessToken)
  const hasGiteaAccount = Boolean(giteaAccessToken)
  const showAvatar = hasGithubAccount || hasGiteeAccount || hasGitlabAccount || hasGiteaAccount
  const syncIndicator = getMobileSyncIndicator(autoDataSyncEnabled, autoDataSyncState)

  // 获取当前主要备份方式的用户信息
  async function handleGetUserInfo() {
    try {
      if (primaryBackupMethod === 'github') {
        if (accessToken) {
          setSyncRepoInfo(undefined)
          const res = await getUserInfo()
          if (res) {
            setUserInfo(res.data as UserInfo)
            setGithubUsername(res.data.login)
          }
        }
      } else if (primaryBackupMethod === 'gitee') {
        if (giteeAccessToken) {
          // 获取 Gitee 用户信息
          setGiteeSyncRepoInfo(undefined)
          const res = await import('@/lib/sync/gitee').then(module => module.getUserInfo())
          if (res) {
            setGiteeUserInfo(res)
          }
        }
      } else if (primaryBackupMethod === 'gitlab') {
        if (gitlabAccessToken) {
          // 获取 Gitlab 用户信息
          setGitlabSyncProjectInfo(undefined)
          const { getUserInfo } = await import('@/lib/sync/gitlab')
          const res = await getUserInfo()
          if (res) {
            setGitlabUserInfo(res)
            setGitlabUsername(res.username)
          }
        }
      } else if (primaryBackupMethod === 'gitea') {
        if (giteaAccessToken) {
          // 获取 Gitea 用户信息
          setGiteaSyncRepoInfo(undefined)
          const { getUserInfo } = await import('@/lib/sync/gitea')
          const res = await getUserInfo()
          if (res) {
            setGiteaUserInfo(res)
            setGiteaUsername(res.username)
          }
        }
      } else {
        setUserInfo(undefined)
        setGiteeUserInfo(undefined)
        setGitlabUserInfo(undefined)
        setGiteaUserInfo(undefined)
      }
    } catch (err) {
      console.error('Failed to get user info:', err)
    }
  }
  
  // 根据主备份方式获取正确的头像地址
  const getAvatarUrl = () => {
    switch (primaryBackupMethod) {
      case 'github':
        if (hasGithubAccount && githubUsername) {
          return `https://github.com/${githubUsername}.png`
        }
        break
      case 'gitee':
        if (hasGiteeAccount && giteeUserInfo?.avatar_url) {
          return giteeUserInfo.avatar_url
        }
        break
      case 'gitlab':
        if (hasGitlabAccount && gitlabUserInfo?.avatar_url) {
          return gitlabUserInfo.avatar_url
        }
        break
      case 'gitea':
        if (hasGiteaAccount && giteaUserInfo?.avatar_url) {
          return giteaUserInfo.avatar_url
        }
        break
      default:
        return ''
    }
    return ''
  }

  const avatarUrl = getAvatarUrl()
    
  // 底部导航菜单项
  const items: FootbarItem[] = [
    {
      id: 'chat',
      label: t('navigation.mobileDock.chat'),
      url: "/mobile/chat",
      icon: MessageSquare,
    },
    {
      id: 'record',
      label: t('navigation.mobileDock.record'),
      url: "/mobile/record",
      icon: Highlighter,
    },
    {
      id: 'quick-record',
      label: isRecording ? formatRecordingDuration(recordingDuration) : t('navigation.mobileDock.quickRecord'),
      url: "#quick-record",
      icon: Plus,
      iconElement: isRecording ? <RecordingDockIcon /> : undefined,
      isQuickRecord: true,
    },
    {
      id: 'writing',
      label: t('navigation.mobileDock.write'),
      url: "/mobile/writing",
      icon: SquarePen,
    },
    {
      id: 'setting',
      label: t('navigation.mobileDock.me'),
      url: "/mobile/setting",
      icon: Settings,
      iconElement: showAvatar && avatarUrl ? <ProfileAvatarIcon avatarUrl={avatarUrl} /> : undefined,
      indicator: <SyncIndicator indicator={syncIndicator} />,
    },
  ]

  const routeActiveIndex = items.findIndex(item => pathname === item.url)
  const quickRecordIndex = items.findIndex(item => item.isQuickRecord)
  const activeIndex =
    (isRecording || quickRecordOpen) && quickRecordIndex >= 0 ? quickRecordIndex : Math.max(routeActiveIndex, 0)

  // 处理导航点击事件
  async function menuHandler(item: FootbarItem) {
    if (item.isQuickRecord) {
      if (isRecording) {
        setQuickRecordOpen(false)
        emitter.emit('toolbar-shortcut-recording')
        return
      }

      // 快捷记录按钮：打开浮动弹窗
      setQuickRecordOpen(open => !open)
      return
    }
    
    setQuickRecordOpen(false)
    router.push(item.url)
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
  }

  const handleMobileOrganize = () => {
    setQuickRecordOpen(false)
    window.requestAnimationFrame(() => {
      organizeRef.current?.openOrganize()
    })
  }

  useEffect(() => {
    if (accessToken || giteeAccessToken || gitlabAccessToken || giteaAccessToken) {
      handleGetUserInfo()
    }
  }, [accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, primaryBackupMethod])

  useEffect(() => subscribeAutoDataSyncState(setAutoDataSyncState), [])

  return (
    <div className="flex h-full w-full items-center justify-center px-2 min-[380px]:px-3">
      <Popover open={quickRecordOpen} onOpenChange={setQuickRecordOpen}>
        <PopoverAnchor asChild>
          <InteractiveMenu
            accentColor={isRecording ? "rgb(239 68 68)" : undefined}
            activeIndex={activeIndex}
            aria-label={t('navigation.navigate')}
            className="w-full"
            items={items}
            onActiveIndexChange={(index) => {
              const item = items[index]
              if (item) {
                menuHandler(item)
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="center"
          side="top"
          sideOffset={10}
          collisionPadding={12}
          className="origin-bottom w-[min(92vw,360px)] rounded-[1.35rem] border-border/60 bg-background/70 p-2 text-foreground shadow-[0_18px_48px_rgb(0_0_0/0.18)] backdrop-blur-xl will-change-[transform,opacity] supports-[backdrop-filter]:bg-background/60 data-[state=open]:duration-[220ms] data-[state=closed]:duration-150 data-[state=open]:ease-out data-[state=closed]:ease-in data-[state=closed]:slide-out-to-bottom-2 dark:shadow-[0_22px_54px_rgb(0_0_0/0.36)]"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <MobileRecordTools
            onClose={() => setQuickRecordOpen(false)}
            onOrganize={handleMobileOrganize}
          />
        </PopoverContent>
      </Popover>
      <OrganizeNotes ref={organizeRef} />
    </div>
  )
}

// ==================== 桌面端底部状态栏（2.1 全局框架） ====================

type DesktopSyncStatus = 'synced' | 'syncing' | 'failed' | 'waiting' | 'disabled'

// 同步状态映射：复用自动同步队列状态，规则与移动端指示点一致
function getDesktopSyncStatus(
  autoDataSyncEnabled: boolean,
  autoDataSyncState: AutoDataSyncState
): DesktopSyncStatus {
  if (!autoDataSyncEnabled) {
    return 'disabled'
  }
  if (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict') {
    return 'failed'
  }
  if (autoDataSyncState.phase === 'waiting_provider') {
    return 'waiting'
  }
  if (
    autoDataSyncState.isSyncing ||
    autoDataSyncState.phase === 'checking_remote' ||
    autoDataSyncState.phase === 'uploading' ||
    autoDataSyncState.phase === 'downloading'
  ) {
    return 'syncing'
  }
  return 'synced'
}

// 由 primaryModel 反查所属 AI 配置的用户友好槽位名（title），匹配规则与 lib/ai/utils.getAISettings 一致
function resolvePrimaryModelSlotTitle(aiModelList: { key: string; title: string; models?: { id: string }[] }[], primaryModel: string): string {
  if (!primaryModel) return ''
  for (const config of aiModelList) {
    if (config.models && config.models.length > 0) {
      let targetModel = config.models.find((model) => model.id === primaryModel)
      if (!targetModel && primaryModel.startsWith(`${config.key}-`)) {
        const originalModelId = primaryModel.substring(config.key.length + 1)
        targetModel = config.models.find((model) => model.id === originalModelId)
      }
      if (targetModel) return config.title
    } else if (config.key === primaryModel) {
      return config.title
    }
  }
  return ''
}

/**
 * 桌面端底部状态栏：左侧工作区名 + 同步状态，右侧会议纪要模型状态（友好名，禁止技术型号）
 */
export function AppStatusBar() {
  const t = useTranslations()
  const workspacePath = useSettingStore((s) => s.workspacePath)
  const autoDataSyncEnabled = useSettingStore((s) => s.autoDataSyncEnabled)
  const primaryModel = useSettingStore((s) => s.primaryModel)
  const aiModelList = useSettingStore((s) => s.aiModelList)
  const [autoDataSyncState, setAutoDataSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())

  useEffect(() => subscribeAutoDataSyncState(setAutoDataSyncState), [])

  // 工作区显示名：自定义工作区取目录名，默认工作区显示友好占位名
  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath
    : t('navigation.statusBar.defaultWorkspace')

  const syncStatus = getDesktopSyncStatus(autoDataSyncEnabled, autoDataSyncState)
  const syncText = t(`navigation.statusBar.${syncStatus === 'failed' ? 'syncFailed' : syncStatus === 'waiting' ? 'syncWaiting' : syncStatus === 'syncing' ? 'syncing' : syncStatus === 'disabled' ? 'syncDisabled' : 'synced'}`)
  const syncTextClass =
    syncStatus === 'failed' ? 'text-danger' : syncStatus === 'waiting' ? 'text-warning' : ''

  // 模型状态：友好名「会议纪要模型」+ 槽位显示名；未配置时提示未配置
  const modelSlotTitle = resolvePrimaryModelSlotTitle(aiModelList, primaryModel)
  const modelReady = Boolean(modelSlotTitle)

  return (
    <footer className="flex h-[30px] w-full shrink-0 items-center gap-3.5 border-t bg-background px-3.5 text-xs text-muted-foreground select-none">
      <span className="flex items-center gap-1.5 truncate">
        <Folder className="size-3 shrink-0" />
        <span className="truncate">{workspaceName}</span>
      </span>
      <span className={cn('flex items-center gap-1.5 shrink-0', syncTextClass)}>
        <RefreshCw className={cn('size-3 shrink-0', syncStatus === 'syncing' && 'animate-spin')} />
        {syncText}
      </span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <span className={cn('size-[7px] rounded-full', modelReady ? 'bg-success' : 'bg-warning')} />
        {t('navigation.statusBar.meetingSummaryModel')} · {modelReady ? modelSlotTitle : t('navigation.statusBar.modelNotConfigured')}
      </span>
    </footer>
  )
}
