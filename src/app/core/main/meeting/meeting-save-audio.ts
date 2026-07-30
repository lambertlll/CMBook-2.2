import { writeFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs'
import { extFromMimeType, KNOWN_AUDIO_EXTS } from './meeting-audio-format'
import { getStoragePathOptions } from '@/lib/storage'

/**
 * 将录音 audioBlob 保存到数据存储目录（默认 AppData，可通过设置自定义路径）
 * 路径：首段为 meetings/{meetingId}.{ext}，续录的第 N 段为 meetings/{meetingId}-N.{ext}，
 * 扩展名按真实音频格式（webm/ogg/m4a 等）
 * 返回保存的相对路径（meetings/xxx.ext）
 */
export async function saveMeetingAudio(
  meetingId: string,
  audioBlob: Blob,
  segmentIndex = 1
): Promise<string> {
  const dirPath = 'meetings'
  const ext = extFromMimeType(audioBlob.type)
  const fileName =
    segmentIndex > 1
      ? `${meetingId}-${segmentIndex}.${ext}`
      : `${meetingId}.${ext}`
  const filePath = `${dirPath}/${fileName}`

  // 确保目录存在（兼容自定义存储路径）
  const dirOpts = await getStoragePathOptions(dirPath)
  const dirExists = dirOpts.baseDir
    ? await exists(dirOpts.path, { baseDir: dirOpts.baseDir })
    : await exists(dirOpts.path)
  if (!dirExists) {
    if (dirOpts.baseDir) {
      await mkdir(dirOpts.path, { baseDir: dirOpts.baseDir, recursive: true })
    } else {
      await mkdir(dirOpts.path, { recursive: true })
    }
  }

  // 将 Blob 转为 Uint8Array
  const arrayBuffer = await audioBlob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  // 写入文件
  const fileOpts = await getStoragePathOptions(filePath)
  if (fileOpts.baseDir) {
    await writeFile(fileOpts.path, uint8Array, { baseDir: fileOpts.baseDir })
  } else {
    await writeFile(fileOpts.path, uint8Array)
  }

  return filePath
}

/**
 * 删除会议音频文件（含续录的全部段）
 * 兼容多种扩展名以及旧版统一保存的 .wav 文件，不存在的文件直接忽略
 */
export async function removeMeetingAudio(
  meetingId: string,
  audioPath?: string,
  audioSegments?: string[]
): Promise<void> {
  const candidates = new Set(
    KNOWN_AUDIO_EXTS.map((ext) => `meetings/${meetingId}.${ext}`)
  )
  if (audioPath) {
    candidates.add(audioPath)
  }
  for (const segment of audioSegments || []) {
    candidates.add(segment)
  }

  await Promise.all(
    [...candidates].map(async (path) => {
      try {
        const opts = await getStoragePathOptions(path)
        if (opts.baseDir) {
          await remove(opts.path, { baseDir: opts.baseDir })
        } else {
          await remove(opts.path)
        }
      } catch {
        // 文件不存在等情况忽略
      }
    })
  )
}
