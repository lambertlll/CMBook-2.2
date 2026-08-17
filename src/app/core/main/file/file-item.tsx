import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, Database, Download, File, FileCode, FileDown, FileJson, FileText, FileUp, FolderOpen, ImageIcon, LoaderCircle, RefreshCwOff, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { platform } from '@tauri-apps/plugin-os';
import { Store } from '@tauri-apps/plugin-store';
import { RepoNames } from "@/lib/sync/github.types";
import { S3Config, WebDAVConfig } from "@/types/sync";
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { appDataDir, join } from '@tauri-apps/api/path';
import { deleteFile } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile } from "@/lib/sync/gitlab";
import { deleteFile as deleteGiteaFile } from "@/lib/sync/gitea";
import { s3Delete } from "@/lib/sync/s3";
import { webdavDelete } from "@/lib/sync/webdav";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import useSettingStore from "@/stores/setting";
import { VectorKnowledgeMenu } from "./vector-knowledge-menu";
import { NoteToCustomerMenu } from "./note-to-customer-menu";
import { isSkillsFolder } from "@/lib/skills/utils";
import { exportMarkdownFile, type MarkdownExportFormat } from "../editor/markdown/markdown-export";
import { exportMarkdownToWord } from "@/lib/export-word";
import { setFileManagerDragData } from "./file-dnd";
import { debugSyncPath } from "@/lib/sync/remote-file";
import { cn } from "@/lib/utils";
import { BatchSelectionContextMenu } from "./batch-selection-context-menu";
import type { FileSelectionEntry } from "./file-selection";
import { pasteIntoFolder } from "./folder-item/paste-into-folder";
import { isUntitledNoteName, resolveFirstLineTitle, stripNoteExtension } from "../editor/empty-state-actions";

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

function buildFileRenamePlan({
  originalName,
  currentPath,
  enteredName,
}: {
  originalName: string
  currentPath: string
  enteredName: string
}) {
  const needsMarkdownSuffix = originalName === '' && !enteredName.endsWith('.md')
  const displayName = needsMarkdownSuffix ? `${enteredName}.md` : enteredName
  const parentPath = currentPath.split('/').slice(0, -1).join('/')
  const targetRelativePath = parentPath ? `${parentPath}/${displayName}` : displayName

  return {
    operation: originalName === '' ? 'create' : 'rename',
    displayName,
    targetRelativePath,
  } as const
}

function showPdfExportStartToast() {
  toast({
    title: '正在导出 PDF',
    description: '长篇文档可能需要一些时间，请稍候。',
  })
}

export function FileItem({
  item,
  focusSidebar,
  selectedPathSet,
  selectionEntries,
}: {
  item: DirTree
  focusSidebar?: () => void
  selectedPathSet: Set<string>
  selectionEntries: FileSelectionEntry[]
}) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    activeFilePath,
    setActiveFilePath,
    readArticle,
    fileTree,
    setFileTree,
    loadFileTree,
    vectorIndexedFiles,
    checkFileVectorIndexed,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    selectedFilePaths,
    setSelectedFilePaths,
    clearSelectedFilePaths,
  } = useArticleStore()
  const setArticleState = useArticleStore.setState
  const { setClipboardItem, clipboardItem, clipboardItems, clipboardOperation } = useClipboardStore()
  const { fileManagerTextSize } = useSettingStore()
  const t = useTranslations('article.file')
  const tCommon = useTranslations('common')
  const isMobile = useIsMobile()
  const [exportingFormat, setExportingFormat] = useState<MarkdownExportFormat | null>(null)

  // 检查路径是否在 skills 文件夹下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  const path = computedParentPath(item)

  // 展示层标题（2.1 UI 重设计）：.md/.txt 扩展名不显示；
  // Untitled 类文件异步读取内容首行作为显示标题（首行为空则维持原名，文件名本体不变）
  const [untitledTitle, setUntitledTitle] = useState('')
  const isUntitledNote = item.isFile === true && item.isLocale && isUntitledNoteName(item.name)
  useEffect(() => {
    if (!isUntitledNote) return
    let cancelled = false
    resolveFirstLineTitle(path)
      .then((title) => { if (!cancelled && title) setUntitledTitle(title) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isUntitledNote, path])
  const displayName = untitledTitle || stripNoteExtension(item.name)

  // 向量状态更新回调
  const handleVectorUpdated = useCallback(() => {
    checkFileVectorIndexed(path)
  }, [path, checkFileVectorIndexed])

  // 根据文字大小映射图标大小
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5',
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)

  // 检查文件是否被剪切
  const isCut = clipboardOperation === 'cut' && clipboardItems.some(entry => entry.path === path)
  const isSelected = selectedPathSet.has(path)
  const useSelectionMenu = isSelected && selectionEntries.length > 1

  // 检查文件是否已计算向量（skills 文件夹下的文件不显示）
  const hasVector = item.isFile && !isInSkillsFolder(path) && vectorIndexedFiles.has(path)
  const canExportMarkdownFile = item.isLocale && item.name !== '' && /\.(md|markdown|txt)$/i.test(item.name)

  // 向量计算状态图标
  const renderVectorIcon = () => {
    if (isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus

    if (status === 'calculating') {
      return <LoaderCircle className={`${iconSize} mr-2 shrink-0 animate-spin`} />
    } else if (status === 'completed' || hasVector) {
      return <Database className={`${iconSize} mr-2 shrink-0 text-muted-foreground opacity-60`} />
    }
    return null
  }

  const isRoot = path.split('/').length === 1
  const folderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  // 不需要 cloneDeep，因为 getCurrentFolder 只读取数据不修改
  const currentFolder = getCurrentFolder(folderPath, fileTree)

  // 优化的输入处理，支持输入法
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [])

  // 输入法合成开始
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 输入法合成结束
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    setName(e.currentTarget.value)
  }, [])

  async function handleSelectFile() {
    // 让文件管理器获得焦点，以便响应快捷键
    focusSidebar?.()
    const currentPath = computedParentPath(item)

    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      // 图片文件：设置 activeFilePath，让 EditorLayout 显示图片编辑器
      setActiveFilePath(currentPath)
    } else if (item.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
      // Markdown/文本文件：设置 activeFilePath
      setActiveFilePath(currentPath)

      // 检查是否是远程文件
      // 读取内容的逻辑移到 EditorLayout 中处理，避免重复渲染
    } else {
      // 其他文件类型：设置 activeFilePath，让 EditorLayout 显示 UnsupportedFile 组件
      setActiveFilePath(currentPath)
    }
  }

  function handleFileClick(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      focusSidebar?.()
      setSelectedFilePaths(
        isSelected
          ? selectedFilePaths.filter(selectedPath => selectedPath !== path)
          : [...selectedFilePaths, path]
      )
      return
    }

    clearSelectedFilePaths()
    void handleSelectFile()
  }

  function handleFileContextMenu(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    focusSidebar?.()
    if (!isSelected) {
      setSelectedFilePaths([path])
    }
  }

  async function handleDeleteFile() {
    // 添加确认弹窗
    const answer = await ask(t('deleteConfirm'), {
      title: item.name,
      kind: 'warning',
    });
    // 如果用户确认删除，则继续执行
    if (answer) {
      try {
        // 获取工作区路径信息
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const workspace = await getWorkspacePath()

        // 使用当前路径，而不是重新计算的路径
        const currentPath = computedParentPath(item)

        // 根据工作区类型正确删除文件
        const pathOptions = await getFilePathOptions(currentPath)

        if (workspace.isCustom) {
          // 自定义工作区
          await remove(pathOptions.path)
        } else {
          // 默认工作区
          await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // 更新文件树
        if (currentFolder) {
          const index = currentFolder.children?.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1 && currentFolder.children) {
            const current = currentFolder.children[index]
            if (current.sha) {
              // 有云端版本：只标记为非本地文件，保留云端文件
              current.isLocale = false
            } else {
              // 纯本地文件：直接从文件树中移除
              currentFolder.children.splice(index, 1)
            }
          }
        } else {
          // 根目录文件：需要克隆 fileTree 来更新
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1) {
            const current = cacheTree[index]
            if (current.sha) {
              // 有云端版本：只标记为非本地文件，保留云端文件
              current.isLocale = false
            } else {
              // 纯本地文件：直接从文件树中移除
              cacheTree.splice(index, 1)
            }
          }
          setFileTree(cacheTree)
        }

        // 删除向量数据库中的记录
        try {
          const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
          await deleteVectorDocumentsByFilename(path)
          // 从向量索引映射中移除
          const newMap = new Map(vectorIndexedFiles)
          newMap.delete(path)
          setArticleState({ vectorIndexedFiles: newMap })
        } catch (error) {
          console.error(`删除文件 ${item.name} 的向量数据失败:`, error)
        }

        // 清理已被删除的文件对应的 tabs（包括自动选择其他 tab）
        await cleanTabsByDeletedFile(currentPath)
      } catch (error) {
        console.error('Delete file failed:', error)
        toast({
          title: t('context.deleteLocalFile'),
          description: '删除文件失败: ' + error,
          variant: 'destructive'
        })
      }
    }
  }

  async function handleDeleteSyncFile() {
    const answer = await ask(t('context.deleteSyncFile') + '?', {
      title: item.name,
      kind: 'warning',
    });
    if (answer) {
      const currentPath = computedParentPath(item)

      // 设置 loading 状态
      const cacheTree = cloneDeep(fileTree)
      const setLoadingStatus = (items: typeof cacheTree): boolean => {
        for (const entry of items) {
          const entryPath = computedParentPath(entry)
          if (entryPath === currentPath && entry.isFile) {
            entry.loading = true
            return true
          }
          if (entry.children && setLoadingStatus(entry.children)) {
            return true
          }
        }
        return false
      }
      if (setLoadingStatus(cacheTree)) {
        setFileTree(cacheTree)
      }

      try {
        // 获取当前主要备份方式
        const store = await Store.load('store.json');
        const backupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'>('primaryBackupMethod') || 'github';
        const repoName = backupMethod === 's3' || backupMethod === 'webdav'
          ? RepoNames.sync
          : await getSyncRepoName(backupMethod)

        let success = false
        switch (backupMethod) {
          case 'github': {
            const result = await deleteFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitee': {
            const result = await deleteGiteeFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = result !== false
            break;
          }
          case 'gitlab': {
            const result = await deleteGitlabFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitea': {
            const result = await deleteGiteaFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              const result = await s3Delete(s3Config, currentPath)
              success = result
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              const result = await webdavDelete(webdavConfig, currentPath)
              success = result
            }
            break;
          }
        }

        if (success) {
          // 只更新当前文件的状态，不刷新整个文件树
          const cacheTree = cloneDeep(fileTree)

          // 递归查找并更新/删除文件
          const updateOrRemoveFile = (items: typeof cacheTree): boolean => {
            for (let i = 0; i < items.length; i++) {
              const entry = items[i]
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                if (entry.isLocale) {
                  // 本地存在：只清除远程 SHA
                  entry.sha = undefined
                  entry.loading = undefined
                } else {
                  // 本地不存在：从列表中移除
                  items.splice(i, 1)
                }
                return true
              }
              if (entry.children && updateOrRemoveFile(entry.children)) {
                return true
              }
            }
            return false
          }

          if (updateOrRemoveFile(cacheTree)) {
            setFileTree(cacheTree)
          }

          toast({
            title: t('context.delete'),
            description: t('context.deleteSyncFileSuccess'),
          });
        } else {
          // 删除失败，清除 loading 状态
          const cacheTree = cloneDeep(fileTree)
          const clearLoadingStatus = (items: typeof cacheTree): boolean => {
            for (const entry of items) {
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                entry.loading = undefined
                return true
              }
              if (entry.children && clearLoadingStatus(entry.children)) {
                return true
              }
            }
            return false
          }
          if (clearLoadingStatus(cacheTree)) {
            setFileTree(cacheTree)
          }
          throw new Error('删除操作返回失败')
        }
      } catch (error) {
        // 删除失败，清除 loading 状态
        const cacheTree = cloneDeep(fileTree)
        const clearLoadingStatus = (items: typeof cacheTree): boolean => {
          for (const entry of items) {
            const entryPath = computedParentPath(entry)
            if (entryPath === currentPath && entry.isFile) {
              entry.loading = undefined
              return true
            }
            if (entry.children && clearLoadingStatus(entry.children)) {
              return true
            }
          }
          return false
        }
        if (clearLoadingStatus(cacheTree)) {
          setFileTree(cacheTree)
        }
        console.error('[handleDeleteSyncFile] 删除远程文件失败:', error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
    // 延迟执行，确保上下文菜单完全关闭
    setTimeout(() => {
      setIsEditing(true)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 只选中文件名，不包含扩展名
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  async function handleRename() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const originalName = item.name
    const nextTree = cloneDeep(fileTree)
    const nextFolder = getCurrentFolder(folderPath, nextTree)
    
    let finalName = name
    
    // 如果输入为空字符串，生成默认文件名
    if (!name || name.trim() === '') {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
      finalName = await generateUniqueFilename(parentPath, 'Untitled')
      setName(finalName)
    } else {
      finalName = name
      setName(finalName)
    }
  
    if (finalName && finalName.trim() !== '' && finalName !== originalName) {
      const renamePlan = buildFileRenamePlan({
        originalName,
        currentPath: path,
        enteredName: finalName,
      })
      debugSyncPath('file.renamePlan', {
        originalName,
        enteredName: finalName,
        displayName: renamePlan.displayName,
        targetRelativePath: renamePlan.targetRelativePath,
      })
      const { displayName, operation, targetRelativePath } = renamePlan
      
      // 更新缓存树中的名称
      if (nextFolder && nextFolder.children) {
        const fileIndex = nextFolder?.children?.findIndex(file => file.name === originalName)
        if (fileIndex !== undefined && fileIndex !== -1) {
          nextFolder.children[fileIndex].name = displayName
          nextFolder.children[fileIndex].isEditing = false
        }
      } else {
        const fileIndex = nextTree.findIndex(file => file.name === originalName)
        if (fileIndex !== -1 && fileIndex !== undefined) {
          nextTree[fileIndex].name = displayName
          nextTree[fileIndex].isEditing = false
        }
      }
      setFileTree(nextTree)
      
      // 确定是重命名现有文件还是创建新文件
      if (operation === 'rename') {
        // 重命名现有文件
        // 获取源路径和目标路径
        const oldPathOptions = await getFilePathOptions(path)
        const newPathOptions = await getFilePathOptions(targetRelativePath)
        
        // 根据工作区类型执行重命名操作
        if (workspace.isCustom) {
          await rename(oldPathOptions.path, newPathOptions.path)
        } else {
          await rename(oldPathOptions.path, newPathOptions.path, { 
            newPathBaseDir: BaseDirectory.AppData, 
            oldPathBaseDir: BaseDirectory.AppData 
          })
        }
      } else {
        // 创建新文件
        const pathOptions = await getFilePathOptions(targetRelativePath)
        
        // 检查文件是否已存在
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          toast({ title: '文件名已存在' })
          setTimeout(() => inputRef.current?.focus(), 300);
          return
        } else {
          // 创建新文件
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
        }
      }
      
      // 构建新文件的完整路径用于激活文件
      let newPath = targetRelativePath
      // 判断 newPath 是否以 / 开头
      if (newPath.startsWith('/')) {
        newPath = newPath.slice(1)
      }
      setActiveFilePath(newPath)
      // 新建文件后自动选择该文件并读取内容
      readArticle(newPath, '', shouldAutoSyncOnInitialRead({ isNewFile: true }))
    } else {
      // 处理取消创建或无变更的情况
      if (originalName === '') {
        // 只有当原文件名为空（新建文件）时才删除列表项
        if (currentFolder && currentFolder.children) {
          const index = currentFolder?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.children) {
            currentFolder?.children?.splice(index, 1)
          }
          setFileTree(fileTree)
        } else {
          // 根目录文件：需要克隆 fileTree 来更新
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
          setFileTree(cacheTree)
        }
      } else {
        // 对于重命名现有文件，如果没有输入新名称，则保持原状态
        if (currentFolder && currentFolder.children) {
          const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
          if (fileIndex !== undefined && fileIndex !== -1) {
            currentFolder.children[fileIndex].isEditing = false
          }
          setFileTree(fileTree)
        } else {
          // 根目录文件：需要克隆 fileTree 来更新
          const cacheTree = cloneDeep(fileTree)
          const fileIndex = cacheTree.findIndex(file => file.name === item.name)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            cacheTree[fileIndex].isEditing = false
          }
          setFileTree(cacheTree)
        }
      }
    }

    setIsEditing(false)
  }

  async function handleShowFileManager() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 确定文件所在的目录路径
    const folderPath = item.parent ? computedParentPath(item.parent) : ''
    
    // 根据工作区类型确定正确的路径
    if (workspace.isCustom) {
      // 自定义工作区 - 直接使用工作区路径
      const pathOptions = await getFilePathOptions(folderPath)
      openPath(pathOptions.path)
    } else {
      // 默认工作区 - 使用 AppData 目录
      const appDir = await appDataDir()
      openPath(await join(appDir, 'article', folderPath))
    }
  }

  function handleDragStart(ev: React.DragEvent<HTMLElement>) {
    setFileManagerDragData(ev.dataTransfer, path)
  }

  async function handleCopyFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteFile() {
    const targetDir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
    await pasteIntoFolder({
      clipboardItem,
      clipboardItems,
      clipboardOperation,
      folderPath: targetDir,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
      cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder,
    })
  }

  async function handleExportFile(format: MarkdownExportFormat) {
    try {
      setExportingFormat(format)
      const exported = await exportMarkdownFile(
        format,
        path,
        { onPdfRenderStart: showPdfExportStartToast },
      )

      if (exported) {
        toast({ title: format === 'pdf' ? 'PDF 导出成功' : '导出成功' })
      }
    } catch (error) {
      console.error(`Export selected file failed: ${path}`, error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExportingFormat(null)
    }
  }

  async function handleExportWord() {
    try {
      setExportingFormat('word')
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const fileOptions = await getFilePathOptions(path)
      const content = fileOptions.baseDir
        ? await readTextFile(fileOptions.path, { baseDir: fileOptions.baseDir })
        : await readTextFile(fileOptions.path)
      const fileName = path.split('/').pop()?.replace(/\.md$/, '') || 'document'
      await exportMarkdownToWord(content, fileName)
      toast({ title: 'Word 导出成功' })
    } catch (error) {
      console.error(`Export selected file to Word failed: ${path}`, error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExportingFormat(null)
    }
  }

  async function handleEditEnd() {
    if (currentFolder && currentFolder.children) {
      const index = currentFolder?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.children) {
        currentFolder?.children?.splice(index, 1)
      }
      setFileTree(fileTree)
    } else {
      // 根目录文件：需要克隆 fileTree 来更新
      const cacheTree = cloneDeep(fileTree)
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
      setFileTree(cacheTree)
    }
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  // 监听文件管理器统一快捷键触发的自定义事件
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFile()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 粘贴到文件所在目录（同级粘贴）
      if (customEvent.detail.targetPath === path) {
        handlePasteFile()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFile, handlePasteFile])

  // 获取当前平台（用于显示快捷键）
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  // 快捷键显示文本
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-file-manager-item-path={path}
            data-file-manager-item-kind="file"
            className={cn(
              "file-manange-item min-w-0 overflow-hidden",
              path === activeFilePath && "active",
              isSelected && "file-selected",
              !isRoot && "translate-x-5 w-[calc(100%-20px)]!"
            )}
            onClick={handleFileClick}
            onContextMenu={handleFileContextMenu}
          >
            {
              isEditing ? 
              <div className="flex min-w-0 w-full items-center gap-1 select-none">
                <span className={item.parent ? 'size-0' : `${iconSize} ml-1`} />
                <File className={`${iconSize} shrink-0`} />
                <Input
                  ref={inputRef}
                  className={`h-5 min-w-0 flex-1 rounded-sm text-${fileManagerTextSize} px-1 font-normal mr-1`}
                  value={name}
                  onBlur={handleRename}
                  onChange={handleInputChange}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(e) => {
                    // 阻止删除快捷键冒泡到全局快捷键处理器
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      e.stopPropagation()
                    }
                    if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                      handleRename()
                    } else if (e.code === 'Escape') {
                      handleEditEnd()
                    }
                  }}
                />
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ?
              <span
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 overflow-hidden dark:hover:text-white`}>
                <div
                  data-file-manager-drag-handle
                  draggable
                  onDragStart={handleDragStart}
                  className="relative flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 overflow-hidden active:cursor-grabbing"
                >
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex shrink-0 items-center">
                    <ImageIcon className={`${iconSize} shrink-0`} />
                  </div>
                  <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate`}>{item.name}</span>
                  {path === activeFilePath && renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-danger" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-danger" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span> :
              <span
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 overflow-hidden dark:hover:text-white`}>
                <div
                  data-file-manager-drag-handle
                  draggable
                  onDragStart={handleDragStart}
                  className="relative flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 overflow-hidden active:cursor-grabbing"
                >
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex shrink-0 items-center">
                    { item.loading ? (
                      <LoaderCircle className={`${iconSize} shrink-0 animate-spin`} />
                    ) : item.isLocale ? (
                      item.sha ? <FileUp className={`${iconSize} shrink-0`} /> : <File className={`${iconSize} shrink-0`} />
                    ) : (
                      <FileDown className={`${iconSize} shrink-0`} />
                    )}
                  </div>
                  <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate`}>{displayName}</span>
                  {path === activeFilePath && renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-danger" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-danger" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {useSelectionMenu ? (
            <BatchSelectionContextMenu entries={selectionEntries} modKey={modKey} deleteKey={deleteKey} />
          ) : (
            <>
              <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('context.viewDirectory')}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger inset disabled={!canExportMarkdownFile || exportingFormat !== null} menuType="file">
                  <Download className="mr-2 h-4 w-4" />
                  {tCommon('export')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('markdown') }}
                    menuType="file"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Markdown
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('html') }}
                    menuType="file"
                  >
                    <FileCode className="mr-2 h-4 w-4" />
                    HTML
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('json') }}
                    menuType="file"
                  >
                    <FileJson className="mr-2 h-4 w-4" />
                    JSON
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('pdf') }}
                    menuType="file"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportWord() }}
                    menuType="file"
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Word
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <VectorKnowledgeMenu
                item={item}
                hasVector={hasVector}
                onVectorUpdated={handleVectorUpdated}
              />
              <NoteToCustomerMenu item={item} />
              <ContextMenuSeparator />
              <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.cut')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}X</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset onClick={handleCopyFile} menuType="file">
                <Copy className="mr-2 h-4 w-4" />
                {t('context.copy')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}C</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.paste')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}V</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.rename')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{renameKey}</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem disabled={!item.sha} inset className="text-danger" onClick={handleDeleteSyncFile} menuType="file">
                <RefreshCwOff className="mr-2 h-4 w-4" />
                {t('context.deleteSyncFile')}
              </ContextMenuItem>
              <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-danger" onClick={handleDeleteFile} menuType="file">
                <Trash2 className="mr-2 h-4 w-4" />
                {t('context.deleteLocalFile')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{deleteKey}</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
