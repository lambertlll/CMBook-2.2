import useSettingStore from '@/stores/setting'
import type { AiConfig } from '@/app/core/setting/config'

/**
 * 解析指定模型或 primaryModel 对应的 AI 配置
 */
export function resolveModelConfig(modelId?: string): AiConfig | undefined {
  const { aiModelList, primaryModel } = useSettingStore.getState()
  const targetModelId = modelId || primaryModel

  if (!targetModelId || !aiModelList) return undefined

  for (const config of aiModelList) {
    if (config.models && config.models.length > 0) {
      // 先直接匹配
      let targetModel = config.models.find((model) => model.id === targetModelId)

      // 尝试组合键格式 ${config.key}-${model.id}
      if (!targetModel && targetModelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (targetModelId.startsWith(expectedPrefix)) {
          const originalModelId = targetModelId.substring(expectedPrefix.length)
          targetModel = config.models.find((model) => model.id === originalModelId)
        }
      }

      if (targetModel) {
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          enableStream: targetModel.enableStream,
          maxTokens: targetModel.maxTokens,
          tokenLimitParam: targetModel.tokenLimitParam,
        }
      }
    } else {
      // 向后兼容旧结构
      if (config.key === targetModelId) {
        return config
      }
    }
  }

  return undefined
}
