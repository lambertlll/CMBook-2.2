'use client'

import { Button } from "@/components/ui/button"
import { FormItem } from "../components/setting-base"
import useSettingStore from "@/stores/setting"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"
import { useTranslations } from 'next-intl'
import { FolderOpen, History, HardDrive } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { ChevronDown } from "lucide-react"

export function SettingDataStorage() {
  const { dataStoragePath, setDataStoragePath } = useSettingStore()
  const t = useTranslations('settings.file')
  const [open, setOpen] = useState(false)

  async function handleSelectStorage() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('storage.select')
      })

      if (selected) {
        const path = selected as string
        // 确保目录存在
        const existsFlag = await exists(path)
        if (!existsFlag) {
          await mkdir(path, { recursive: true })
        }
        await setDataStoragePath(path)
      }
    } catch (error) {
      console.error('选择数据存储路径失败:', error)
    }
  }

  async function handleResetStorage() {
    try {
      // 确保默认目录存在
      const existsFlag = await exists('meetings', { baseDir: BaseDirectory.AppData })
      if (!existsFlag) {
        await mkdir('meetings', { baseDir: BaseDirectory.AppData, recursive: true })
      }
      await setDataStoragePath('')
    } catch (error) {
      console.error('重置数据存储路径失败:', error)
    }
  }

  return (
    <FormItem
      title={t('storage.current')}
      desc={t('storage.desc')}
    >
      <div className="space-y-3">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between p-3 h-auto text-left font-normal"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <HardDrive className="w-4 h-4 flex-shrink-0" />
                <span className="truncate text-sm">
                  {dataStoragePath || t('storage.default')}
                </span>
              </div>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder={t('storage.searchPlaceholder')} />
              <CommandList>
                <CommandEmpty>{t('workspace.noResults')}</CommandEmpty>

                <CommandGroup heading={t('workspace.actions')}>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false)
                      handleSelectStorage()
                    }}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t('storage.select')}
                  </CommandItem>
                  {dataStoragePath && (
                    <CommandItem
                      onSelect={() => {
                        setOpen(false)
                        handleResetStorage()
                      }}
                    >
                      <History className="mr-2 h-4 w-4" />
                      {t('storage.reset')}
                    </CommandItem>
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </FormItem>
  )
}
