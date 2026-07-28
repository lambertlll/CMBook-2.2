import { useMeetingStore } from './meeting-store'
import { useSidebarStore } from '@/stores/sidebar'

/**
 * 会议快捷入口（托盘菜单 / 全局快捷键 Ctrl+Shift+M）共用的启动逻辑。
 * 切换到左栏"会议"标签；若当前没有录音中的会议则开始一场新会议录音。
 * 启动仍走 meeting-store 的 createMeeting（与 MeetingStartView"开始会议"按钮同一入口），
 * 录音器由 MeetingPanel 挂载后的 effect 根据 recordingMeetingId 启动，此处不直接操作录音器。
 */
export async function quickStartMeeting(): Promise<void> {
  // 会议列表未加载时先加载，避免误判录音状态
  const meetingStore = useMeetingStore.getState()
  if (!meetingStore.initialized) {
    await meetingStore.loadMeetings()
  }

  const sidebar = useSidebarStore.getState()
  if (!sidebar.leftSidebarVisible) {
    await sidebar.toggleLeftSidebar()
  }
  await useSidebarStore.getState().setLeftSidebarTab('meeting')

  // 已有录音中的会议时只切换到会议标签，不重复开始
  if (useMeetingStore.getState().recordingMeetingId) {
    return
  }
  useMeetingStore.getState().createMeeting()
}
