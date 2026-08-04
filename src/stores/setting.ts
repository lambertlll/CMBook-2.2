import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { AiConfig } from '@/app/core/setting/config'
import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import { GiteaInstanceType } from '@/lib/sync/gitea.types'
import { CustomThemeColors } from '@/types/theme'
import { applyThemeColors, removeThemeColors } from '@/lib/theme-utils'
import { getNormalizedImageHosting } from '@/lib/image-hosting-config'
import { normalizeSpeechMode } from '@/lib/speech/preferences'
import type { SpeechMode } from '@/lib/speech/types'
import { enqueueAutoDataSync, isAutoDataSyncApplyingRemote } from '@/lib/sync/auto-data-sync-queue'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai/system-prompt'
import { APP_FONT_SYSTEM_VALUE, applyAppFontFamily } from '@/lib/font-settings'
import { encryptSecret, decryptSecret } from './credential-crypto'

export enum GenTemplateRange {
  All = 'all',
  Today = 'today',
  Week = 'week',
  Month = 'month',
  ThreeMonth = 'threeMonth',
  Year = 'year',
}

export interface GenTemplate {
  id: string
  title: string
  status: boolean
  content: string
  range: GenTemplateRange
}

// 自定义会议纪要模板：id 以 custom- 前缀生成，name/prompt 均必填，JSON 数组持久化到 store.json
export interface CustomMeetingTemplate {
  id: string
  name: string
  prompt: string
}

interface SettingState {
  initSettingData: () => Promise<void>

  version: string
  setVersion: () => Promise<void>

  language: string
  setLanguage: (language: string) => void

  appFontFamily: string
  setAppFontFamily: (fontFamily: string) => Promise<void>

  // setting - ai - 当前选择的模型 key
  currentAi: string
  setCurrentAi: (currentAi: string) => void

  aiModelList: AiConfig[]
  setAiModelList: (aiModelList: AiConfig[]) => void

  primaryModel: string
  setPrimaryModel: (primaryModel: string) => Promise<void>

  completionModel: string
  setCompletionModel: (completionModel: string) => Promise<void>

  markDescModel: string
  setMarkDescModel: (markDescModel: string) => Promise<void>

  commitModel: string
  setCommitModel: (commitModel: string) => Promise<void>

  embeddingModel: string
  setEmbeddingModel: (embeddingModel: string) => Promise<void>

  rerankingModel: string
  setRerankingModel: (rerankingModel: string) => Promise<void>

  imageMethodModel: string
  setImageMethodModel: (imageMethodModel: string) => Promise<void>

  audioModel: string
  setAudioModel: (audioModel: string) => Promise<void>

  sttModel: string
  setSttModel: (sttModel: string) => Promise<void>
  sttEngine: 'openai-compatible' | 'aliyun' // STT 引擎
  setSttEngine: (engine: 'openai-compatible' | 'aliyun') => Promise<void>
  aliyunAsrApiKey: string
  setAliyunAsrApiKey: (key: string) => Promise<void>
  aliyunAsrWorkspaceId: string
  setAliyunAsrWorkspaceId: (id: string) => Promise<void>
  // 阿里云 ASR：自定义热词（每行一个或逗号分隔，非敏感信息明文存储）
  aliyunAsrHotwords: string
  setAliyunAsrHotwords: (hotwords: string) => Promise<void>
  // 阿里云 ASR：说话人分离（默认开启）
  aliyunAsrDiarization: boolean
  setAliyunAsrDiarization: (enabled: boolean) => Promise<void>
  // 阿里云 ASR：识别模型（默认 qwen3-asr-flash-realtime 真流式 / fun-asr / qwen3-asr-flash 切块 / paraformer-v2 / qwen-audio-3.0-asr-flash 系列）
  aliyunAsrModel: 'fun-asr' | 'qwen3-asr-flash' | 'paraformer-v2' | 'qwen3-asr-flash-realtime' | 'qwen-audio-3.0-asr-flash' | 'qwen-audio-3.0-asr-flash-streaming'
  setAliyunAsrModel: (model: 'fun-asr' | 'qwen3-asr-flash' | 'paraformer-v2' | 'qwen3-asr-flash-realtime' | 'qwen-audio-3.0-asr-flash' | 'qwen-audio-3.0-asr-flash-streaming') => Promise<void>

  // 会议纪要：生成前用手动笔记校正转写（默认开启）
  meetingTranscriptCorrection: boolean
  setMeetingTranscriptCorrection: (enabled: boolean) => Promise<void>
  // 会议纪要：生成后对照手动笔记做覆盖度自检（默认关闭）
  meetingCoverageCheck: boolean
  setMeetingCoverageCheck: (enabled: boolean) => Promise<void>

  // 会议纪要：录音时实时转写预览（仅阿里云 qwen3-asr-flash / qwen3-asr-flash-realtime 生效，默认开启）
  meetingLiveTranscript: boolean
  setMeetingLiveTranscript: (enabled: boolean) => Promise<void>

  // 会议纪要：结束后自动补充说话人标注（仅 qwen3-asr-flash-realtime 生效，默认关闭；
  // 开启后结束录音时用 fun-asr + 说话人分离重转写，替换实时转写文本）
  meetingAutoDiarize: boolean
  setMeetingAutoDiarize: (enabled: boolean) => Promise<void>

  // 会议纪要：自定义纪要模板（与内置模板一起在模板下拉中选择）
  customMeetingTemplates: CustomMeetingTemplate[]
  setCustomMeetingTemplates: (templates: CustomMeetingTemplate[]) => Promise<void>
  addCustomMeetingTemplate: (template: Omit<CustomMeetingTemplate, 'id'>) => Promise<CustomMeetingTemplate>
  updateCustomMeetingTemplate: (id: string, patch: Partial<Omit<CustomMeetingTemplate, 'id'>>) => Promise<void>
  removeCustomMeetingTemplate: (id: string) => Promise<void>

  // 联网搜索（web_search / web_fetch 工具）：
  // API Key 不落本 store 的持久化字段——在 store.json 中以 webSearchApiKey.<provider> 单独加密存储，
  // 内存态 webSearchApiKeys 保存解密值（与 aliyunAsrApiKey 同一模式）；
  // webSearchApiKeys 已在 sync-exclusions 中无条件排除，任何情况下都不会写回 store.json 或上传同步
  webSearchEnabled: boolean
  setWebSearchEnabled: (enabled: boolean) => Promise<void>
  webSearchProvider: 'tavily' | 'bocha'
  setWebSearchProvider: (provider: 'tavily' | 'bocha') => Promise<void>
  webSearchApiKeys: Record<'tavily' | 'bocha', string>
  setWebSearchApiKey: (provider: 'tavily' | 'bocha', key: string) => Promise<void>
  // 各 provider 的自定义 baseURL（留空用官方默认，供后续接入行内统一搜索网关）
  webSearchBaseUrls: Record<'tavily' | 'bocha', string>
  setWebSearchBaseUrl: (provider: 'tavily' | 'bocha', baseUrl: string) => Promise<void>
  webSearchMaxResults: number
  setWebSearchMaxResults: (count: number) => Promise<void>
  webSearchTimeoutMs: number
  setWebSearchTimeoutMs: (ms: number) => Promise<void>

  // 待办到期系统提醒（B2-7）：总开关，默认 true；关闭时 todo-notify 完全跳过检查与通知
  notifyTodoEnabled: boolean
  setNotifyTodoEnabled: (enabled: boolean) => Promise<void>

  // 首页欢迎条称呼（2.1）：用户自定义名字，空串时按界面语言显示产品名
  userDisplayName: string
  setUserDisplayName: (name: string) => Promise<void>

  textToSpeechMode: SpeechMode
  setTextToSpeechMode: (mode: SpeechMode) => Promise<void>

  speechToTextMode: SpeechMode
  setSpeechToTextMode: (mode: SpeechMode) => Promise<void>

  condenseModel: string
  setCondenseModel: (condenseModel: string) => Promise<void>

  inspirationModel: string
  setInspirationModel: (inspirationModel: string) => Promise<void>

  // 周报生成模型（留空时回退到 primaryModel）
  reportModel: string
  setReportModel: (reportModel: string) => Promise<void>

  // 周报：自定义模板（与内置模板一起在周报生成时选择）
  customReportTemplates: CustomMeetingTemplate[]
  setCustomReportTemplates: (templates: CustomMeetingTemplate[]) => Promise<void>
  addCustomReportTemplate: (template: Omit<CustomMeetingTemplate, 'id'>) => Promise<CustomMeetingTemplate>
  updateCustomReportTemplate: (id: string, patch: Partial<Omit<CustomMeetingTemplate, 'id'>>) => Promise<void>
  removeCustomReportTemplate: (id: string) => Promise<void>

  systemPrompt: string
  setSystemPrompt: (systemPrompt: string) => Promise<void>

  templateList: GenTemplate[]
  setTemplateList: (templateList: GenTemplate[]) => Promise<void>

  darkMode: string
  setDarkMode: (darkMode: string) => void

  previewTheme: string
  setPreviewTheme: (previewTheme: string) => void

  codeTheme: string
  setCodeTheme: (codeTheme: string) => void

  // Github 相关设置
  githubUsername: string
  setGithubUsername: (githubUsername: string) => Promise<void>

  accessToken: string
  setAccessToken: (accessToken: string) => void

  jsdelivr: boolean
  setJsdelivr: (jsdelivr: boolean) => void

  useImageRepo: boolean
  setUseImageRepo: (useImageRepo: boolean) => Promise<void>

  autoSync: string
  setAutoSync: (autoSync: string) => Promise<void>

  autoDataSyncEnabled: boolean
  setAutoDataSyncEnabled: (enabled: boolean) => Promise<void>

  excludeSensitiveConfig: boolean
  setExcludeSensitiveConfig: (enabled: boolean) => Promise<void>

  // 自动拉取相关设置
  autoPullOnOpen: boolean
  setAutoPullOnOpen: (autoPullOnOpen: boolean) => Promise<void>

  autoPullOnSwitch: boolean
  setAutoPullOnSwitch: (autoPullOnSwitch: boolean) => Promise<void>

  // Gitee 相关设置
  giteeAccessToken: string
  setGiteeAccessToken: (giteeAccessToken: string) => void

  giteeAutoSync: string
  setGiteeAutoSync: (giteeAutoSync: string) => Promise<void>

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType
  setGitlabInstanceType: (instanceType: GitlabInstanceType) => Promise<void>

  gitlabCustomUrl: string
  setGitlabCustomUrl: (customUrl: string) => Promise<void>

  gitlabAccessToken: string
  setGitlabAccessToken: (gitlabAccessToken: string) => void

  gitlabAutoSync: string
  setGitlabAutoSync: (gitlabAutoSync: string) => Promise<void>

  gitlabUsername: string
  setGitlabUsername: (gitlabUsername: string) => Promise<void>

  // Gitea 相关设置
  giteaInstanceType: GiteaInstanceType
  setGiteaInstanceType: (instanceType: GiteaInstanceType) => Promise<void>

  giteaCustomUrl: string
  setGiteaCustomUrl: (customUrl: string) => Promise<void>

  giteaAccessToken: string
  setGiteaAccessToken: (giteaAccessToken: string) => void

  giteaAutoSync: string
  setGiteaAutoSync: (giteaAutoSync: string) => Promise<void>

  giteaUsername: string
  setGiteaUsername: (giteaUsername: string) => Promise<void>

  // 主要备份方式设置
  primaryBackupMethod: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
  setPrimaryBackupMethod: (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav') => Promise<void>

  lastSettingPage: string
  setLastSettingPage: (page: string) => Promise<void>

  workspacePath: string
  setWorkspacePath: (path: string) => Promise<void>

  // 数据存储路径（录音、会议音频、图片等媒体文件的自定义存储位置）
  dataStoragePath: string
  setDataStoragePath: (path: string) => Promise<void>

  // 工作区历史路径
  workspaceHistory: string[]
  addWorkspaceHistory: (path: string) => Promise<void>
  removeWorkspaceHistory: (path: string) => Promise<void>
  clearWorkspaceHistory: () => Promise<void>

  assetsPath: string
  setAssetsPath: (path: string) => Promise<void>

  // 图床设置
  githubImageAccessToken: string
  setGithubImageAccessToken: (githubImageAccessToken: string) => Promise<void>

  // 自定义仓库名称设置
  githubCustomSyncRepo: string
  setGithubCustomSyncRepo: (repo: string) => Promise<void>

  giteeCustomSyncRepo: string
  setGiteeCustomSyncRepo: (repo: string) => Promise<void>

  gitlabCustomSyncRepo: string
  setGitlabCustomSyncRepo: (repo: string) => Promise<void>

  giteaCustomSyncRepo: string
  setGiteaCustomSyncRepo: (repo: string) => Promise<void>

  githubCustomImageRepo: string
  setGithubCustomImageRepo: (repo: string) => Promise<void>

  // 图片识别设置
  enableImageRecognition: boolean
  setEnableImageRecognition: (enable: boolean) => Promise<void>

  // 界面缩放设置
  uiScale: number
  setUiScale: (scale: number) => Promise<void>

  // 正文文字大小缩放设置
  contentTextScale: number
  setContentTextScale: (scale: number) => Promise<void>

  // 文件管理器文字大小设置
  fileManagerTextSize: string
  setFileManagerTextSize: (size: string) => Promise<void>

  // 记录文字大小设置
  recordTextSize: string
  setRecordTextSize: (size: string) => Promise<void>

  // 自定义主题颜色设置
  customThemeColors: CustomThemeColors
  setCustomThemeColors: (colors: CustomThemeColors) => Promise<void>
  resetCustomThemeColors: () => Promise<void>

  // 聊天工具栏配置 - PC 端
  chatToolbarConfigPc: ChatToolbarItem[]
  setChatToolbarConfigPc: (config: ChatToolbarItem[]) => Promise<void>

  // 聊天工具栏配置 - 移动端
  chatToolbarConfigMobile: ChatToolbarItem[]
  setChatToolbarConfigMobile: (config: ChatToolbarItem[]) => Promise<void>

  // 记录工具栏配置
  recordToolbarConfig: RecordToolbarItem[]
  setRecordToolbarConfig: (config: RecordToolbarItem[]) => Promise<void>

  // 编辑器撤销/重做按钮显示设置
  showEditorUndoRedo: boolean
  setShowEditorUndoRedo: (show: boolean) => Promise<void>

  // 摘要设置
  enableCondense: boolean
  setEnableCondense: (enabled: boolean) => Promise<void>
  keepLatestCount: number
  setKeepLatestCount: (count: number) => Promise<void>
  condenseMaxLength: number
  setCondenseMaxLength: (length: number) => Promise<void>
}

export interface ChatToolbarItem {
  id: string
  enabled: boolean
  order: number
}

export interface RecordToolbarItem {
  id: string
  enabled: boolean
  order: number
}

let settingAutoSyncReady = false
let settingAutoSyncSubscriptionInitialized = false

function getChangedSyncableSettingKeys(current: SettingState, previous: SettingState): string[] {
  const currentRecord = current as unknown as Record<string, unknown>
  const previousRecord = previous as unknown as Record<string, unknown>
  const excludeSensitiveConfig = current.excludeSensitiveConfig !== false

  return Object.keys(currentRecord).filter((key) => {
    if (typeof currentRecord[key] === 'function') {
      return false
    }

    if (shouldExcludeFromSync(key, { excludeSensitiveConfig })) {
      return false
    }

    return currentRecord[key] !== previousRecord[key]
  })
}

function initSettingAutoSyncSubscription() {
  if (settingAutoSyncSubscriptionInitialized) {
    return
  }

  settingAutoSyncSubscriptionInitialized = true

  useSettingStore.subscribe((current, previous) => {
    if (!settingAutoSyncReady || isAutoDataSyncApplyingRemote()) {
      return
    }

    const changedKeys = getChangedSyncableSettingKeys(current, previous)
    if (changedKeys.length === 0) {
      return
    }

    void persistChangedSyncableSettings(current, changedKeys)
  })
}

async function persistChangedSyncableSettings(state: SettingState, changedKeys: string[]) {
  const store = await Store.load('store.json')
  const stateRecord = state as unknown as Record<string, unknown>

  // 双保险：webSearchApiKeys 是内存态明文密钥，任何情况下都不得落盘/同步
  // （正常路径已在 getChangedSyncableSettingKeys 经 sync-exclusions 无条件排除）
  const persistKeys = changedKeys.filter((key) => key !== 'webSearchApiKeys')
  if (persistKeys.length === 0) return

  for (const key of persistKeys) {
    await store.set(key, stateRecord[key])
  }

  await store.save()
  enqueueAutoDataSync('settings', `settings:${persistKeys.join(',')}`)
}

const useSettingStore = create<SettingState>((set, get) => ({
  initSettingData: async () => {
    const store = await Store.load('store.json');
    await get().setVersion()

    // 初始化图床配置
    const savedUseImageRepo = await store.get<boolean>('useImageRepo')
    if (savedUseImageRepo !== undefined && savedUseImageRepo !== null) {
      set({ useImageRepo: savedUseImageRepo })
    }

    // 读取用户已配置的 AI 模型列表。内部版本不再内置免费模型，
    // 新用户列表为空属正常，由用户在 AI 设置中自行添加模型
    const savedAiModelList = (await store.get('aiModelList') as AiConfig[]) || []

    // 一次性迁移：清理品牌重塑前残留的内置免费模型配置（baseURL 指向 api.notegen.top）。
    // 该服务已下线，残留配置会导致启动时向其发起请求报错；迁移幂等，每次启动执行均安全
    const removedConfigs = savedAiModelList.filter(config => config.baseURL?.includes('notegen.top'))
    const finalAiModelList = savedAiModelList.filter(config => !config.baseURL?.includes('notegen.top'))
    if (removedConfigs.length > 0) {
      await store.set('aiModelList', finalAiModelList)
      // 收集已删除供应商的所有引用形式：config.key、`${key}-*`、以及每个模型 id 的单独引用
      // （历史内置模型的设置值直接存 model.id，如 note-gen-chat，不带供应商前缀）
      const removedRefs = removedConfigs.flatMap(config => [
        config.key,
        ...(config.models || []).flatMap(m => [m.id, `${config.key}-${m.id}`])
      ])
      // 清理指向已删除供应商的模型设置，重置后由下方默认逻辑重新分配或保持空态
      const modelSettingKeys = [
        'primaryModel', 'completionModel', 'markDescModel',
        'commitModel', 'embeddingModel', 'rerankingModel', 'imageMethodModel',
        'audioModel', 'sttModel', 'condenseModel', 'inspirationModel',
        'reportModel'
      ]
      for (const key of modelSettingKeys) {
        const value = await store.get<string>(key)
        if (value && removedRefs.some(ref => value === ref || value.startsWith(`${ref}-`))) {
          await store.set(key, '')
        }
      }
    }

    // 检查是否设置了TTS模型，如果没有且存在可用的TTS模型，则设置为默认TTS模型
    const currentAudioModel = await store.get('audioModel') as string
    const hasTTSModel = finalAiModelList.some(config =>
      config.models?.some(model => model.modelType === 'tts') || config.modelType === 'tts'
    )

    if (!currentAudioModel && hasTTSModel) {
      // 查找第一个可用的TTS模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const ttsModel = config.models.find(model => model.modelType === 'tts')
          if (ttsModel) {
            await store.set('audioModel', `${config.key}-${ttsModel.id}`)
            set({ audioModel: `${config.key}-${ttsModel.id}` })
            break
          }
        } else if (config.modelType === 'tts') {
          await store.set('audioModel', config.key)
          set({ audioModel: config.key })
          break
        }
      }
    }

    // 检查是否设置了STT模型，如果没有且存在可用的STT模型，则设置为默认STT模型
    const currentSttModel = await store.get('sttModel') as string
    const hasSTTModel = finalAiModelList.some(config =>
      config.models?.some(model => model.modelType === 'stt') || config.modelType === 'stt'
    )

    if (!currentSttModel && hasSTTModel) {
      // 查找第一个可用的STT模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const sttModel = config.models.find(model => model.modelType === 'stt')
          if (sttModel) {
            await store.set('sttModel', `${config.key}-${sttModel.id}`)
            set({ sttModel: `${config.key}-${sttModel.id}` })
            break
          }
        } else if (config.modelType === 'stt') {
          await store.set('sttModel', config.key)
          set({ sttModel: config.key })
          break
        }
      }
    }

    const currentTextToSpeechMode = await store.get('textToSpeechMode')
    set({ textToSpeechMode: normalizeSpeechMode(currentTextToSpeechMode) })

    // 加载联网搜索各 provider 的 API Key（store.json 中加密存储，读取时解密，兼容历史明文）
    const webSearchApiKeys: Record<'tavily' | 'bocha', string> = { tavily: '', bocha: '' }
    for (const provider of ['tavily', 'bocha'] as const) {
      const storedKey = ((await store.get(`webSearchApiKey.${provider}`)) as string) || ''
      const plainKey = await decryptSecret(storedKey)
      // 历史明文迁移：读到明文后重写为加密值
      if (plainKey && plainKey === storedKey) {
        await store.set(`webSearchApiKey.${provider}`, await encryptSecret(plainKey))
      }
      webSearchApiKeys[provider] = plainKey
    }
    // 一次性迁移：清理历史版本在 excludeSensitiveConfig=false 时明文落盘的 webSearchApiKeys 对象。
    // 明文密钥迁移到加密单键（仅在加密键缺失时回填，避免覆盖更新数据），随后删除明文条目并立即落盘
    const legacyWebSearchApiKeys = (await store.get('webSearchApiKeys')) as Record<string, unknown> | undefined
    if (legacyWebSearchApiKeys && typeof legacyWebSearchApiKeys === 'object') {
      for (const provider of ['tavily', 'bocha'] as const) {
        const legacyValue = legacyWebSearchApiKeys[provider]
        const legacyKey = typeof legacyValue === 'string' ? legacyValue : ''
        if (legacyKey && !webSearchApiKeys[provider]) {
          await store.set(`webSearchApiKey.${provider}`, await encryptSecret(legacyKey))
          webSearchApiKeys[provider] = legacyKey
        }
      }
      await store.delete('webSearchApiKeys')
      await store.save()
    }
    set({ webSearchApiKeys })

    // 加载阿里云 ASR 配置（apiKey 在 store.json 中加密存储，读取时解密，兼容历史明文）
    const sttEngine = (await store.get('sttEngine') as string) || 'openai-compatible'
    const storedAliyunAsrApiKey = (await store.get('aliyunAsrApiKey') as string) || ''
    const aliyunAsrApiKey = await decryptSecret(storedAliyunAsrApiKey)
    // 历史明文迁移：读到明文后重写为加密值（keyring 不可用时 encryptSecret 原样返回，无副作用）
    if (aliyunAsrApiKey && aliyunAsrApiKey === storedAliyunAsrApiKey) {
      await store.set('aliyunAsrApiKey', await encryptSecret(aliyunAsrApiKey))
    }
    const aliyunAsrWorkspaceId = (await store.get('aliyunAsrWorkspaceId') as string) || ''
    set({ sttEngine: sttEngine as 'openai-compatible' | 'aliyun', aliyunAsrApiKey, aliyunAsrWorkspaceId })

    const currentSpeechToTextMode = await store.get('speechToTextMode')
    set({ speechToTextMode: normalizeSpeechMode(currentSpeechToTextMode) })

    // 检查并初始化其他模型类型
    // 注：primaryModel 未配置时也自动取第一个可用聊天模型，
    // 否则"留空回退 primaryModel"的所有链路（会议纪要/周报/翻译/摘要等）都会断链
    const modelTypes = [
      { storeKey: 'primaryModel', modelType: 'chat' },
      { storeKey: 'completionModel', modelType: 'chat' },
      { storeKey: 'markDescModel', modelType: 'chat' },
      { storeKey: 'commitModel', modelType: 'chat' },
      { storeKey: 'condenseModel', modelType: 'chat' },
      { storeKey: 'inspirationModel', modelType: 'chat' },
      { storeKey: 'reportModel', modelType: 'chat' }
    ]

    for (const { storeKey, modelType } of modelTypes) {
      const currentModel = await store.get(storeKey) as string
      if (!currentModel) {
        // 查找第一个可用的聊天模型作为默认值（无可用模型时保持为空，由用户后续配置）
        for (const config of finalAiModelList) {
          if (config.models && config.models.length > 0) {
            const chatModel = config.models.find(model => model.modelType === modelType)
            if (chatModel) {
              await store.set(storeKey, `${config.key}-${chatModel.id}`)
              set({ [storeKey]: `${config.key}-${chatModel.id}` })
              break
            }
          } else if (config.modelType === modelType || !config.modelType) {
            await store.set(storeKey, config.key)
            set({ [storeKey]: config.key })
            break
          }
        }
      }
    }

    await Promise.all(Object.entries(get()).map(async ([key, value]) => {
      const res = await store.get(key)

      if (typeof value === 'function') return
      // 联网搜索密钥已按 webSearchApiKey.<provider> 单独解密加载，
      // 这里跳过，避免把明文写入 store.json 或用空值覆盖内存态
      if (key === 'webSearchApiKeys') return
      if (res !== undefined && key !== 'version') {
        if (key === 'templateList') {
          set({ [key]: [] })
          setTimeout(() => {
            set({ [key]: res as GenTemplate[] })
          }, 0);
        } else if (key === 'recordToolbarConfig') {
          // 确保包含所有工具，如果缺少新工具则自动添加
          const storedConfig = res as RecordToolbarItem[]
          const defaultConfig = value as RecordToolbarItem[]

          // 检查是否有缺失的工具
          const missingTools = defaultConfig.filter(
            defaultItem => !storedConfig.some(stored => stored.id === defaultItem.id)
          )

          if (missingTools.length > 0) {
            // 合并配置：保留用户的顺序和启用状态，添加新工具
            const mergedConfig = [...storedConfig]
            let maxOrder = Math.max(...storedConfig.map(item => item.order), 0)

            missingTools.forEach(tool => {
              mergedConfig.push({ ...tool, order: ++maxOrder })
            })

            await store.set(key, mergedConfig)
            set({ [key]: mergedConfig })
          } else {
            set({ [key]: res as RecordToolbarItem[] })
          }
        } else if (key === 'chatToolbarConfigPc' || key === 'chatToolbarConfigMobile') {
          // 确保聊天工具栏包含所有工具，如果缺少新工具则自动添加
          const storedConfig = res as ChatToolbarItem[]
          const defaultConfig = value as ChatToolbarItem[]

          // 检查是否有缺失的工具
          const missingTools = defaultConfig.filter(
            defaultItem => !storedConfig.some(stored => stored.id === defaultItem.id)
          )

          if (missingTools.length > 0) {
            // 合并配置：保留用户的顺序和启用状态，添加新工具
            const mergedConfig = [...storedConfig]
            let maxOrder = Math.max(...storedConfig.map(item => item.order), 0)

            missingTools.forEach(tool => {
              mergedConfig.push({ ...tool, order: ++maxOrder })
            })

            await store.set(key, mergedConfig)
            set({ [key]: mergedConfig })
          } else {
            set({ [key]: res as ChatToolbarItem[] })
          }
        } else if (key === 'aliyunAsrApiKey') {
          // store.json 中是加密值，已在上方解密加载，这里避免被密文覆盖
          set({ [key]: await decryptSecret(res as string) })
        } else {
          set({ [key]: res })
        }
      } else {
        await store.set(key, value)
      }
    }))

    initSettingAutoSyncSubscription()
    settingAutoSyncReady = true
  },

  version: '',
  setVersion: async () => {
    const version = await getVersion()
    set({ version })
  },

  language: '简体中文',
  setLanguage: (language) => set({ language }),

  appFontFamily: APP_FONT_SYSTEM_VALUE,
  setAppFontFamily: async (fontFamily) => {
    set({ appFontFamily: fontFamily })
    applyAppFontFamily(fontFamily)
    const store = await Store.load('store.json')
    await store.set('appFontFamily', fontFamily)
    await store.save()
  },

  currentAi: '',
  setCurrentAi: (currentAi) => set({ currentAi }),

  aiModelList: [],
  setAiModelList: (aiModelList) => set({ aiModelList }),

  primaryModel: '',
  setPrimaryModel: async (primaryModel) => {
    // 与其他模型 setter 保持一致：同步写入 store.json，避免刷新后主模型配置丢失
    const store = await Store.load('store.json');
    await store.set('primaryModel', primaryModel)
    await store.save()
    set({ primaryModel })
  },

  completionModel: '',
  setCompletionModel: async (completionModel) => {
    const store = await Store.load('store.json');
    await store.set('completionModel', completionModel)
    set({ completionModel })
  },

  markDescModel: '',
  setMarkDescModel: async (markDescModel) => {
    const store = await Store.load('store.json');
    await store.set('markDescModel', markDescModel)
    set({ markDescModel })
  },

  commitModel: '',
  setCommitModel: async (commitModel) => {
    const store = await Store.load('store.json');
    await store.set('commitModel', commitModel)
    set({ commitModel })
  },

  embeddingModel: '',
  setEmbeddingModel: async (embeddingModel) => {
    const store = await Store.load('store.json');
    await store.set('embeddingModel', embeddingModel)
    set({ embeddingModel })
  },

  rerankingModel: '',
  setRerankingModel: async (rerankingModel) => {
    const store = await Store.load('store.json');
    await store.set('rerankingModel', rerankingModel)
    set({ rerankingModel })
  },

  imageMethodModel: '',
  setImageMethodModel: async (imageMethodModel) => {
    const store = await Store.load('store.json');
    await store.set('imageMethodModel', imageMethodModel)
    set({ imageMethodModel })
  },

  audioModel: '',
  setAudioModel: async (audioModel) => {
    const store = await Store.load('store.json');
    await store.set('audioModel', audioModel)
    set({ audioModel })
  },

  sttModel: '',
  setSttModel: async (sttModel) => {
    const store = await Store.load('store.json');
    await store.set('sttModel', sttModel)
    set({ sttModel })
  },
  sttEngine: 'openai-compatible' as const,
  setSttEngine: async (engine) => {
    const store = await Store.load('store.json');
    await store.set('sttEngine', engine)
    set({ sttEngine: engine })
  },
  aliyunAsrApiKey: '',
  setAliyunAsrApiKey: async (key) => {
    const store = await Store.load('store.json');
    // 加密后落盘（keyring 不可用时自动降级为明文）
    await store.set('aliyunAsrApiKey', await encryptSecret(key))
    set({ aliyunAsrApiKey: key })
  },
  aliyunAsrWorkspaceId: '',
  setAliyunAsrWorkspaceId: async (id) => {
    const store = await Store.load('store.json');
    await store.set('aliyunAsrWorkspaceId', id)
    set({ aliyunAsrWorkspaceId: id })
  },
  aliyunAsrHotwords: '',
  setAliyunAsrHotwords: async (hotwords) => {
    const store = await Store.load('store.json');
    await store.set('aliyunAsrHotwords', hotwords)
    set({ aliyunAsrHotwords: hotwords })
  },
  aliyunAsrDiarization: true,
  setAliyunAsrDiarization: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('aliyunAsrDiarization', enabled)
    set({ aliyunAsrDiarization: enabled })
  },
  aliyunAsrModel: 'qwen3-asr-flash-realtime' as const,
  setAliyunAsrModel: async (model) => {
    const store = await Store.load('store.json');
    await store.set('aliyunAsrModel', model)
    set({ aliyunAsrModel: model })
  },
  meetingTranscriptCorrection: true,
  setMeetingTranscriptCorrection: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('meetingTranscriptCorrection', enabled)
    set({ meetingTranscriptCorrection: enabled })
  },
  meetingCoverageCheck: false,
  setMeetingCoverageCheck: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('meetingCoverageCheck', enabled)
    set({ meetingCoverageCheck: enabled })
  },
  meetingLiveTranscript: true,
  setMeetingLiveTranscript: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('meetingLiveTranscript', enabled)
    set({ meetingLiveTranscript: enabled })
  },
  meetingAutoDiarize: false,
  setMeetingAutoDiarize: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('meetingAutoDiarize', enabled)
    set({ meetingAutoDiarize: enabled })
  },
  customMeetingTemplates: [],
  setCustomMeetingTemplates: async (templates) => {
    const store = await Store.load('store.json');
    await store.set('customMeetingTemplates', templates)
    set({ customMeetingTemplates: templates })
  },
  addCustomMeetingTemplate: async (template) => {
    // id 用 custom- 前缀 + 时间戳/随机数，避免与内置模板 id 冲突
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const created = { ...template, id }
    await get().setCustomMeetingTemplates([...get().customMeetingTemplates, created])
    return created
  },
  updateCustomMeetingTemplate: async (id, patch) => {
    await get().setCustomMeetingTemplates(
      get().customMeetingTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t))
    )
  },
  removeCustomMeetingTemplate: async (id) => {
    await get().setCustomMeetingTemplates(
      get().customMeetingTemplates.filter((t) => t.id !== id)
    )
  },

  // 联网搜索配置：密钥加密后落盘 webSearchApiKey.<provider>（keyring 不可用时自动降级为明文）
  webSearchEnabled: false,
  setWebSearchEnabled: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('webSearchEnabled', enabled)
    set({ webSearchEnabled: enabled })
  },
  webSearchProvider: 'tavily' as const,
  setWebSearchProvider: async (provider) => {
    const store = await Store.load('store.json');
    await store.set('webSearchProvider', provider)
    set({ webSearchProvider: provider })
  },
  webSearchApiKeys: { tavily: '', bocha: '' },
  setWebSearchApiKey: async (provider, key) => {
    const store = await Store.load('store.json');
    // 密文立即落盘：明文密钥已退出持久化同步域，不会再被 persistChangedSyncableSettings 顺带保存
    await store.set(`webSearchApiKey.${provider}`, await encryptSecret(key))
    await store.save()
    set({ webSearchApiKeys: { ...get().webSearchApiKeys, [provider]: key } })
  },
  webSearchBaseUrls: { tavily: '', bocha: '' },
  setWebSearchBaseUrl: async (provider, baseUrl) => {
    const store = await Store.load('store.json');
    const baseUrls = { ...get().webSearchBaseUrls, [provider]: baseUrl }
    await store.set('webSearchBaseUrls', baseUrls)
    set({ webSearchBaseUrls: baseUrls })
  },
  webSearchMaxResults: 10,
  setWebSearchMaxResults: async (count) => {
    const store = await Store.load('store.json');
    await store.set('webSearchMaxResults', count)
    set({ webSearchMaxResults: count })
  },
  webSearchTimeoutMs: 20000,
  setWebSearchTimeoutMs: async (ms) => {
    const store = await Store.load('store.json');
    await store.set('webSearchTimeoutMs', ms)
    set({ webSearchTimeoutMs: ms })
  },

  // 待办到期提醒开关：默认 true；持久化在 store.json，initSettingData 的通用加载循环会自动读取
  notifyTodoEnabled: true,
  setNotifyTodoEnabled: async (enabled) => {
    const store = await Store.load('store.json');
    await store.set('notifyTodoEnabled', enabled)
    set({ notifyTodoEnabled: enabled })
  },

  // 首页欢迎条称呼：持久化在 store.json，通用加载循环自动读取
  userDisplayName: '',
  setUserDisplayName: async (name) => {
    const store = await Store.load('store.json');
    await store.set('userDisplayName', name.trim())
    set({ userDisplayName: name.trim() })
  },

  textToSpeechMode: 'auto',
  setTextToSpeechMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('textToSpeechMode', normalizedMode)
    set({ textToSpeechMode: normalizedMode })
  },

  speechToTextMode: 'auto',
  setSpeechToTextMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('speechToTextMode', normalizedMode)
    set({ speechToTextMode: normalizedMode })
  },

  condenseModel: '',
  setCondenseModel: async (condenseModel) => {
    const store = await Store.load('store.json');
    await store.set('condenseModel', condenseModel)
    set({ condenseModel })
  },

  inspirationModel: '',
  setInspirationModel: async (inspirationModel) => {
    const store = await Store.load('store.json');
    await store.set('inspirationModel', inspirationModel)
    set({ inspirationModel })
  },

  reportModel: '',
  setReportModel: async (reportModel) => {
    const store = await Store.load('store.json');
    await store.set('reportModel', reportModel)
    set({ reportModel })
  },

  customReportTemplates: [],
  setCustomReportTemplates: async (templates) => {
    const store = await Store.load('store.json')
    await store.set('customReportTemplates', templates)
    set({ customReportTemplates: templates })
  },
  addCustomReportTemplate: async (template) => {
    const created: CustomMeetingTemplate = {
      ...template,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    await get().setCustomReportTemplates([...get().customReportTemplates, created])
    return created
  },
  updateCustomReportTemplate: async (id, patch) => {
    await get().setCustomReportTemplates(
      get().customReportTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t))
    )
  },
  removeCustomReportTemplate: async (id) => {
    await get().setCustomReportTemplates(
      get().customReportTemplates.filter((t) => t.id !== id)
    )
  },

  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  setSystemPrompt: async (systemPrompt) => {
    set({ systemPrompt })
    const store = await Store.load('store.json')
    await store.set('systemPrompt', systemPrompt)
    await store.save()
  },

  templateList: [
    {
      id: '0',
      title: '笔记',
      content: `整理成一篇详细完整的笔记。
满足以下格式要求：
- 如果是代码，必须完整保留，不要随意生成。
- 文字复制的内容尽量不要修改，只处理格式化后的内容。`,
      status: true,
      range: GenTemplateRange.All
    },
    {
      id: '1',
      title: '周报',
      content: '最近一周的记录整理成一篇周报，将每条记录形成一句总结，每条不超过50字。',
      status: true,
      range: GenTemplateRange.Week
    }
  ],
  setTemplateList: async (templateList) => {
    set({ templateList })
    const store = await Store.load('store.json')
    await store.set('templateList', templateList)
  },

  darkMode: 'system',
  setDarkMode: (darkMode) => set({ darkMode }),

  previewTheme: 'github',
  setPreviewTheme: (previewTheme) => set({ previewTheme }),

  codeTheme: 'github',
  setCodeTheme: (codeTheme) => set({ codeTheme }),

  githubUsername: '',
  setGithubUsername: async (githubUsername) => {
    set({ githubUsername })
    const store = await Store.load('store.json');
    store.set('githubUsername', githubUsername)
  },

  accessToken: '',
  setAccessToken: async (accessToken) => {
    const store = await Store.load('store.json');
    const hasAccessToken = await store.get('accessToken') === accessToken
    if (!hasAccessToken) {
      await get().setGithubUsername('')
    }
    set({ accessToken })
  },

  jsdelivr: true,
  setJsdelivr: async (jsdelivr: boolean) => {
    set({ jsdelivr })
    const store = await Store.load('store.json');
    await store.set('jsdelivr', jsdelivr)
  },

  useImageRepo: false,
  setUseImageRepo: async (useImageRepo: boolean) => {
    set({ useImageRepo })
    const store = await Store.load('store.json');
    await store.set('useImageRepo', useImageRepo)
    if (useImageRepo) {
      const normalizedImageHosting = getNormalizedImageHosting(await store.get<string>('mainImageHosting'))
      if (normalizedImageHosting.shouldPersist) {
        await store.set('mainImageHosting', normalizedImageHosting.value)
      }
    }
    await store.save()
  },

  autoSync: '5',
  setAutoSync: async (autoSync: string) => {
    set({ autoSync })
    const store = await Store.load('store.json');
    await store.set('autoSync', autoSync)
  },

  autoDataSyncEnabled: true,
  setAutoDataSyncEnabled: async (autoDataSyncEnabled: boolean) => {
    set({ autoDataSyncEnabled })
    const store = await Store.load('store.json')
    await store.set('autoDataSyncEnabled', autoDataSyncEnabled)
    await store.save()
  },

  excludeSensitiveConfig: true,
  setExcludeSensitiveConfig: async (excludeSensitiveConfig: boolean) => {
    set({ excludeSensitiveConfig })
    const store = await Store.load('store.json')
    await store.set('excludeSensitiveConfig', excludeSensitiveConfig)
    await store.save()

    if (!isAutoDataSyncApplyingRemote()) {
      enqueueAutoDataSync('settings', 'settings:exclude-sensitive-config')
    }
  },

  // 自动拉取相关设置 - 默认开启
  autoPullOnOpen: true,
  setAutoPullOnOpen: async (autoPullOnOpen: boolean) => {
    set({ autoPullOnOpen })
    const store = await Store.load('store.json');
    await store.set('autoPullOnOpen', autoPullOnOpen)

    // 同步更新 sync-manager 的配置
    try {
      const { getSyncManager } = await import('@/lib/sync/sync-manager')
      const manager = getSyncManager()
      await manager.updateConfig({ autoPullOnOpen })
    } catch {
      // 静默处理
    }
  },

  autoPullOnSwitch: true,
  setAutoPullOnSwitch: async (autoPullOnSwitch: boolean) => {
    set({ autoPullOnSwitch })
    const store = await Store.load('store.json');
    await store.set('autoPullOnSwitch', autoPullOnSwitch)

    // 同步更新 sync-manager 的配置
    try {
      const { getSyncManager } = await import('@/lib/sync/sync-manager')
      const manager = getSyncManager()
      await manager.updateConfig({ autoPullOnSwitch })
    } catch {
      // 静默处理
    }
  },

  lastSettingPage: 'about',
  setLastSettingPage: async (page: string) => {
    set({ lastSettingPage: page })
    const store = await Store.load('store.json');
    await store.set('lastSettingPage', page)
  },

  workspacePath: '',
  setWorkspacePath: async (path: string) => {
    set({ workspacePath: path })
    const store = await Store.load('store.json');
    await store.set('workspacePath', path)

    // 如果路径不为空且不在历史记录中，则添加到历史记录
    if (path && !get().workspaceHistory.includes(path)) {
      await get().addWorkspaceHistory(path)
    }
  },

  // 数据存储路径：空字符串表示使用默认 AppData 目录
  dataStoragePath: '',
  setDataStoragePath: async (path: string) => {
    set({ dataStoragePath: path })
    const store = await Store.load('store.json')
    await store.set('dataStoragePath', path)
    await store.save()
  },

  // 工作区历史路径管理
  workspaceHistory: [],
  addWorkspaceHistory: async (path: string) => {
    const currentHistory = get().workspaceHistory
    const newHistory = [path, ...currentHistory.filter(p => p !== path)].slice(0, 10) // 最多保存10个历史路径
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  removeWorkspaceHistory: async (path: string) => {
    const newHistory = get().workspaceHistory.filter(p => p !== path)
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  clearWorkspaceHistory: async () => {
    set({ workspaceHistory: [] })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', [])
    await store.save()
  },

  // Gitee 相关设置
  giteeAccessToken: '',
  setGiteeAccessToken: async (giteeAccessToken: string) => {
    set({ giteeAccessToken })
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', giteeAccessToken)
  },

  giteeAutoSync: 'disabled',
  setGiteeAutoSync: async (giteeAutoSync: string) => {
    set({ giteeAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteeAutoSync', giteeAutoSync)
  },

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType.OFFICIAL,
  setGitlabInstanceType: async (instanceType: GitlabInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('gitlabInstanceType', instanceType)
    await store.save()
    set({ gitlabInstanceType: instanceType })
  },

  gitlabCustomUrl: '',
  setGitlabCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabCustomUrl', customUrl)
    await store.save()
    set({ gitlabCustomUrl: customUrl })
  },

  gitlabAccessToken: '',
  setGitlabAccessToken: (gitlabAccessToken: string) => {
    set({ gitlabAccessToken })
  },

  gitlabAutoSync: 'disabled',
  setGitlabAutoSync: async (gitlabAutoSync: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabAutoSync', gitlabAutoSync)
    await store.save()
    set({ gitlabAutoSync })
  },

  gitlabUsername: '',
  setGitlabUsername: async (gitlabUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabUsername', gitlabUsername)
    await store.save()
    set({ gitlabUsername })
  },

  // Gitea 相关实现
  giteaInstanceType: GiteaInstanceType.OFFICIAL,
  setGiteaInstanceType: async (instanceType: GiteaInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('giteaInstanceType', instanceType)
    await store.save()
    set({ giteaInstanceType: instanceType })
  },

  giteaCustomUrl: '',
  setGiteaCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaCustomUrl', customUrl)
    await store.save()
    set({ giteaCustomUrl: customUrl })
  },

  giteaAccessToken: '',
  setGiteaAccessToken: (giteaAccessToken: string) => {
    set({ giteaAccessToken })
  },

  giteaAutoSync: 'disabled',
  setGiteaAutoSync: async (giteaAutoSync: string) => {
    set({ giteaAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteaAutoSync', giteaAutoSync)
    await store.save()
  },

  giteaUsername: '',
  setGiteaUsername: async (giteaUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaUsername', giteaUsername)
    await store.save()
    set({ giteaUsername })
  },

  giteaCustomSyncRepo: '',
  setGiteaCustomSyncRepo: async (repo: string) => {
    set({ giteaCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteaCustomSyncRepo', repo)
    await store.save()
  },

  // 默认使用 GitHub 作为主要备份方式
  primaryBackupMethod: 'github',
  setPrimaryBackupMethod: async (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav') => {
    const store = await Store.load('store.json')
    await store.set('primaryBackupMethod', method)
    await store.save()
    set({ primaryBackupMethod: method })
  },

  assetsPath: 'assets',
  setAssetsPath: async (path: string) => {
    set({ assetsPath: path })
    const store = await Store.load('store.json');
    await store.set('assetsPath', path)
    await store.save()
  },

  // 图床设置
  githubImageAccessToken: '',
  setGithubImageAccessToken: async (githubImageAccessToken: string) => {
    set({ githubImageAccessToken })
    const store = await Store.load('store.json');
    await store.set('githubImageAccessToken', githubImageAccessToken)
    await store.save()
  },

  // 图片识别设置
  enableImageRecognition: true,
  setEnableImageRecognition: async (enable: boolean) => {
    set({ enableImageRecognition: enable })
    const store = await Store.load('store.json');
    await store.set('enableImageRecognition', enable)
    await store.save()
  },

  // 界面缩放设置 (75%, 100%, 125%, 150%)
  uiScale: 100,
  setUiScale: async (scale: number) => {
    set({ uiScale: scale })
    const store = await Store.load('store.json');
    await store.set('uiScale', scale)
    await store.save()
    
    // 使用fontSize实现基于rem的缩放
    document.documentElement.style.fontSize = `${scale}%`
  },

  // 正文文字大小缩放设置 (75%, 100%, 125%, 150%)
  contentTextScale: 100,
  setContentTextScale: async (scale: number) => {
    set({ contentTextScale: scale })
    const store = await Store.load('store.json');
    await store.set('contentTextScale', scale)
    await store.save()
  },

  // 文件管理器文字大小设置 (xs, sm, md, lg, xl)
  fileManagerTextSize: 'sm',
  setFileManagerTextSize: async (size: string) => {
    set({ fileManagerTextSize: size })
    const store = await Store.load('store.json');
    await store.set('fileManagerTextSize', size)
    await store.save()
  },

  // 记录文字大小设置 (xs, sm, md, lg, xl)
  recordTextSize: 'sm',
  setRecordTextSize: async (size: string) => {
    set({ recordTextSize: size })
    const store = await Store.load('store.json');
    await store.set('recordTextSize', size)
    await store.save()
  },

  // 自定义主题颜色设置
  customThemeColors: {
    light: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
    dark: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
  },
  setCustomThemeColors: async (colors: CustomThemeColors) => {
    set({ customThemeColors: colors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', colors)
    await store.save()

    // 应用主题颜色（同时应用亮色和暗色主题）
    applyThemeColors(colors)
  },
  resetCustomThemeColors: async () => {
    const defaultColors: CustomThemeColors = {
      light: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
      dark: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
    }
    set({ customThemeColors: defaultColors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', defaultColors)
    await store.save()

    // 清除自定义主题颜色
    removeThemeColors()
  },

  // 自定义仓库名称设置
  githubCustomSyncRepo: '',
  setGithubCustomSyncRepo: async (repo: string) => {
    set({ githubCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomSyncRepo', repo)
    await store.save()
  },

  giteeCustomSyncRepo: '',
  setGiteeCustomSyncRepo: async (repo: string) => {
    set({ giteeCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteeCustomSyncRepo', repo)
    await store.save()
  },

  gitlabCustomSyncRepo: '',
  setGitlabCustomSyncRepo: async (repo: string) => {
    set({ gitlabCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('gitlabCustomSyncRepo', repo)
    await store.save()
  },

  githubCustomImageRepo: '',
  setGithubCustomImageRepo: async (repo: string) => {
    set({ githubCustomImageRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomImageRepo', repo)
    await store.save()
  },

  // 聊天工具栏配置 - PC 端
  chatToolbarConfigPc: [
    // 底部工具栏（可排序）
    { id: 'modelSelect', enabled: true, order: 0 },
    { id: 'promptSelect', enabled: true, order: 1 },
    { id: 'mcpButton', enabled: true, order: 2 },
    { id: 'ragSwitch', enabled: true, order: 3 },
    { id: 'clipboardMonitor', enabled: true, order: 4 },
    // 顶部工具栏 - 右侧（不参与排序）
    { id: 'newChat', enabled: true, order: 5 },
  ],
  setChatToolbarConfigPc: async (config: ChatToolbarItem[]) => {
    set({ chatToolbarConfigPc: config })
    const store = await Store.load('store.json');
    await store.set('chatToolbarConfigPc', config)
    await store.save()
  },

  // 聊天工具栏配置 - 移动端
  chatToolbarConfigMobile: [
    { id: 'modelSelect', enabled: true, order: 0 },
    { id: 'promptSelect', enabled: true, order: 1 },
    { id: 'mcpButton', enabled: true, order: 2 },
    { id: 'ragSwitch', enabled: true, order: 3 },
    { id: 'clipboardMonitor', enabled: true, order: 4 },
    { id: 'newChat', enabled: true, order: 5 },
  ],
  setChatToolbarConfigMobile: async (config: ChatToolbarItem[]) => {
    set({ chatToolbarConfigMobile: config })
    const store = await Store.load('store.json');
    await store.set('chatToolbarConfigMobile', config)
    await store.save()
  },

  // 记录工具栏配置
  recordToolbarConfig: [
    { id: 'text', enabled: true, order: 0 },
    { id: 'recording', enabled: true, order: 1 },
    { id: 'scan', enabled: true, order: 2 },
    { id: 'image', enabled: true, order: 3 },
    { id: 'link', enabled: true, order: 4 },
    { id: 'file', enabled: true, order: 5 },
    { id: 'todo', enabled: true, order: 6 },
  ],
  setRecordToolbarConfig: async (config: RecordToolbarItem[]) => {
    set({ recordToolbarConfig: config })
    const store = await Store.load('store.json');
    await store.set('recordToolbarConfig', config)
    await store.save()
  },

  // 摘要设置
  enableCondense: true,
  setEnableCondense: async (enabled: boolean) => {
    set({ enableCondense: enabled })
    const store = await Store.load('store.json');
    await store.set('enableCondense', enabled)
    await store.save()
  },

  keepLatestCount: 4,
  setKeepLatestCount: async (count: number) => {
    set({ keepLatestCount: count })
    const store = await Store.load('store.json');
    await store.set('keepLatestCount', count)
    await store.save()
  },

  condenseMaxLength: 100,
  setCondenseMaxLength: async (length: number) => {
    set({ condenseMaxLength: length })
    const store = await Store.load('store.json');
    await store.set('condenseMaxLength', length)
    await store.save()
  },

  // 编辑器撤销/重做按钮显示设置 - 默认开启
  showEditorUndoRedo: true,
  setShowEditorUndoRedo: async (show: boolean) => {
    set({ showEditorUndoRedo: show })
    const store = await Store.load('store.json');
    await store.set('showEditorUndoRedo', show)
    await store.save()
  },
}))

export default useSettingStore
