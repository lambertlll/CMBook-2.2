"use client"
import * as React from "react"
import { Eraser } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
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
} from "@/components/ui/alert-dialog"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

/**
 * 清空当前标签下全部对话。加入二次确认，避免误触一键删除全部聊天记录。
 */
export function ClearChat() {
  const { clearChats } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations()
  const [open, setOpen] = React.useState(false)

  function confirmClear() {
    clearChats(currentTagId)
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <div>
          <TooltipButton icon={<Eraser />} tooltipText={t('record.chat.input.clearChat')} side="bottom" />
        </div>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('record.chat.input.clearChat')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('record.chat.input.clearChatConfirm')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={confirmClear}>
            {t('record.chat.input.clearChat')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
