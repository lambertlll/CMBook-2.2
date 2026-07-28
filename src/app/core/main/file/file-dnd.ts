import { rename } from "@tauri-apps/plugin-fs"

import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"

export const FILE_MANAGER_DRAG_MIME = "application/x-notegen-file-path"

export type MoveFileManagerEntryResult =
  | {
      moved: true
      sourcePath: string
      targetPath: string
      targetName: string
    }
  | {
      moved: false
      reason: "same-path" | "invalid-target"
      sourcePath: string
      targetPath: string
      targetName: string
    }

function normalizeDirectoryPath(path: string) {
  return path.replace(/^\/+|\/+$/g, "")
}

function getPathName(path: string) {
  return path.split("/").filter(Boolean).pop() || path
}

export function buildMoveTargetPath(sourcePath: string, targetDirectoryPath: string) {
  const normalizedTargetDirectory = normalizeDirectoryPath(targetDirectoryPath)
  const targetName = getPathName(sourcePath)
  const targetPath = normalizedTargetDirectory
    ? `${normalizedTargetDirectory}/${targetName}`
    : targetName

  return {
    targetName,
    targetPath,
  }
}

export function isInvalidFolderMoveTarget(sourcePath: string, targetDirectoryPath: string) {
  const normalizedTargetDirectory = normalizeDirectoryPath(targetDirectoryPath)

  if (!normalizedTargetDirectory) {
    return false
  }

  return normalizedTargetDirectory === sourcePath || normalizedTargetDirectory.startsWith(`${sourcePath}/`)
}

export function setFileManagerDragData(dataTransfer: DataTransfer, path: string) {
  dataTransfer.effectAllowed = "move"
  dataTransfer.setData(FILE_MANAGER_DRAG_MIME, path)
  dataTransfer.setData("text/plain", path)
}

export function getFileManagerDragPath(dataTransfer: DataTransfer) {
  return dataTransfer.getData(FILE_MANAGER_DRAG_MIME) || dataTransfer.getData("text/plain") || dataTransfer.getData("text")
}

export function hasFileManagerDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(FILE_MANAGER_DRAG_MIME)
}

export function hasExternalFilesDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

export async function moveFileManagerEntry(sourcePath: string, targetDirectoryPath: string): Promise<MoveFileManagerEntryResult> {
  const { targetName, targetPath } = buildMoveTargetPath(sourcePath, targetDirectoryPath)

  if (targetPath === sourcePath) {
    return {
      moved: false,
      reason: "same-path",
      sourcePath,
      targetPath,
      targetName,
    }
  }

  if (isInvalidFolderMoveTarget(sourcePath, targetDirectoryPath)) {
    return {
      moved: false,
      reason: "invalid-target",
      sourcePath,
      targetPath,
      targetName,
    }
  }

  const workspace = await getWorkspacePath()
  const oldPathOptions = await getFilePathOptions(sourcePath)
  const newPathOptions = await getFilePathOptions(targetPath)

  if (workspace.isCustom) {
    await rename(oldPathOptions.path, newPathOptions.path)
  } else {
    await rename(oldPathOptions.path, newPathOptions.path, {
      newPathBaseDir: newPathOptions.baseDir,
      oldPathBaseDir: oldPathOptions.baseDir,
    })
  }

  return {
    moved: true,
    sourcePath,
    targetPath,
    targetName,
  }
}

export function getPathAfterMove(path: string, sourcePath: string, targetPath: string) {
  if (path === sourcePath) {
    return targetPath
  }

  if (path.startsWith(`${sourcePath}/`)) {
    return `${targetPath}${path.slice(sourcePath.length)}`
  }

  return path
}
