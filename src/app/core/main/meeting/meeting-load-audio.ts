import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { mimeTypeFromPath, KNOWN_AUDIO_EXTS } from './meeting-audio-format'

/**
 * 从本地 AppData 读取已保存的会议音频文件
 * 按扩展名还原真实 MIME 类型；存储路径读取失败时回退尝试其它已知扩展名
 * （兼容旧版统一保存为 .wav 的数据）
 * 返回 Blob 对象，可直接用于 transcribeAudio
 */
export async function loadMeetingAudio(audioPath: string): Promise<Blob> {
  const meetingId =
    audioPath.split('/').pop()?.replace(/\.[^.]+$/, '') || ''

  const candidates = [
    ...new Set([
      audioPath,
      ...KNOWN_AUDIO_EXTS.map((ext) => `meetings/${meetingId}.${ext}`),
    ]),
  ]

  let lastError: unknown
  for (const path of candidates) {
    try {
      const uint8Array = await readFile(path, {
        baseDir: BaseDirectory.AppData,
      })
      return new Blob([uint8Array], { type: mimeTypeFromPath(path) })
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('音频文件不存在或读取失败')
}
