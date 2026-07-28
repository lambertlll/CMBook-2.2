import { writeFile, mkdir, exists, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { extFromMimeType, KNOWN_AUDIO_EXTS } from './meeting-audio-format'

/**
 * 将录音 audioBlob 保存到 Tauri AppData 目录
 * 路径：首段为 meetings/{meetingId}.{ext}，续录的第 N 段为 meetings/{meetingId}-N.{ext}，
 * 扩展名按真实音频格式（webm/ogg/m4a 等）
 * 返回保存的相对路径
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

  // 确保 meetings 目录存在
  const dirExists = await exists(dirPath, { baseDir: BaseDirectory.AppData })
  if (!dirExists) {
    await mkdir(dirPath, { baseDir: BaseDirectory.AppData, recursive: true })
  }

  // 将 Blob 转为 Uint8Array
  const arrayBuffer = await audioBlob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  // 写入文件
  await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })

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
    [...candidates].map((path) =>
      remove(path, { baseDir: BaseDirectory.AppData }).catch(() => {
        // 文件不存在等情况忽略
      })
    )
  )
}
