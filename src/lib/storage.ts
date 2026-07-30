/**
 * 数据存储路径抽象层：允许用户自定义录音、会议音频、图片等媒体文件的存储位置。
 *
 * - 未设置自定义路径时，使用 Tauri BaseDirectory.AppData（默认行为）
 * - 设置自定义路径后，所有媒体文件写入用户选择的绝对路径
 * - 数据库（note.db）和配置文件（store.json）始终保持在 AppData，不迁移
 *
 * 使用方式：
 *   const opts = await getStoragePathOptions('meetings/uuid.webm')
 *   await writeFile(opts.path, data, opts.baseDir ? { baseDir: opts.baseDir } : {})
 */

import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { join } from '@tauri-apps/api/path'

export interface StoragePathOptions {
  /** 文件路径（自定义路径时为绝对路径，默认时为相对 AppData 的路径） */
  path: string
  /** BaseDirectory（自定义路径时为 undefined） */
  baseDir?: BaseDirectory
}

/**
 * 获取用户设置的数据存储路径
 * @returns { path: string, isCustom: boolean }
 *   - isCustom=true 时 path 为用户选择的绝对路径
 *   - isCustom=false 时 path 为空字符串（表示使用 AppData 默认目录）
 */
export async function getDataStoragePath(): Promise<{ path: string, isCustom: boolean }> {
  const store = await Store.load('store.json')
  const dataStoragePath = await store.get<string>('dataStoragePath')
  if (dataStoragePath) {
    return { path: dataStoragePath, isCustom: true }
  }
  return { path: '', isCustom: false }
}

/**
 * 将相对路径（如 "meetings/uuid.webm"）解析为可写入的路径选项
 * - 自定义路径：join(customPath, relativePath) → 绝对路径，无 baseDir
 * - 默认路径：relativePath → 相对 AppData，baseDir = AppData
 */
export async function getStoragePathOptions(relativePath: string): Promise<StoragePathOptions> {
  const storage = await getDataStoragePath()
  if (storage.isCustom) {
    const fullPath = await join(storage.path, relativePath)
    return { path: fullPath }
  }
  return { path: relativePath, baseDir: BaseDirectory.AppData }
}

/**
 * 获取存储目录路径选项（用于 exists/mkdir 检查）
 * 与 getStoragePathOptions 相同，但语义上用于目录操作
 */
export async function getStorageDirOptions(dirPath: string): Promise<StoragePathOptions> {
  return getStoragePathOptions(dirPath)
}
