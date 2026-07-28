'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { PenTool } from 'lucide-react'
import { DefaultModelsSettings } from '../components/default-models-settings'
import { ToolbarSettings } from './toolbar-settings'

export default function RecordSettingPage() {
  const t = useTranslations('settings.record')

  return (
    <SettingType
      id="record"
      icon={<PenTool className="size-4 lg:size-6" />}
      title={t('title')}
      desc={t('desc')}
    >
      <div className="space-y-8">
        <DefaultModelsSettings type="record" />
        <ToolbarSettings />
      </div>
    </SettingType>
  )
}
