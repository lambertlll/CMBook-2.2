'use client'

import { useTodoConfirmStore } from '@/stores/todo-confirm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, CheckCheck, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * 待办确认弹窗：纪要生成成功后弹出（由用户在会议纪要页手动触发），
 * 展示从纪要中解析的待办事项。用户可勾选/取消、编辑每条待办内容与负责人 →
 * 确认后选中项以 confirmed=1 写入（直接进入正式分组），
 * 未选中项以 confirmed=0 写入（进入"待确认"区）。点击"全部跳过"则全部以 confirmed=0 写入。
 */
export function TodoConfirmDialog() {
  const t = useTranslations('todos')
  const open = useTodoConfirmStore((s) => s.open)
  const todos = useTodoConfirmStore((s) => s.todos)
  const selected = useTodoConfirmStore((s) => s.selected)
  const meetingTitle = useTodoConfirmStore((s) => s.meetingTitle)
  const toggle = useTodoConfirmStore((s) => s.toggle)
  const toggleAll = useTodoConfirmStore((s) => s.toggleAll)
  const updateTodoContent = useTodoConfirmStore((s) => s.updateTodoContent)
  const updateTodoOwner = useTodoConfirmStore((s) => s.updateTodoOwner)
  const confirm = useTodoConfirmStore((s) => s.confirm)
  const skip = useTodoConfirmStore((s) => s.skip)
  const close = useTodoConfirmStore((s) => s.close)
  const [processing, setProcessing] = useState(false)

  const selectedCount = selected.filter(Boolean).length
  const allSelected = selected.length > 0 && selected.every(Boolean)

  const handleConfirm = async () => {
    setProcessing(true)
    try {
      await confirm()
    } catch (err) {
      console.error('[TodoConfirmDialog] 确认待办失败:', err)
    } finally {
      setProcessing(false)
    }
  }

  const handleSkip = async () => {
    setProcessing(true)
    try {
      await skip()
    } catch (err) {
      console.error('[TodoConfirmDialog] 跳过待办失败:', err)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !processing && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCheck className="h-5 w-5 text-primary" />
            {t('confirmDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('confirmDialogDesc', { title: meetingTitle, count: todos.length })}
          </DialogDescription>
        </DialogHeader>

        {/* 全选/取消全选 */}
        <div className="flex items-center gap-2 pb-1">
          <Checkbox
            id="todo-select-all"
            checked={allSelected}
            onCheckedChange={(v) => toggleAll(!!v)}
          />
          <label
            htmlFor="todo-select-all"
            className="cursor-pointer text-sm text-muted-foreground select-none"
          >
            {allSelected ? t('deselectAll') : t('selectAll')}
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            {t('selectedCount', { selected: selectedCount, total: todos.length })}
          </span>
        </div>

        <ScrollArea className="max-h-[350px] rounded-md border">
          <div className="p-1">
            {todos.map((todo, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent/60',
                  !selected[i] && 'opacity-50'
                )}
              >
                <Checkbox
                  checked={selected[i]}
                  onCheckedChange={() => toggle(i)}
                  className="mt-1.5 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <Input
                    value={todo.content}
                    onChange={(e) => updateTodoContent(i, e.target.value)}
                    className="h-7 text-sm"
                    placeholder={t('todoContentPlaceholder')}
                  />
                  <Input
                    value={todo.owner || ''}
                    onChange={(e) => updateTodoOwner(i, e.target.value)}
                    className="h-6 text-xs text-muted-foreground"
                    placeholder={t('ownerPlaceholder')}
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={processing}
          >
            {processing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <SkipForward className="w-4 h-4 mr-1" />}
            {t('skipAll')}
          </Button>
          <Button onClick={handleConfirm} disabled={processing}>
            {processing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCheck className="w-4 h-4 mr-1" />}
            {t('confirmSelected', { count: selectedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
