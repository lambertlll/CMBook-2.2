import type { DirTree } from "@/stores/article"
import { computedParentPath } from "@/lib/path"

export interface FileSelectionEntry {
  item: DirTree
  path: string
  name: string
  isDirectory: boolean
  isFile: boolean
  isLocale: boolean
  sha?: string
}

export interface SelectionBox {
  left: number
  top: number
  width: number
  height: number
}

interface ClientRectLike {
  left: number
  right: number
  top: number
  bottom: number
}

export function flattenFileTree(tree: DirTree[]): FileSelectionEntry[] {
  const entries: FileSelectionEntry[] = []

  function walk(items: DirTree[]) {
    for (const item of items) {
      entries.push({
        item,
        path: computedParentPath(item),
        name: item.name,
        isDirectory: item.isDirectory,
        isFile: item.isFile,
        isLocale: item.isLocale,
        sha: item.sha,
      })

      if (item.children) {
        walk(item.children)
      }
    }
  }

  walk(tree)
  return entries
}

export function getFileSelectionEntries(tree: DirTree[], paths: string[]) {
  const entryMap = new Map(flattenFileTree(tree).map(entry => [entry.path, entry]))
  return paths.map(path => entryMap.get(path)).filter((entry): entry is FileSelectionEntry => Boolean(entry))
}

export function isDescendantPath(path: string, parentPath: string) {
  return path.startsWith(`${parentPath}/`)
}

export function getTopLevelSelectionEntries(entries: FileSelectionEntry[]) {
  const selectedFolderPaths = entries
    .filter(entry => entry.isDirectory)
    .map(entry => entry.path)

  return entries.filter(entry => {
    return !selectedFolderPaths.some(folderPath => (
      folderPath !== entry.path && isDescendantPath(entry.path, folderPath)
    ))
  })
}

export function rectsIntersect(a: ClientRectLike, b: ClientRectLike) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export function isInteractiveSelectionTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(
    target.closest('button, input, textarea, select, [role="menuitem"], [data-file-manager-drag-handle], [data-file-manager-toggle]')
  )
}

export function toClipboardItems(entries: FileSelectionEntry[]) {
  return entries.map(entry => ({
    path: entry.path,
    name: entry.name,
    isDirectory: entry.isDirectory,
    sha: entry.sha,
    isLocale: entry.isLocale,
  }))
}
