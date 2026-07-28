'use client'
import { ThemeSettings } from './theme'
import { ThemeStyleSettings } from './theme-style-settings'
import { DisplayNameSettings } from './display-name-settings'
import { LanguageSettings } from './language'
import { FontFamilySettings } from './font-family'
import { ScaleSettings } from './scale'
import { ContentTextScaleSettings } from './content-text-scale'
import { FileManagerTextSizeSettings } from './file-manager-text-size'
import { RecordTextSizeSettings } from './record-text-size'
import { CustomThemeSettings } from './custom-theme'

export function InterfaceSettings() {

  return (
    <div className="flex flex-col gap-4">
      <ThemeStyleSettings />
      <DisplayNameSettings />
      <ThemeSettings />
      <LanguageSettings />
      <FontFamilySettings />
      <ScaleSettings />
      <ContentTextScaleSettings />
      <FileManagerTextSizeSettings />
      <RecordTextSizeSettings />
      <CustomThemeSettings />
    </div>
  )
}
