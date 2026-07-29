'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LayoutTemplate, FileText, Plus, Pencil, Trash2 } from 'lucide-react'
import useSettingStore, { type CustomMeetingTemplate } from '@/stores/setting'
import { toast } from '@/hooks/use-toast'

/**
 * 周报自定义模板管理：列表 + 新建/编辑 Dialog + 删除确认。
 * 模板存 setting store（store.json），AI 生成周报时可选择模板。
 */
export function ReportTemplateManager() {
  const t = useTranslations('settings.report.customTemplates')
  const customReportTemplates = useSettingStore((s) => s.customReportTemplates)
  const addCustomReportTemplate = useSettingStore((s) => s.addCustomReportTemplate)
  const updateCustomReportTemplate = useSettingStore((s) => s.updateCustomReportTemplate)
  const removeCustomReportTemplate = useSettingStore((s) => s.removeCustomReportTemplate)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CustomMeetingTemplate | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CustomMeetingTemplate | null>(null)

  const openNew = () => {
    setEditing(null)
    setName('')
    setPrompt('')
    setDialogOpen(true)
  }

  const openEdit = (tpl: CustomMeetingTemplate) => {
    setEditing(tpl)
    setName(tpl.name)
    setPrompt(tpl.prompt)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedName || !trimmedPrompt) {
      toast({ description: t('invalidToast'), variant: 'destructive' })
      return
    }
    if (editing) {
      await updateCustomReportTemplate(editing.id, { name: trimmedName, prompt: trimmedPrompt })
    } else {
      await addCustomReportTemplate({ name: trimmedName, prompt: trimmedPrompt })
    }
    setDialogOpen(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await removeCustomReportTemplate(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <>
      <Item variant="outline">
        <ItemMedia variant="icon"><LayoutTemplate className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('title')}</ItemTitle>
          <ItemDescription>{t('desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm" onClick={openNew}>
            <Plus className="size-4 mr-1" />
            {t('add')}
          </Button>
        </ItemActions>
      </Item>

      {customReportTemplates.map((tpl) => (
        <Item variant="outline" key={tpl.id}>
          <ItemMedia variant="icon"><FileText className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{tpl.name}</ItemTitle>
            <ItemDescription className="line-clamp-1">{tpl.prompt}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="ghost" size="icon" onClick={() => openEdit(tpl)} aria-label={t('edit')}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(tpl)} aria-label={t('delete')}>
              <Trash2 className="size-4" />
            </Button>
          </ItemActions>
        </Item>
      ))}

      {/* 新建/编辑模板 Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialogTitleEdit') : t('dialogTitleNew')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm">{t('nameLabel')}</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm">{t('promptLabel')}</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                className="min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground">{t('promptHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDesc', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
