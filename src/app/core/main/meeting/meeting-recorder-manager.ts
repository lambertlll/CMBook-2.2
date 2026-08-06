import { MeetingAudioRecorder } from './meeting-audio-recorder'
import {
  beginRecordingSpill,
  appendRecordingChunk,
  endRecordingSpill,
} from './meeting-recording-recovery'

/**
 * 模块级录音器管理器。
 * 录音器生命周期独立于组件挂载：切换标签导致 MeetingPanel 卸载时不销毁，
 * 避免丢失已录制的音频；仅在录音停止/开始新会议时由管理器负责销毁。
 */
let currentRecorder: MeetingAudioRecorder | null = null
let currentMeetingId: string | null = null

/** 获取当前录音器（可能为 null） */
export function getRecorder(): MeetingAudioRecorder | null {
  return currentRecorder
}

/** 获取当前录音器归属的会议 ID（可能为 null） */
export function getRecorderMeetingId(): string | null {
  return currentMeetingId
}

/**
 * 获取归属指定会议的录音器。
 * 若当前实例归属其他会议（开始新会议），先销毁旧实例再新建。
 */
export function getOrCreateRecorder(
  meetingId: string
): MeetingAudioRecorder {
  if (currentRecorder && currentMeetingId !== meetingId) {
    destroyRecorder()
  }
  if (!currentRecorder) {
    // 闭包捕获会议 ID，避免管理器状态变化后分片写错文件
    const id = meetingId
    currentRecorder = new MeetingAudioRecorder((chunk) => {
      appendRecordingChunk(id, chunk)
    })
    currentMeetingId = meetingId
    // 开始分片落盘会话（.part 在首个分片到达时才真正创建，录音未开始不留残留）
    beginRecordingSpill(meetingId)
  }
  return currentRecorder
}

/** 销毁当前录音器并清空管理器状态 */
export function destroyRecorder(): void {
  if (currentRecorder) {
    const meetingId = currentMeetingId
    currentRecorder.destroy()
    currentRecorder = null
    currentMeetingId = null
    // 正常结束/换会议时清理 .part 临时文件；崩溃不会走到这里，残留供下次启动恢复
    if (meetingId) {
      endRecordingSpill(meetingId).catch(() => {
        // 清理失败不阻塞主流程
      })
    }
  }
}
