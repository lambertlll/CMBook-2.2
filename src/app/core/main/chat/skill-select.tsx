import * as React from "react"
import { useTranslations } from "next-intl"
import { Sparkles } from "lucide-react"
import { useSkillsStore } from "@/stores/skills"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { TooltipButton } from "@/components/tooltip-button"

interface SkillSelectProps {
  /** 点击技能后回调：把技能触发指令注入对话（由 ChatInput 传入，走 sendChat） */
  onInvokeSkill?: (skillId: string, skillName: string) => void
}

/**
 * 对话工具栏的「技能」入口：列出当前可调用的技能（内置 + 用户安装），
 * 点击即可把技能调用指令注入对话，解决技能"找不到/不知道有什么"的可发现性问题。
 * 数据源复用 useSkillsStore（skillManager 已加载全部技能）。
 */
export function SkillSelect({ onInvokeSkill }: SkillSelectProps) {
  const t = useTranslations('record.chat.input.skillSelect')
  const [open, setOpen] = React.useState(false)
  const [loaded, setLoaded] = React.useState<{ id: string; name: string; description?: string }[]>([])

  // 打开时拉取当前可调用的技能（初始化可能未完成，异步等待）
  const refreshSkills = async () => {
    const store = useSkillsStore.getState()
    if (!store.initialized) {
      await store.initSkills()
    }
    const skills = store.getUserInvocableSkills()
    setLoaded(
      skills.map((s) => ({
        id: s.metadata.id,
        name: s.metadata.name || s.metadata.id,
        description: s.metadata.description,
      }))
    )
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void refreshSkills()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className="hidden md:block">
          <TooltipButton
            icon={<Sparkles />}
            tooltipText={t('tooltip')}
            size="icon"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandGroup heading={t('groupLabel')}>
              {loaded.length === 0 && (
                <CommandItem disabled value="__empty__" className="text-muted-foreground">
                  {t('empty')}
                </CommandItem>
              )}
              {loaded.map((skill) => (
                <CommandItem
                  key={skill.id}
                  value={`${skill.name} ${skill.description || ''}`}
                  onSelect={() => {
                    setOpen(false)
                    onInvokeSkill?.(skill.id, skill.name)
                  }}
                >
                  <span className="truncate">{skill.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
