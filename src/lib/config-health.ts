import useSettingStore from '@/stores/setting'
import { resolveModelConfig } from '@/app/core/main/meeting/meeting-model-config'

/**
 * 配置健康检查（2.1 评审改进③：A3 生成预检与 D3 设置页横幅共用）。
 * 三项核心配置：聊天主模型 / 知识库学习模型（embedding）/ 联网搜索 key。
 * 本函数做"配置级"检查（是否已填写且可解析，不发 API 请求）；
 * 需要"真实可用性"验证的场景（如生成预检的 embedding 试算）在调用方另行补充。
 */
export interface ConfigHealthItem {
  key: 'chatModel' | 'embeddingModel' | 'webSearch'
  ok: boolean
  /** 未配时的"去配置"跳转目标（设置页完整路径） */
  target: '/core/setting/chat' | '/core/setting/rag' | '/core/setting/websearch'
}

/**
 * 返回三项核心配置的状态列表（含已配/未配与跳转目标）
 * 主模型与 embedding 做"可解析性"校验：不仅非空，且能通过 resolveModelConfig
 * 在 aiModelList 中命中（防止指向已删除供应商/无 baseURL 的模型仍显示"已配置"）
 */
export function getConfigHealthStatus(): ConfigHealthItem[] {
  const settings = useSettingStore.getState()

  const primaryResolved = resolveModelConfig(settings.primaryModel)
  const embeddingResolved = resolveModelConfig(settings.embeddingModel)

  return [
    {
      // 聊天主模型：在"对话设置"页的默认模型区块配置
      key: 'chatModel',
      ok:
        (settings.primaryModel ?? '').trim().length > 0 &&
        !!primaryResolved &&
        !!primaryResolved.baseURL &&
        !!primaryResolved.apiKey,
      target: '/core/setting/chat',
    },
    {
      // 知识库学习模型（embedding）：在"知识库"页的模型区块配置
      key: 'embeddingModel',
      ok:
        (settings.embeddingModel ?? '').trim().length > 0 &&
        !!embeddingResolved &&
        !!embeddingResolved.baseURL &&
        !!embeddingResolved.apiKey,
      target: '/core/setting/rag',
    },
    {
      // 联网搜索：启用且当前 provider 的 key 非空（内存解密态，不落盘）
      key: 'webSearch',
      ok:
        settings.webSearchEnabled &&
        (settings.webSearchApiKeys?.[settings.webSearchProvider]?.trim().length ??
          0) > 0,
      target: '/core/setting/websearch',
    },
  ]
}
