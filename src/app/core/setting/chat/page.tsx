'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { MessageSquare } from 'lucide-react'
import { CondenseSettings } from './condense-settings'
import { DefaultModelsSettings } from '../components/default-models-settings'
import { ToolbarSettings as ChatToolbarSettings } from './toolbar-settings'
import { ToolbarSettings as RecordToolbarSettings } from '../record/toolbar-settings'

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
        <DefaultModelsSettings type="record" />
        <ChatToolbarSettings />
        <RecordToolbarSettings />
        <CondenseSettings />
      </div>
    </SettingType>
  )
}
