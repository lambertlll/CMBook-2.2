import { BaseDirectory, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs"

import { toast } from "@/hooks/use-toast"
import { generateCopyFilename, generateCopyFoldername } from "@/lib/default-filename"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"

import { getPasteTargetDirectory } from "./paste-target"

export async function pasteIntoFolder({
  clipboardItem,
  clipboardItems,
  clipboardOperation,
  folderPath,
  emptyToastTitle,
  pastedToastTitle,
  pasteFailedToastTitle,
  loadFileTree,
  setClipboardItem,
  cleanTabsByDeletedFile,
  cleanTabsByDeletedFolder,
}) {
  const itemsToPaste = Array.isArray(clipboardItems) && clipboardItems.length > 0
    ? clipboardItems
    : clipboardItem ? [clipboardItem] : []

  if (itemsToPaste.length === 0) {
    toast({ title: emptyToastTitle, variant: 'destructive' })
    return false
  }

  try {
    const workspace = await getWorkspacePath()

    const targetDir = getPasteTargetDirectory(folderPath)

    for (const item of itemsToPaste) {
      if (item.isDirectory && targetDir.startsWith(`${item.path}/`)) {
        toast({ title: pasteFailedToastTitle, variant: 'destructive' })
        return false
      }

      const targetName = item.isDirectory
        ? await generateCopyFoldername(targetDir, item.name)
        : await generateCopyFilename(targetDir, item.name)

      const targetPathRelative = targetDir ? `${targetDir}/${targetName}` : targetName
      const targetPathOptions = await getFilePathOptions(targetPathRelative)
      const sourcePathOptions = await getFilePathOptions(item.path)

      if (item.isDirectory) {
        if (workspace.isCustom) {
          await mkdir(targetPathOptions.path)
        } else {
          await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
        }

        const isPasteIntoSelf = targetDir === item.path
        const copyDirRecursively = async (srcRelative, destRelative) => {
          const entries = await readDir(
            srcRelative,
            workspace.isCustom ? {} : { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData }
          )

          for (const entry of entries) {
            const srcEntryPath = `${srcRelative}/${entry.name}`
            const destEntryPath = `${destRelative}/${entry.name}`

            if (entry.isDirectory) {
              if (isPasteIntoSelf && entry.name === targetName) {
                continue
              }

              if (workspace.isCustom) {
                await mkdir(destEntryPath)
              } else {
                await mkdir(destEntryPath, { baseDir: targetPathOptions.baseDir })
              }
              await copyDirRecursively(srcEntryPath, destEntryPath)
            } else {
              try {
                if (workspace.isCustom) {
                  const content = await readTextFile(srcEntryPath)
                  await writeTextFile(destEntryPath, content)
                } else {
                  const content = await readTextFile(srcEntryPath, { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData })
                  await writeTextFile(destEntryPath, content, { baseDir: targetPathOptions.baseDir })
                }
              } catch (error) {
                console.error(`Error copying file ${srcEntryPath}:`, error)
              }
            }
          }
        }

        await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)
      } else if (workspace.isCustom) {
        const content = await readTextFile(sourcePathOptions.path)
        await writeTextFile(targetPathOptions.path, content)
      } else {
        const content = await readTextFile(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
        await writeTextFile(targetPathOptions.path, content, { baseDir: targetPathOptions.baseDir })
      }
    }

    if (clipboardOperation === 'cut') {
      for (const item of itemsToPaste) {
        const sourcePathOptions = await getFilePathOptions(item.path)
        if (workspace.isCustom) {
          await remove(sourcePathOptions.path, { recursive: true })
        } else {
          await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
        }

        if (item.isDirectory) {
          await cleanTabsByDeletedFolder?.(item.path)
        } else {
          await cleanTabsByDeletedFile?.(item.path)
        }
      }
      setClipboardItem(null, 'none')
    }

    loadFileTree()
    toast({ title: pastedToastTitle })
    return true
  } catch (error) {
    console.error('Paste operation failed:', error)
    toast({ title: pasteFailedToastTitle, variant: 'destructive' })
    return false
  }
}
