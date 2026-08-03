'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { MessageSquare } from 'lucide-react'
import { CondenseSettings } from './condense-settings'
import { DefaultModelsSettings } from '../components/default-models-settings'
import { ToolbarSettings as ChatToolbarSettings } from './toolbar-settings'

export default function ChatSettingsPage() {
  const t = useTranslations('settings.chat')

  return (
    <SettingType
      id="chat"
      title={t('title')}
      desc={t('desc')}
      icon={<MessageSquare className="size-4 lg:size-6" />}
    >
      <div className="space-y-4">
        <DefaultModelsSettings type="chat" />
        {/* 记录描述模型：仍被图片识别/记录描述功能使用，保留 */}
        <DefaultModelsSettings type="record" />
        <ChatToolbarSettings />
        <CondenseSettings />
      </div>
    </SettingType>
  )
}
