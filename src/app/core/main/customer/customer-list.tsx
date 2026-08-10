'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCustomerStore } from './customer-store'
import { getCustomerCascadeStats, type CustomerType } from '@/db/customers'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator as DropdownSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, Search, Users, Building2, User, Pin, PinOff, Trash2, MoreHorizontal, Pencil } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function CustomerList() {
  const t = useTranslations('customer')
  const customers = useCustomerStore((s) => s.customers)
  const currentCustomerId = useCustomerStore((s) => s.currentCustomerId)
  const loadCustomers = useCustomerStore((s) => s.loadCustomers)
  const createCustomer = useCustomerStore((s) => s.createCustomer)
  const selectCustomer = useCustomerStore((s) => s.selectCustomer)
  const removeCustomer = useCustomerStore((s) => s.removeCustomer)
  const renameCustomer = useCustomerStore((s) => s.renameCustomer)
  const togglePin = useCustomerStore((s) => s.togglePin)
  const initialized = useCustomerStore((s) => s.initialized)

  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  // 删除确认框中展示的级联清理统计（null 表示未加载或查询失败，此时文案不显示数字）
  const [deleteStats, setDeleteStats] = useState<{
    visits: number
    todos: number
    meetings: number
  } | null>(null)

  // 打开删除确认框时实时查询该客户的关联数据量；查询失败则降级为无数字文案
  useEffect(() => {
    if (!deleteTargetId) {
      setDeleteStats(null)
      return
    }
    let cancelled = false
    getCustomerCascadeStats(deleteTargetId)
      .then((stats) => {
        if (!cancelled) setDeleteStats(stats)
      })
      .catch((err) => {
        console.error('[CustomerList] 查询客户级联统计失败:', err)
        if (!cancelled) setDeleteStats(null)
      })
    return () => {
      cancelled = true
    }
  }, [deleteTargetId])

  // 新建客户对话框状态
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<CustomerType>('enterprise')
  const [newIndustry, setNewIndustry] = useState('')
  const [creating, setCreating] = useState(false)

  // 重命名客户对话框状态
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  // 打开重命名对话框时预填当前名称
  useEffect(() => {
    if (renameTargetId) {
      const target = customers.find((c) => c.id === renameTargetId)
      setRenameValue(target?.name || '')
    }
  }, [renameTargetId, customers])

  // 提交重命名：调用 store 级联（文件夹/库/会议导出路径），失败 toast
  const handleRenameSubmit = async () => {
    if (!renameTargetId || renaming) return
    setRenaming(true)
    try {
      await renameCustomer(renameTargetId, renameValue)
      setRenameTargetId(null)
    } catch (err) {
      toast({
        title: '重命名失败',
        description: err instanceof Error ? err.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setRenaming(false)
    }
  }

  useEffect(() => {
    if (!initialized) {
      loadCustomers()
    }
  }, [initialized, loadCustomers])

  // 按名称模糊过滤（客户量小，本地过滤即可）
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return customers
    return customers.filter((c) => c.name.toLowerCase().includes(query))
  }, [customers, searchQuery])

  const resetCreateForm = () => {
    setNewName('')
    setNewType('enterprise')
    setNewIndustry('')
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast({ description: t('nameRequired'), variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      await createCustomer({ name, type: newType, industry: newIndustry })
      setCreateOpen(false)
      resetCreateForm()
    } catch (err) {
      console.error('[CustomerList] 创建客户失败:', err)
      toast({ description: t('createFailed'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部新建按钮 */}
      <div className="p-2 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('newCustomer')}
        </Button>
      </div>

      {/* 搜索框 */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('searchCustomers')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* 客户列表（未初始化完成前不显示空态，避免首载闪烁"暂无客户"） */}
      <ScrollArea className="flex-1">
        {!initialized ? null : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Users className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">{t('noCustomers')}</p>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Search className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {t('noSearchResults')}
            </p>
          </div>
        ) : (
          <div className="p-1">
            {filteredCustomers.map((customer) => (
              <ContextMenu key={customer.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'group relative w-full text-left p-2.5 rounded-md transition-colors cursor-pointer',
                      'hover:bg-accent/50',
                      currentCustomerId === customer.id && 'bg-accent'
                    )}
                    onClick={() => selectCustomer(customer.id)}
                  >
                    <div className="flex items-center gap-2">
                      {customer.type === 'individual' ? (
                        <User className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium truncate flex-1">
                        {customer.name}
                      </span>
                      {!!customer.isPinned && (
                        <Pin className="w-3.5 h-3.5 shrink-0 text-primary" />
                      )}
                      {/* A4 菜单发现性：hover 显示「⋯」，菜单项与右键菜单一致；点击不触发选中 */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={t('pin')}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem onClick={() => togglePin(customer.id)}>
                            {customer.isPinned ? (
                              <>
                                <PinOff className="w-4 h-4 mr-2" />
                                {t('unpin')}
                              </>
                            ) : (
                              <>
                                <Pin className="w-4 h-4 mr-2" />
                                {t('pin')}
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRenameTargetId(customer.id)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTargetId(customer.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('deleteCustomer')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {customer.industry && (
                      <div className="text-sm text-muted-foreground mt-1 truncate">
                        {customer.industry}
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => togglePin(customer.id)}>
                    {customer.isPinned ? (
                      <>
                        <PinOff className="w-4 h-4 mr-2" />
                        {t('unpin')}
                      </>
                    ) : (
                      <>
                        <Pin className="w-4 h-4 mr-2" />
                        {t('pin')}
                      </>
                    )}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setRenameTargetId(customer.id)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTargetId(customer.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t('deleteCustomer')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* 新建客户对话框 */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('nameLabel')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('namePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t('typeLabel')}</Label>
              <RadioGroup
                value={newType}
                onValueChange={(v) => setNewType(v as CustomerType)}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="enterprise" id="type-enterprise" />
                  <Label htmlFor="type-enterprise" className="font-normal">
                    {t('typeEnterprise')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="individual" id="type-individual" />
                  <Label htmlFor="type-individual" className="font-normal">
                    {t('typeIndividual')}
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1">
              <Label>{t('industryLabel')}</Label>
              <Input
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                placeholder={t('industryPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmDesc', {
                name:
                  customers.find((c) => c.id === deleteTargetId)?.name ?? '',
              })}
            </AlertDialogDescription>
            {/* 级联清理说明：统计查询成功时带数字，失败时降级为无数字文案 */}
            <p className="text-sm text-muted-foreground">
              {deleteStats
                ? t('deleteConfirmCascade', deleteStats)
                : t('deleteConfirmCascadeNoStats')}
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                // removeCustomer 内部乐观删除 + 失败回滚，这里捕获错误提示
                if (deleteTargetId) {
                  try {
                    await removeCustomer(deleteTargetId)
                  } catch {
                    toast({ description: t('deleteFailed'), variant: 'destructive' })
                  }
                }
                setDeleteTargetId(null)
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重命名客户对话框：自动归类生成错误客户名时手动修正（联动文件夹/导出路径/知识库） */}
      <Dialog
        open={!!renameTargetId}
        onOpenChange={(open) => !open && setRenameTargetId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名客户</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>客户名称</Label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="输入新的客户名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !renaming) void handleRenameSubmit()
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              重命名会同步更新客户文件夹（含访前/访中/访后/资料）、已导出的纪要路径与知识库索引。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTargetId(null)}>
              取消
            </Button>
            <Button onClick={() => void handleRenameSubmit()} disabled={renaming || !renameValue.trim()}>
              {renaming ? '重命名中…' : '确认重命名'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
