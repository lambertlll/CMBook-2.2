'use client'

import { FileSidebar } from "./file"
import { MeetingList } from "./meeting/meeting-list"
import { CustomerList } from "./customer/customer-list"
import { FileActions } from "./file/file-actions"
import { useSidebarStore } from "@/stores/sidebar"

/**
 * 二级面板（2.1 全局框架）：
 * 位于图标导轨右侧，按 leftSidebarTab 切换文件树 / 会议列表 / 客户列表，
 * 各列表保留自身头部操作区；笔记 Tab 顶部保留 FileActions 功能区。
 * Tab 切换入口已移至左侧图标导轨（app-rail.tsx）。
 */
export function LeftSidebar() {
  const leftSidebarTab = useSidebarStore((s) => s.leftSidebarTab)

  return (
    <div className="flex h-full w-full flex-col">
      {/* 文件 Tab 的情境功能区（新建笔记/文件夹等） */}
      {leftSidebarTab === "files" && (
        <div className="flex h-10 w-full shrink-0 items-center border-b px-2">
          <FileActions />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {leftSidebarTab === "meeting" ? (
          <MeetingList />
        ) : leftSidebarTab === "customer" ? (
          <CustomerList />
        ) : (
          <FileSidebar />
        )}
      </div>
    </div>
  )
}
