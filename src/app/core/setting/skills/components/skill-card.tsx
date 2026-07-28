'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, Trash, Loader2, Edit2 } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { Textarea } from '@/components/ui/textarea'
import { SkillMetadata } from '@/lib/skills/types'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface SkillCardProps {
  skill: SkillMetadata
  onRefresh: () => void
}

export function SkillCard({ skill, onRefresh }: SkillCardProps) {
  const t = useTranslations('settings.skills')
  const tc = useTranslations('common')
  const { getSkill, updateSkillInstructions, deleteSkill } = useSkillsStore()
  // 内置 Skill（存在 .builtin 标记）：显示"内置"徽章、隐藏删除按钮、禁用指令编辑
  // （内置 Skill 的修改会在重启后被安装流程还原，为避免误导用户直接禁用编辑）
  const isBuiltin = useSkillsStore((s) => s.builtinSkillIds.includes(skill.id))

  const [instructions, setInstructions] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()

  const skillContent = getSkill(skill.id)

  // 初始化指令内容
  useEffect(() => {
    if (skillContent) {
      setInstructions(skillContent.instructions)
    }
  }, [skillContent])

  // 自动保存
  useEffect(() => {
    if (hasChanges && isEditing) {
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // 设置新的定时器，1秒后保存
      saveTimeoutRef.current = setTimeout(async () => {
        await handleSave()
      }, 1000)

      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
      }
    }
  }, [instructions, hasChanges, isEditing])

  const handleDelete = async () => {
    try {
      await deleteSkill(skill.id)
      onRefresh()
    } catch (error) {
      console.error('Failed to delete skill:', error)
    }
  }

  const handleSave = async () => {
    if (!hasChanges) return

    try {
      setIsSaving(true)
      await updateSkillInstructions(skill.id, instructions)
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save instructions:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleInstructionsChange = (value: string) => {
    setInstructions(value)
    setHasChanges(true)
  }

  const handleToggleEdit = () => {
    setIsEditing(!isEditing)
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <CardTitle className="text-lg">{skill.name}</CardTitle>
            {isBuiltin && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t('builtinBadge')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isBuiltin ? (
              // 内置 Skill 禁用编辑：disabled 按钮不触发 pointer 事件，
              // 需要套一层 span 才能让 tooltip 正常显示
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled
                      >
                        <Edit2 className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('builtinEditDisabled')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={handleToggleEdit}
              >
                <Edit2 className="size-4" />
              </Button>
            )}
            {!isBuiltin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                  <Trash className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('deleteSkillTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('deleteSkillDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    {tc('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-2 truncate">
          {skill.description}
        </p>
      </CardHeader>
      <CardContent>
        {/* 指令编辑器 - 只在编辑模式下显示 */}
        {skillContent && isEditing && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t('instructions')}:
              </p>
              <div className="flex items-center gap-2">
                {hasChanges && (
                  <span className="text-xs text-muted-foreground">
                    {tc('unsaved')}
                  </span>
                )}
                {isSaving && (
                  <div className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    <span className="text-xs text-muted-foreground">
                      {tc('saving')}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <Textarea
              value={instructions}
              onChange={(e) => handleInstructionsChange(e.target.value)}
              className="min-h-40 max-h-96 font-mono text-sm resize-y"
              placeholder={t('instructionsPlaceholder')}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
