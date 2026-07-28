'use client'

import { ArrowUpCircle, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useSyncStore from '@/stores/sync'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import emitter from '@/lib/emitter'
import { setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { debugSyncPerf } from '@/lib/sync/remote-file'
import { generateGitSyncCommitMessage } from '@/lib/sync/commit-message'
import type { S3Config, WebDAVConfig } from '@/types/sync'

type SyncProvider = 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function getNestedString(value: unknown, path: string[]) {
  let current: unknown = value

  for (const key of path) {
    const record = asRecord(current)
    if (!record) return undefined
    current = record[key]
  }

  return typeof current === 'string' && current.length > 0 ? current : undefined
}

function hasUploadData(result: unknown) {
  const record = asRecord(result)
  return Boolean(record && record.data)
}

function getRemoteFileSha(fileInfo: unknown) {
  const record = asRecord(fileInfo)
  const sha = record?.sha
  return typeof sha === 'string' && sha.length > 0 ? sha : undefined
}

function getUploadResultSha(result: unknown) {
  return (
    getNestedString(result, ['data', 'content', 'sha']) ||
    getNestedString(result, ['data', 'sha']) ||
    getNestedString(result, ['content', 'sha'])
  )
}

async function getUploadedSha(fetchFileInfo: () => Promise<unknown>) {
  try {
    return getRemoteFileSha(await fetchFileInfo())
  } catch {
    return undefined
  }
}

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

export function SyncButton() {
  const { activeFilePath } = useArticleStore()
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(false)
  const [lastPushTime, setLastPushTime] = useState<Date | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  // 监听推送开始事件
  useEffect(() => {
    const handlePushStarted = (event: { path: string }) => {
      if (activeFilePath && event.path === activeFilePath) {
        setIsLoading(true)
      }
    }
    emitter.on('sync-push-started', handlePushStarted as any)
    return () => {
      emitter.off('sync-push-started', handlePushStarted as any)
    }
  }, [activeFilePath])

  // 监听推送完成事件
  useEffect(() => {
    const handlePushCompleted = (event: { path: string; success: boolean }) => {
      if (activeFilePath && event.path === activeFilePath) {
        setIsLoading(false)
        if (event.success) {
          // 显示成功状态
          setShowError(false)
          setShowSuccess(true)
          setLastPushTime(new Date())
          // 5秒后恢复
          if (successTimerRef.current) {
            clearTimeout(successTimerRef.current)
          }
          successTimerRef.current = setTimeout(() => {
            setShowSuccess(false)
          }, 5000)
        } else {
          // 显示失败状态
          setShowSuccess(false)
          setShowError(true)
          // 5秒后恢复
          if (errorTimerRef.current) {
            clearTimeout(errorTimerRef.current)
          }
          errorTimerRef.current = setTimeout(() => {
            setShowError(false)
          }, 5000)
        }
      }
    }
    emitter.on('sync-push-completed', handlePushCompleted as any)
    return () => {
      emitter.off('sync-push-completed', handlePushCompleted as any)
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current)
      }
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current)
      }
    }
  }, [activeFilePath])

  // Push to remote
  const handlePush = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    const syncStartedAt = getPerfNow()
    let previousPerfAt = syncStartedAt
    let providerForLog: SyncProvider | 'unknown' = 'unknown'
    const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
      const now = getPerfNow()
      debugSyncPerf(`syncButton.${step}`, {
        path: activeFilePath,
        provider: providerForLog,
        stepMs: roundMs(now - previousPerfAt),
        totalMs: roundMs(now - syncStartedAt),
        ...payload,
      })
      previousPerfAt = now
    }

    setIsLoading(true)
    try {
      logPerf('start')
      const store = await Store.load('store.json')
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as SyncProvider
      providerForLog = provider
      // S3 和 WebDAV 不需要 repo
      const repo = (provider === 's3' || provider === 'webdav') ? '' : await getSyncRepoName(provider)
      logPerf('loadConfig', {
        hasRepo: Boolean(repo),
      })

      // 始终从磁盘读取最新内容
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(activeFilePath)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      logPerf('readLocalFile', {
        workspaceCustom: workspace.isCustom,
        contentLength: content.length,
      })

      const needsCommitMessage = provider !== 's3' && provider !== 'webdav'
      const commitMessage = needsCommitMessage
        ? await generateGitSyncCommitMessage(activeFilePath, content)
        : ''
      if (needsCommitMessage) {
        logPerf('generateCommitMessage', {
          messageLength: commitMessage.length,
          thinkingDisabled: true,
        })
      } else {
        logPerf('skipCommitMessage', {
          reason: 'provider-without-commits',
        })
      }

      let success = false
      let uploadedSha: string | undefined

      switch (provider) {
        case 's3': {
          const s3Module = await import('@/lib/sync/s3')
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          logPerf('loadProviderModule', { module: 's3', hasConfig: Boolean(s3Config) })
          if (!s3Config) {
            throw new Error('S3 配置未找到')
          }
          // S3 上传文件
          const result = await s3Module.s3Upload(s3Config, activeFilePath, content)
          logPerf('uploadFile', {
            hasResult: Boolean(result),
            hasEtag: Boolean(result?.etag),
          })
          if (result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateS3FileEtag(activeFilePath, result.etag)
            uploadedSha = result.etag || 'uploaded'
            success = true
          }
          break
        }
        case 'github': {
          const githubModule = await import('@/lib/sync/github')
          logPerf('loadProviderModule', { module: 'github' })
          const fileInfo = await githubModule.getFiles({ path: activeFilePath, repo })
          logPerf('getRemoteFile', {
            isDirectory: Array.isArray(fileInfo),
            hasRemoteSha: Boolean(getRemoteFileSha(fileInfo)),
          })
          if (Array.isArray(fileInfo)) {
            throw new Error(`${activeFilePath} 是目录，无法推送`)
          }
          const result = await githubModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: getRemoteFileSha(fileInfo),
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          logPerf('uploadFile', {
            hasData: hasUploadData(result),
            hasResultSha: Boolean(getUploadResultSha(result)),
          })
          if (hasUploadData(result)) {
            uploadedSha = getUploadResultSha(result)
            if (!uploadedSha) {
              uploadedSha = await getUploadedSha(() => githubModule.getFiles({ path: activeFilePath, repo }))
              logPerf('refreshUploadedSha', {
                hasSha: Boolean(uploadedSha),
              })
            }
            uploadedSha = uploadedSha || getRemoteFileSha(fileInfo)
            success = true
          }
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee')
          logPerf('loadProviderModule', { module: 'gitee' })
          const fileInfo = await giteeModule.getFiles({ path: activeFilePath, repo })
          logPerf('getRemoteFile', {
            isDirectory: Array.isArray(fileInfo),
            hasRemoteSha: Boolean(getRemoteFileSha(fileInfo)),
          })
          if (Array.isArray(fileInfo)) {
            throw new Error(`${activeFilePath} 是目录，无法推送`)
          }
          const result = await giteeModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: getRemoteFileSha(fileInfo),
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          logPerf('uploadFile', {
            hasData: hasUploadData(result),
            hasResultSha: Boolean(getUploadResultSha(result)),
          })
          if (hasUploadData(result)) {
            uploadedSha = getUploadResultSha(result)
            if (!uploadedSha) {
              uploadedSha = await getUploadedSha(() => giteeModule.getFiles({ path: activeFilePath, repo }))
              logPerf('refreshUploadedSha', {
                hasSha: Boolean(uploadedSha),
              })
            }
            uploadedSha = uploadedSha || getRemoteFileSha(fileInfo)
            success = true
          }
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab')
          logPerf('loadProviderModule', { module: 'gitlab' })
          const fileInfo = await gitlabModule.getFiles({ path: activeFilePath, repo })
          logPerf('getRemoteFile', {
            isDirectory: Array.isArray(fileInfo),
            hasRemoteSha: Boolean(getRemoteFileSha(fileInfo)),
          })
          if (Array.isArray(fileInfo)) {
            throw new Error(`${activeFilePath} 是目录，无法推送`)
          }
          const result = await gitlabModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: getRemoteFileSha(fileInfo),
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          logPerf('uploadFile', {
            hasData: hasUploadData(result),
          })
          if (hasUploadData(result)) {
            uploadedSha = await getUploadedSha(() => gitlabModule.getFiles({ path: activeFilePath, repo }))
            logPerf('refreshUploadedSha', {
              hasSha: Boolean(uploadedSha),
            })
            uploadedSha = uploadedSha || getRemoteFileSha(fileInfo)
            success = true
          }
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea')
          logPerf('loadProviderModule', { module: 'gitea' })
          const fileInfo = await giteaModule.getFiles({ path: activeFilePath, repo })
          logPerf('getRemoteFile', {
            isDirectory: Array.isArray(fileInfo),
            hasRemoteSha: Boolean(getRemoteFileSha(fileInfo)),
          })
          if (Array.isArray(fileInfo)) {
            throw new Error(`${activeFilePath} 是目录，无法推送`)
          }
          const result = await giteaModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: getRemoteFileSha(fileInfo),
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          logPerf('uploadFile', {
            hasData: hasUploadData(result),
            hasResultSha: Boolean(getUploadResultSha(result)),
          })
          if (hasUploadData(result)) {
            uploadedSha = getUploadResultSha(result)
            if (!uploadedSha) {
              uploadedSha = await getUploadedSha(() => giteaModule.getFiles({ path: activeFilePath, repo }))
              logPerf('refreshUploadedSha', {
                hasSha: Boolean(uploadedSha),
              })
            }
            uploadedSha = uploadedSha || getRemoteFileSha(fileInfo)
            success = true
          }
          break
        }
        case 'webdav': {
          const webdavModule = await import('@/lib/sync/webdav')
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          logPerf('loadProviderModule', { module: 'webdav', hasConfig: Boolean(webdavConfig) })
          if (!webdavConfig) {
            throw new Error('WebDAV 配置未找到')
          }
          const result = await webdavModule.webdavUpload(webdavConfig, activeFilePath, content)
          logPerf('uploadFile', {
            hasResult: Boolean(result),
            hasEtag: Boolean(result?.etag),
          })
          if (result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateWebDAVFileEtag(activeFilePath, result.etag)
            uploadedSha = result.etag || 'uploaded'
            success = true
          }
          break
        }
      }

      if (success) {
        if (uploadedSha) {
          await setLocalRecordedSha(activeFilePath, uploadedSha)
          logPerf('recordLocalSha', {
            hasSha: true,
          })
        }
        logPerf('completed', {
          success,
          hasSha: Boolean(uploadedSha),
        })
        emitter.emit('sync-push-completed', { path: activeFilePath, success: true, sha: uploadedSha })
      } else {
        logPerf('completed', {
          success,
          hasSha: Boolean(uploadedSha),
        })
        throw new Error(provider === 'webdav'
          ? 'WebDAV upload failed. Check pathPrefix and webdav.uploadFailed logs.'
          : 'File may not exist on remote')
      }
    } catch (error) {
      logPerf('failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      console.error('Push failed:', error)
      setIsLoading(false)
      emitter.emit('sync-push-completed', { path: activeFilePath, success: false })
    }
  }, [activeFilePath, isLoading])

  // 如果没有配置同步，不显示按钮
  if (!isConfigured || !activeFilePath) return null

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* 上传中显示文字 */}
      {isLoading && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          上传中
        </span>
      )}

      {/* 成功推送状态 */}
      {showSuccess && !isLoading && (
        <span className="text-xs text-success flex items-center gap-1 animate-pulse">
          <CheckCircle size={12} />
          {lastPushTime && formatTime(lastPushTime)}
        </span>
      )}

      {/* 失败推送状态 */}
      {showError && !isLoading && (
        <span className="text-xs text-danger flex items-center gap-1">
          <XCircle size={12} />
          上传失败
        </span>
      )}

      {/* 同步按钮 */}
      {!showSuccess && !showError && !isLoading && (
        <button
          onClick={handlePush}
          disabled={isLoading}
          className={cn(
            'p-0.5 rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          title={isLoading ? '上传中...' : '点击推送'}
        >
          <ArrowUpCircle size={14} />
        </button>
      )}
    </div>
  )
}

export default SyncButton
