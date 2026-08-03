import * as React from "react"
import { useEffect, useState } from "react"
import { AiConfig, ModelConfig } from "../../setting/config"
import { Store } from "@tauri-apps/plugin-store"
import useSettingStore from "@/stores/setting"
import { ChevronsUpDown, X } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"

interface GroupedModel {
  configKey: string
  configTitle: string
  model: ModelConfig
}

export function ModelSelect({
  modelKey,
  emptyLabel,
  clearTooltip,
}: {
  modelKey: string
  emptyLabel?: string
  clearTooltip?: string
}) {
  const [groupedModels, setGroupedModels] = useState<GroupedModel[]>([])
  const { setCompletionModel, setCommitModel, setMarkDescModel, setPrimaryModel, setImageMethodModel, setAudioModel, setSttModel, setEmbeddingModel, setRerankingModel, setCondenseModel, setInspirationModel, setReportModel } = useSettingStore()
  const [model, setModel] = useState<string>('')
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('settings.defaultModel')

  // 获取正确的存储键名
  function getStoreKey(modelKey: string): string {
    switch (modelKey) {
      case 'primaryModel':
        return 'primaryModel'
      case 'imageMethod':
        return 'imageMethodModel'
      case 'completion':
        return 'completionModel'
      case 'markDesc':
        return 'markDescModel'
      case 'audio':
      case 'tts':
        return 'audioModel'
      case 'stt':
        return 'sttModel'
      case 'embedding':
        return 'embeddingModel'
      case 'reranking':
        return 'rerankingModel'
      case 'condense':
        return 'condenseModel'
      case 'inspiration':
        return 'inspirationModel'
      case 'report':
        return 'reportModel'
      case 'commit':
        return 'commitModel'
      default:
        return `${modelKey}Model`
    }
  }

  function setPrimaryModelHandler(primaryModel: string) {
    setModel(primaryModel)
    switch (modelKey) {
      case 'primaryModel':
        setPrimaryModel(primaryModel)
        break;
      case 'imageMethod':
        setImageMethodModel(primaryModel)
        break;
      case 'completion':
        setCompletionModel(primaryModel)
        break;
      case 'markDesc':
        setMarkDescModel(primaryModel)
        break;
      case 'audio':
      case 'tts':
        setAudioModel(primaryModel)
        break;
      case 'stt':
        setSttModel(primaryModel)
        break;
      case 'embedding':
        setEmbeddingModel(primaryModel)
        break;
      case 'reranking':
        setRerankingModel(primaryModel)
        break;
      case 'condense':
        setCondenseModel(primaryModel)
        break;
      case 'inspiration':
        setInspirationModel(primaryModel)
        break
      case 'report':
        setReportModel(primaryModel)
        break;
      case 'commit':
        setCommitModel(primaryModel)
        break;
      default:
        break;
    }
  }

  // 获取需要过滤的模型类型
  function getTargetModelType(modelKey: string): string {
    switch (modelKey) {
      case 'embedding':
        return 'embedding'
      case 'reranking':
        return 'rerank'
      case 'audio':
      case 'tts':
        return 'tts'
      case 'stt':
        return 'stt'
      default:
        return 'chat'
    }
  }

  async function initModelList() {
    const store = await Store.load('store.json');
    const aiConfigs = await store.get<AiConfig[]>('aiModelList')
    if (!aiConfigs) return
    const models: GroupedModel[] = []
    const targetModelType = getTargetModelType(modelKey)
    
    aiConfigs.forEach(config => {
      // 检查配置是否有效
      if (!config.baseURL) return
      
      // 处理新的 models 数组结构
      if (config.models && config.models.length > 0) {
        config.models.forEach(model => {
          // 根据modelKey过滤对应类型的模型
          if (model.modelType === targetModelType && model.model) {
            models.push({
              configKey: config.key,
              configTitle: config.title,
              model,
            })
          }
        })
      } else {
        // 向后兼容：处理旧的单模型结构
        const configModelType = config.modelType || 'chat'
        if (configModelType === targetModelType && config.model) {
          models.push({
            configKey: config.key,
            configTitle: config.title,
            model: {
              id: config.key,
              model: config.model,
              modelType: configModelType,
              temperature: config.temperature,
              topP: config.topP,
              voice: config.voice,
              enableStream: config.enableStream
            }
          })
        }
      }
    })

    setGroupedModels(models)
    
    const storeKey = getStoreKey(modelKey)
    const primaryModel = await store.get<string>(storeKey)
    if (!primaryModel) return
    setPrimaryModelHandler(primaryModel)
  }

  async function modelSelectChangeHandler(e: string) {
    setPrimaryModelHandler(e)
    const store = await Store.load('store.json');
    const storeKey = getStoreKey(modelKey)
    store.set(storeKey, e)
    await store.save()
  }

  async function resetDefaultModel() {
    const store = await Store.load('store.json');
    const storeKey = getStoreKey(modelKey)
    store.set(storeKey, '')
    await store.save()
    setPrimaryModelHandler('')
  }

  // 检查模型是否被选中（支持向后兼容）
  const isModelSelected = (item: GroupedModel): boolean => {
    if (!model) return false
    
    return model === item.model.id || model === `${item.configKey}-${item.model.id}`
  }

  // 查找当前选中的模型显示信息
  const findSelectedModelDisplay = () => {
    if (!model || !groupedModels.length) return null
    
    // 首先尝试精确匹配（新格式的组合键）
    const selectedItem = groupedModels.find(isModelSelected)
    
    if (selectedItem) {
      return `${selectedItem.model.model}(${selectedItem.configTitle})`
    }
    
    return null
  }

  // 按配置分组模型
  const groupedByConfig = groupedModels.reduce((acc, item) => {
    if (!acc[item.configTitle]) {
      acc[item.configTitle] = []
    }
    acc[item.configTitle].push(item)
    return acc
  }, {} as Record<string, GroupedModel[]>)

  useEffect(() => {
    initModelList()
  }, [])
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex gap-2">
        <PopoverTrigger asChild>
          <div className="flex-1 overflow-hidden">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[280px] justify-between"
            >
              {model
                ? findSelectedModelDisplay() || model
                : emptyLabel || (modelKey === 'primaryModel' ? t('noModel') : t('tooltip'))}
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </div>
        </PopoverTrigger>
        <TooltipButton
          disabled={!model}
          icon={<X className="h-4 w-4" />}
          onClick={resetDefaultModel}
          variant="default"
          tooltipText={clearTooltip || t('tooltip')}
        />
      </div>
      <PopoverContent align="end" className="p-0">
        <Command>
          <CommandInput placeholder={t('placeholder')} className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {Object.entries(groupedByConfig).map(([configTitle, models]) => (
              <CommandGroup key={configTitle} heading={configTitle}>
                {models.map((item) => (
                  <CommandItem
                    key={item.model.id}
                    value={item.model.id}
                    onSelect={(currentValue) => {
                      modelSelectChangeHandler(currentValue)
                      setOpen(false)
                    }}
                  >
                    {item.model.model}
                    <Check
                      className={cn(
                        "ml-auto",
                        isModelSelected(item) ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
