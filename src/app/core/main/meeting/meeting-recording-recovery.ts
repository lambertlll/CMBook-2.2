import {
  writeFile,
  readFile,
  mkdir,
  exists,
  remove,
  readDir,
  stat,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'
import { saveMeetingAudio } from './meeting-save-audio'

/**
 * 录音分片落盘 + 崩溃恢复。
 *
 * 背景：MediaRecorder 的 audioChunks 纯内存持有，应用崩溃/被杀会丢失整场录音。
 * 方案：录音中每个分片（约每秒一块）在入内存的同时，异步追加写入 AppData 下的
 * 临时文件 meetings/recording-<meetingId>.part（内容与最终 Blob 完全一致，
 * 是同一容器格式的连续分片）。正常停止/销毁录音器时删除 .part 不留痕；
 * 崩溃时 .part 残留，下次启动在会议列表顶部提示恢复或丢弃。
 *
 * 降级原则：落盘失败仅告警一次并停用后续落盘（回到纯内存现状），绝不打断录音。
 */

const PART_DIR = 'meetings'
const PART_PREFIX = 'recording-'
const PART_SUFFIX = '.part'

/** 一场未正常结束的录音残留 */
export interface InterruptedRecording {
  meetingId: string
  filePath: string // 相对 AppData 的路径
  sizeBytes: number
  mtime: number // 最后修改时间（毫秒时间戳），不可用时为 0
}

/** 一次录音的分片落盘会话（模块级单例，与录音器管理器一一对应） */
interface SpillSession {
  meetingId: string
  // 追加写入串行队列：保证分片按到达顺序写入，且结束时可等待队列清空
  queue: Promise<void>
  failed: boolean // 落盘已失败，降级为纯内存
  warned: boolean // 失败告警只打一次
}

let session: SpillSession | null = null

function partPathFor(meetingId: string): string {
  return `${PART_DIR}/${PART_PREFIX}${meetingId}${PART_SUFFIX}`
}

/**
 * 开始一场录音的分片落盘会话。
 * 此时不创建文件，首个数据分片到达时才真正落盘（录音未开始不会产生残留）。
 */
export function beginRecordingSpill(meetingId: string): void {
  session = {
    meetingId,
    queue: Promise.resolve(),
    failed: false,
    warned: false,
  }
}

/**
 * 追加一个录音分片到 .part 临时文件（异步，不阻塞录音回调）。
 * 失败时降级：仅 console.warn 一次并停用后续落盘，绝不打断录音。
 */
export function appendRecordingChunk(meetingId: string, chunk: Blob): void {
  const s = session
  if (!s || s.meetingId !== meetingId || s.failed) return

  s.queue = s.queue.then(async () => {
    try {
      const dirExists = await exists(PART_DIR, {
        baseDir: BaseDirectory.AppData,
      })
      if (!dirExists) {
        await mkdir(PART_DIR, {
          baseDir: BaseDirectory.AppData,
          recursive: true,
        })
      }
      const bytes = new Uint8Array(await chunk.arrayBuffer())
      await writeFile(partPathFor(meetingId), bytes, {
        baseDir: BaseDirectory.AppData,
        append: true,
      })
    } catch (err) {
      s.failed = true
      if (!s.warned) {
        s.warned = true
        console.warn(
          '[Meeting] 录音分片落盘失败，本次录音降级为纯内存（崩溃将无法恢复）:',
          err
        )
      }
    }
  })
}

/**
 * 正常结束（或销毁录音器/切换会议）时清理 .part 临时文件。
 * 等待已排队的追加写完再删除，避免删除后又有迟到的写入残留。
 */
export async function endRecordingSpill(meetingId: string): Promise<void> {
  const s = session
  if (!s || s.meetingId !== meetingId) return
  session = null
  await s.queue.catch(() => {})
  await remove(partPathFor(meetingId), { baseDir: BaseDirectory.AppData }).catch(
    () => {
      // 文件不存在等情况忽略
    }
  )
}

/**
 * 扫描 AppData 下残留的 recording-*.part（大小 > 0），即未正常结束的录音。
 * 探测失败（目录不存在等）视为无残留。
 */
export async function findInterruptedRecordings(): Promise<
  InterruptedRecording[]
> {
  let entries
  try {
    entries = await readDir(PART_DIR, { baseDir: BaseDirectory.AppData })
  } catch {
    return []
  }

  const result: InterruptedRecording[] = []
  for (const entry of entries) {
    if (!entry.isFile) continue
    const name = entry.name
    if (!name.startsWith(PART_PREFIX) || !name.endsWith(PART_SUFFIX)) continue
    const filePath = `${PART_DIR}/${name}`
    try {
      const info = await stat(filePath, { baseDir: BaseDirectory.AppData })
      if (!info.isFile || info.size <= 0) continue
      result.push({
        meetingId: name.slice(
          PART_PREFIX.length,
          name.length - PART_SUFFIX.length
        ),
        filePath,
        sizeBytes: info.size,
        mtime: info.mtime ? info.mtime.getTime() : 0,
      })
    } catch {
      // 单个文件读取失败不影响整体扫描
    }
  }
  return result
}

/**
 * 按文件头魔数识别音频容器格式（.part 不记录 MIME，与录音器的格式探测顺序对应）
 */
function sniffAudioMime(bytes: Uint8Array): string {
  // EBML 头（webm）
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'audio/webm'
  }
  // OggS（ogg）
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return 'audio/ogg'
  }
  // ftyp box（mp4/m4a）
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'audio/mp4'
  }
  return 'audio/webm'
}

/**
 * 把残留的 .part 恢复为该会议的正式音频段：
 * 读取分片 → 识别容器格式 → 走 saveMeetingAudio 管线落为第 N 段 → 删除 .part。
 * 返回正式音频段的相对路径，会议记录字段由调用方更新。
 */
export async function recoverInterruptedRecording(
  item: InterruptedRecording,
  existingSegmentCount: number
): Promise<string> {
  const bytes = await readFile(item.filePath, {
    baseDir: BaseDirectory.AppData,
  })
  const mime = sniffAudioMime(bytes)
  const blob = new Blob([bytes], { type: mime })
  // 续录段命名规则与正常停录一致：首段 {id}.{ext}，第 N 段 {id}-N.{ext}
  const savedPath = await saveMeetingAudio(
    item.meetingId,
    blob,
    existingSegmentCount + 1
  )
  await remove(item.filePath, { baseDir: BaseDirectory.AppData }).catch(() => {
    // 删除失败不影响恢复结果，残留文件下次仍会提示
  })
  return savedPath
}

/** 丢弃残留的 .part 临时文件 */
export async function discardInterruptedRecording(
  item: InterruptedRecording
): Promise<void> {
  await remove(item.filePath, { baseDir: BaseDirectory.AppData }).catch(() => {
    // 文件不存在等情况忽略
  })
}
