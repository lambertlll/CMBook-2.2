'use client'

import { SettingTab } from "./components/setting-tab"
import { ConfigHealthBanner } from "./components/config-health-banner"

export default function SettingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div id="setting-page" className="flex h-full">
      <SettingTab />
      <div className="flex-1 p-8 overflow-y-auto h-full">
        <div className="mx-auto w-full max-w-5xl">
          {/* D3 配置健康检查横幅：全部已配时自动收起 */}
          <ConfigHealthBanner />
          {children}
        </div>
      </div>
    </div>
  )
}
