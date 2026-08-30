"use client"
import {
  LoaderCircle,
  BookA,
} from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useVectorStore from "@/stores/vector"
import { useTranslations } from "next-intl"

export function FileToolbar() {
  const { processAllDocuments, isProcessing } = useVectorStore()
  const t = useTranslations('article.file.toolbar')

  return (
    <div className="flex items-center h-12 border-b px-2">
      {/* 向量数据库 */}
      <TooltipButton
        icon={isProcessing ? <LoaderCircle className="animate-spin size-4" /> : <BookA className="text-primary" />}
        tooltipText={isProcessing ? t('processingVectors') : t('calculateVectors')}
        onClick={processAllDocuments}
        disabled={isProcessing}
      />
    </div>
  )
}
