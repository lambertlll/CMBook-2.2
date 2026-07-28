'use client'

import { useEffect, useMemo, useState } from 'react'
import { ContextMenuItem } from '@/components/ui/enhanced-context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Building2,
  FolderInput,
  ListTodo,
  LoaderCircle,
  Search,
  User,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { computedParentPath } from '@/lib/path'
import type { DirTree } from '@/stores/article'
import { useCustomerStore } from '@/app/core/main/customer/customer-store'
import {
  extractTodosFromNote,
  saveNoteToCustomerKnowledge,
} from '@/lib/note-to-customer'
import emitter from '@/lib/emitter'
import { cn } from '@/lib/utils'

// 两个右键动作共用一个客户选择框：archive 必选客户；extract 可选「不关联客户」
type PickerAction = 'archive' | 'extract'

/**
 * 笔记右键「归入客户知识库 / 提取待办」（2.3-C）：
 * 仅对本地 .md 笔记显示。菜单项只负责发事件（note-customer-picker），
 * 客户选择对话框由 NoteToCustomerPickerDialog 在右键菜单外渲染——
 * 若把 Dialog 放在 ContextMenuContent 内，菜单点击关闭会把对话框一起卸载（"闪退"）。
 */
export function NoteToCustomerMenu({ item }: { item: DirTree }) {
  const t = useTranslations('article.noteToCustomer')

  // 仅本地 .md 笔记可用（远程未下载/新建未命名/非 md 文件不显示）
  const isMarkdownNote =
    item.isFile && item.isLocale && item.name !== '' && /\.md$/i.test(item.name)

  if (!isMarkdownNote) return null

  return (
    <>
      <ContextMenuItem
        inset
        onClick={() => emitter.emit('note-customer-picker', { action: 'archive', item })}
        menuType="file"
      >
        <FolderInput className="mr-2 h-4 w-4" />
        {t('archiveToCustomer')}
      </ContextMenuItem>
      <ContextMenuItem
        inset
        onClick={() => emitter.emit('note-customer-picker', { action: 'extract', item })}
        menuType="file"
      >
        <ListTodo className="mr-2 h-4 w-4" />
        {t('extractTodos')}
      </ContextMenuItem>
    </>
  )
}

/**
 * 客户选择对话框（在文件侧边栏挂载，独立于右键菜单生命周期）。
 * 监听 note-customer-picker 事件打开；archive 归入知识库 / extract 提取待办。
 */
export function NoteToCustomerPickerDialog() {
  const t = useTranslations('article.noteToCustomer')
  const tCommon = useTranslations('common')
  const customers = useCustomerStore((s) => s.customers)
  const customersInitialized = useCustomerStore((s) => s.initialized)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)

  const [pickerAction, setPickerAction] = useState<PickerAction | null>(null)
  const [noteItem, setNoteItem] = useState<DirTree | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // 选中的客户 ID；extract 动作下空串表示「不关联客户」
  const [selectedId, setSelectedId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 监听右键菜单事件打开对话框（菜单此时已关闭，Dialog 生命周期不受影响）
  useEffect(() => {
    const handler = (payload?: unknown) => {
      const data = payload as { action?: PickerAction; item?: DirTree } | undefined
      if (!data?.action || !data.item) return
      setNoteItem(data.item)
      setSearchQuery('')
      setSelectedId('')
      setPickerAction(data.action)
    }
    emitter.on('note-customer-picker', handler)
    return () => {
      emitter.off('note-customer-picker', handler)
    }
  }, [])

  // 打开选择框时按需加载客户列表
  useEffect(() => {
    if (pickerAction !== null && !customersInitialized) {
      void loadCustomers()
    }
  }, [pickerAction, customersInitialized, loadCustomers])

  // 按名称模糊过滤（客户量小，本地过滤即可，与 customer-list 一致）
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return customers
    return customers.filter((c) => c.name.toLowerCase().includes(query))
  }, [customers, searchQuery])

  function closePicker() {
    setPickerAction(null)
  }

  async function handleConfirm() {
    if (!noteItem) return
    const notePath = computedParentPath(noteItem)

    if (pickerAction === 'archive') {
      const customer = customers.find((c) => c.id === selectedId)
      if (!customer) return
      setSubmitting(true)
      try {
        const result = await saveNoteToCustomerKnowledge(notePath, noteItem.name, {
          id: customer.id,
          name: customer.name,
          folderPath: customer.folderPath,
        })
        // embedding 未配置时文件已保存但未索引，提示"已保存，配置后可索引"
        toast({
          title:
            result.embeddingAvailable === false
              ? t('archiveSuccessNoIndex', { name: customer.name })
              : t('archiveSuccess', { name: customer.name }),
        })
        closePicker()
      } catch (err) {
        console.error('[NoteToCustomer] 归入客户知识库失败:', err)
        toast({ title: t('archiveFailed'), variant: 'destructive' })
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (pickerAction === 'extract') {
      setSubmitting(true)
      try {
        const result = await extractTodosFromNote({
          notePath,
          customerId: selectedId || undefined,
        })
        if (result.status === 'ai-not-configured') {
          toast({ title: t('aiNotConfigured'), variant: 'destructive' })
        } else if (result.status === 'ok') {
          toast({
            title:
              result.extracted > 0
                ? t('extractSuccess', { count: result.extracted })
                : t('extractEmpty'),
          })
          closePicker()
        } else {
          // read-failed / ai-failed（AI 错误 toast 已弹出，这里兜底提示）
          toast({ title: t('extractFailed'), variant: 'destructive' })
        }
      } finally {
        setSubmitting(false)
      }
    }
  }

  // archive 必须选中客户才能确认；extract 允许不关联客户（空串即"不关联"）
  const confirmDisabled =
    submitting || (pickerAction === 'archive' && !selectedId)

  return (
    <Dialog
      open={pickerAction !== null}
      onOpenChange={(open) => {
        if (!open) closePicker()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pickerAction === 'archive'
              ? t('pickerTitleArchive')
              : t('pickerTitleExtract')}
          </DialogTitle>
          <DialogDescription>
            {pickerAction === 'archive'
              ? t('pickerDescArchive')
              : t('pickerDescExtract')}
          </DialogDescription>
        </DialogHeader>

        {/* 搜索过滤 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
            autoFocus
          />
        </div>

        {/* 客户列表（extract 动作额外提供「不关联客户」） */}
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-0.5 p-0.5">
            {pickerAction === 'extract' && (
              <button
                type="button"
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md transition-colors cursor-pointer',
                  'hover:bg-accent/50',
                  selectedId === '' && 'bg-accent'
                )}
                onClick={() => setSelectedId('')}
              >
                <div className="flex items-center gap-2">
                  <ListTodo className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm truncate flex-1">
                    {t('noCustomer')}
                  </span>
                </div>
              </button>
            )}

            {!customersInitialized ? null : customers.length === 0 ? (
              // 无客户时提示先去客户 Tab 新建
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <Users className="w-8 h-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('noCustomers')}
                </p>
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <Search className="w-8 h-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('noSearchResults')}
                </p>
              </div>
            ) : (
              filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className={cn(
                    'w-full text-left px-2.5 py-2 rounded-md transition-colors cursor-pointer',
                    'hover:bg-accent/50',
                    selectedId === customer.id && 'bg-accent'
                  )}
                  onClick={() => setSelectedId(customer.id)}
                >
                  <div className="flex items-center gap-2">
                    {customer.type === 'individual' ? (
                      <User className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm truncate flex-1">
                      {customer.name}
                    </span>
                  </div>
                  {customer.industry && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate pl-6">
                      {customer.industry}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={closePicker}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={confirmDisabled}>
            {submitting && (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            )}
            {tCommon('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
