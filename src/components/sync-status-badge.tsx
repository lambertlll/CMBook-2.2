'use client'

import * as React from 'react'
import { CheckCircle2, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Loader2, CloudOff } from 'lucide-react'
import { Badge, BadgeProps } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSyncManager } from '@/hooks/use-sync-manager'
import { cn } from '@/lib/utils'

export type SyncStatusType = 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown' | 'syncing' | 'offline'

interface SyncStatusBadgeProps {
  path?: string
  showLabel?: boolean
  className?: string
  badgeProps?: BadgeProps
}

export function SyncStatusBadge({ path, showLabel = false, className, badgeProps }: SyncStatusBadgeProps) {
  const { status, lastSyncTime, isPending, checkStatus } = useSyncManager(path)
  const [isLoading, setIsLoading] = React.useState(false)

  const refreshStatus = async () => {
    if (!path) return
    setIsLoading(true)
    try {
      await checkStatus(path)
    } finally {
      setIsLoading(false)
    }
  }

  const statusConfig = {
    synced: {
      icon: CheckCircle2,
      label: '已同步',
      color: 'bg-success/10 text-success hover:bg-success/10',
      iconColor: 'text-success',
    },
    local_newer: {
      icon: ArrowUpCircle,
      label: '待推送',
      color: 'bg-accent text-primary hover:bg-accent',
      iconColor: 'text-primary',
    },
    remote_newer: {
      icon: ArrowDownCircle,
      label: '有更新',
      color: 'bg-warning/10 text-warning hover:bg-warning/10',
      iconColor: 'text-warning',
    },
    conflict: {
      icon: AlertTriangle,
      label: '冲突',
      color: 'bg-danger/10 text-danger hover:bg-danger/10',
      iconColor: 'text-danger',
    },
    unknown: {
      icon: CloudOff,
      label: '未同步',
      color: 'bg-muted text-foreground hover:bg-muted',
      iconColor: 'text-muted-foreground',
    },
    syncing: {
      icon: Loader2,
      label: '同步中',
      color: 'bg-accent text-primary',
      iconColor: 'text-primary animate-spin',
    },
    offline: {
      icon: CloudOff,
      label: '离线',
      color: 'bg-muted text-foreground',
      iconColor: 'text-muted-foreground',
    },
  }

  const currentStatus = status === 'syncing' ? 'syncing' : status || 'unknown'
  const config = statusConfig[currentStatus]
  const Icon = config.icon

  const formatLastSyncTime = () => {
    if (!lastSyncTime) return '暂无同步记录'
    const date = new Date(lastSyncTime)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return '刚刚同步'
    if (diffMins < 60) return `${diffMins} 分钟前`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`
    return date.toLocaleDateString('zh-CN')
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'gap-1.5 cursor-pointer',
            config.color,
            className
          )}
          onClick={refreshStatus}
          {...badgeProps}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className={cn('h-3.5 w-3.5', config.iconColor, status === 'syncing' && 'animate-spin')} />
          )}
          {showLabel && <span className="text-xs font-medium">{config.label}</span>}
          {isPending && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{config.label}</p>
          {path && <p className="text-xs text-muted-foreground truncate">{path}</p>}
          <p className="text-xs text-muted-foreground">{formatLastSyncTime()}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// 简化版本，只显示图标
export function SyncStatusIcon({ path, className }: { path?: string; className?: string }) {
  return <SyncStatusBadge path={path} showLabel={false} className={className} />
}

// 带标签的版本
export function SyncStatusLabel({ path, className }: { path?: string; className?: string }) {
  return <SyncStatusBadge path={path} showLabel={true} className={className} />
}
