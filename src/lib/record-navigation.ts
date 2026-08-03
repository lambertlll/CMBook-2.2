import { useSidebarStore } from '@/stores/sidebar'

/**
 * 记录完成后的导航处理
 * 「记录」Tab 与移动端路由均已移除，统一兜底回笔记 Tab
 */
export function handleRecordComplete() {
  const { leftSidebarVisible, setLeftSidebarTab, toggleLeftSidebar } = useSidebarStore.getState()
  if (!leftSidebarVisible) {
    void toggleLeftSidebar()
  }
  void setLeftSidebarTab('files')
}
