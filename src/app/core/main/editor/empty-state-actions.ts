import type { OnboardingStepId } from './onboarding-state'

export async function createNewNoteFromEmptyState({
  setLeftSidebarTab,
  newFile,
}: {
  setLeftSidebarTab: (tab: 'files') => void | Promise<void>
  newFile: () => void | Promise<void>
}) {
  await setLeftSidebarTab('files')
  await newFile()
}

export function getOnboardingAgentPrompt({
  intro,
  requirements,
  outro,
}: {
  intro: string
  requirements: string[]
  outro: string
}) {
  return [intro, requirements.filter(Boolean).join('\n'), outro]
    .filter(Boolean)
    .join('\n\n')
}

export function getOnboardingSpotlightTarget(step: OnboardingStepId) {
  switch (step) {
    case 'organize-note':
      return 'onboarding-target-organize-notes'
    case 'ai-polish':
      return 'onboarding-target-chat-input'
  }
}

function isMarkdownPath(path: string) {
  return /\.(md|txt|markdown)$/i.test(path)
}

type OnboardingFileTreeNode = {
  name: string
  parent?: OnboardingFileTreeNode
  children?: OnboardingFileTreeNode[]
  isFile?: boolean
  isDirectory?: boolean
  isSymlink?: boolean
  isLocale?: boolean
  createdAt?: string
  modifiedAt?: string
}

function computedOnboardingPath(node: OnboardingFileTreeNode): string {
  const segments: string[] = []
  let current: OnboardingFileTreeNode | undefined = node

  while (current) {
    if (current.name) {
      segments.unshift(current.name)
    }
    current = current.parent
  }

  return segments.join('/')
}

function getPathPriority(path: string) {
  const name = path.split('/').pop() || path

  if (/^整理笔记_\d+\.md$/i.test(name)) {
    return 2
  }

  if (isMarkdownPath(path)) {
    return 1
  }

  return 0
}

function flattenFileTree(tree: OnboardingFileTreeNode[]): Array<{ path: string; modifiedAt?: string; createdAt?: string }> {
  return tree.flatMap((item) => {
    const currentPath = computedOnboardingPath(item)

    if (item.isFile) {
      return [{
        path: currentPath,
        modifiedAt: item.modifiedAt,
        createdAt: item.createdAt,
      }]
    }

    const childNodes = item.children
    if (!childNodes?.length) {
      return []
    }

    return flattenFileTree(childNodes)
  })
}

// ===== 展示层工具（2.1 UI 重设计 S2b：仅影响显示，不改文件名本体）=====

// 设计规范：文件名不显示 .md/.txt 扩展名（仅展示层去除）
export function stripNoteExtension(name: string): string {
  return name.replace(/\.(md|txt)$/i, '')
}

// 识别 Untitled 类默认文件名（Untitled.md / Untitled (1).md …）
export function isUntitledNoteName(name: string): boolean {
  return /^Untitled( \(\d+\))?$/i.test(name.replace(/\.(md|txt|markdown)$/i, ''))
}

// 首行标题缓存：path → 解析结果（空串表示无有效首行或读取失败，调用方回退默认名）
const firstLineTitleCache = new Map<string, string>()
const firstLineTitlePending = new Map<string, Promise<string>>()

// 读取笔记内容首行作为显示标题：去除 markdown 标题记号；首行为空或读取失败返回空串
export async function resolveFirstLineTitle(path: string): Promise<string> {
  const cached = firstLineTitleCache.get(path)
  if (cached !== undefined) {
    return cached
  }
  const pending = firstLineTitlePending.get(path)
  if (pending) {
    return pending
  }

  const task = (async () => {
    try {
      const [{ readTextFile }, { getFilePathOptions }] = await Promise.all([
        import('@tauri-apps/plugin-fs'),
        import('@/lib/workspace'),
      ])
      const pathOptions = await getFilePathOptions(path)
      const content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      const firstLine = (content.split('\n')[0] || '').replace(/^#+\s*/, '').trim()
      firstLineTitleCache.set(path, firstLine)
      return firstLine
    } catch {
      // 读取失败（远程未拉取/文件已删除等）：缓存空串避免反复读盘
      firstLineTitleCache.set(path, '')
      return ''
    } finally {
      firstLineTitlePending.delete(path)
    }
  })()
  firstLineTitlePending.set(path, task)
  return task
}

export function findRecentOnboardingFile({
  preferredPath,
  activeFilePath,
  openTabPaths,
  fileTree,
}: {
  preferredPath?: string
  activeFilePath?: string
  openTabPaths?: string[]
  fileTree: OnboardingFileTreeNode[]
}) {
  if (preferredPath && isMarkdownPath(preferredPath)) {
    return preferredPath
  }

  const explicitCandidates = [activeFilePath, ...(openTabPaths || [])]
    .filter((path): path is string => typeof path === 'string' && isMarkdownPath(path))

  const fileCandidates = flattenFileTree(fileTree)
    .filter((file) => isMarkdownPath(file.path))
    .sort((a, b) => {
      const priorityDiff = getPathPriority(b.path) - getPathPriority(a.path)
      if (priorityDiff !== 0) {
        return priorityDiff
      }

      const aModified = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
      const bModified = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
      if (aModified !== bModified) {
        return bModified - aModified
      }

      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bCreated - aCreated
    })
    .map((file) => file.path)

  return [...explicitCandidates, ...fileCandidates].find(Boolean) || ''
}
