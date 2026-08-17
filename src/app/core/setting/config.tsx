import {
  BotMessageSquare,
  LayoutTemplate,
  ScanText,
  Store,
  UserRoundCog,
  Drama,
  FolderOpen,
  DatabaseBackup,
  ImageUp,
  FileCog,
  Book,
  KeyboardIcon,
  Volume2,
  Settings,
  Puzzle,
  Sparkles,
  MessageSquare,
  Brain,
  Presentation,
  Globe,
  ClipboardList,
} from "lucide-react"

// 设置导航条目
export interface SettingNavItem {
  icon: React.ReactNode
  anchor: string
}

// 设置导航分组（D2：分组重排 + 高级折叠）
// collapsible 的分组默认折叠收起，展开状态由 setting-tab 记忆到 localStorage
export interface SettingNavGroup {
  id: 'common' | 'content' | 'intelligence' | 'system' | 'advanced'
  collapsible?: boolean
  items: SettingNavItem[]
}

const settingNavGroups: SettingNavGroup[] = [
  {
    id: 'common',
    items: [
      { icon: <Settings className="size-4 md:size-6" />, anchor: 'general' },
      { icon: <BotMessageSquare className="size-4 md:size-6" />, anchor: 'ai' },
      { icon: <MessageSquare className="size-4 md:size-6" />, anchor: 'chat' },
      { icon: <Volume2 className="size-4 md:size-6" />, anchor: 'audio' },
      { icon: <Presentation className="size-4 md:size-6" />, anchor: 'meeting' },
      { icon: <ClipboardList className="size-4 md:size-6" />, anchor: 'report' },
    ],
  },
  {
    id: 'content',
    items: [
      { icon: <FileCog className="size-4 md:size-6" />, anchor: 'editor' },
      { icon: <FolderOpen className="size-4 md:size-6" />, anchor: 'file' },
      { icon: <LayoutTemplate className="size-4 md:size-6" />, anchor: 'template' },
    ],
  },
  {
    id: 'intelligence',
    items: [
      { icon: <Globe className="size-4 md:size-6" />, anchor: 'websearch' },
      { icon: <Book className="size-4 md:size-6" />, anchor: 'rag' },
      { icon: <Sparkles className="size-4 md:size-6" />, anchor: 'skills' },
    ],
  },
  {
    id: 'system',
    items: [
      { icon: <DatabaseBackup className="size-4 md:size-6" />, anchor: 'sync' },
      { icon: <KeyboardIcon className="size-4 md:size-6" />, anchor: 'shortcuts' },
      { icon: <Store className="size-4 md:size-6" />, anchor: 'about' },
    ],
  },
  {
    id: 'advanced',
    collapsible: true,
    items: [
      { icon: <Puzzle className="size-4 md:size-6" />, anchor: 'mcp' },
      { icon: <Drama className="size-4 md:size-6" />, anchor: 'prompt' },
      { icon: <Brain className="size-4 md:size-6" />, anchor: 'memories' },
      { icon: <ImageUp className="size-4 md:size-6" />, anchor: 'imageHosting' },
      { icon: <ScanText className="size-4 md:size-6" />, anchor: 'imageMethod' },
      { icon: <UserRoundCog className="size-4 md:size-6" />, anchor: 'dev' },
    ],
  },
]

export { settingNavGroups }

// 平铺的导航配置（保留 '-' 分隔符），由分组派生，供移动端设置列表与重定向逻辑复用
const baseConfig: (SettingNavItem | '-')[] = settingNavGroups.flatMap(
  (group, index) => (index === 0 ? [...group.items] : ['-' as const, ...group.items])
)

export default baseConfig

// D1 设置搜索：常见别名映射（中英文），按 anchor 命中标题/描述之外的常见叫法
export const settingSearchAliases: Record<string, string[]> = {
  about: ['关于', '版本', '协议', 'about', 'version', 'license', 'cmbook', '招悟', '招本', 'notegen'],
  general: ['常规', '通用', '主题', '语言', '外观', 'general', 'theme', 'language', 'dark', '暗黑'],
  chat: ['对话', '聊天', '主模型', '工具栏', 'chat', 'primary model', 'toolbar'],
  editor: ['编辑器', '补全', '提交信息', 'editor', 'completion', 'commit'],
  sync: ['同步', '备份', '仓库', 'sync', 'backup', 'github', 'gitee', 'gitea', 'gitlab', 'webdav', 's3'],
  imageHosting: ['图床', '图片上传', 'image hosting', 'picgo', 'smms'],
  ai: ['模型', '大模型', '密钥', 'key', 'apikey', 'api key', 'api', 'model', 'llm', 'provider', '供应商', 'openai', 'deepseek', 'qwen', 'gemini', 'claude', 'ollama', '硅基流动', 'siliconflow'],
  websearch: ['联网', '搜索', '联网搜索', 'web', 'search', 'tavily', 'bocha', '博查', 'fetch'],
  rag: ['知识库', '知识库检索', '向量', '嵌入', 'rag', 'knowledge', 'vector', 'embedding', 'rerank', '重排', '检索'],
  mcp: ['mcp', '工具', '插件', 'tool', 'model context protocol'],
  skills: ['技能', '能力包', 'skill', 'skills'],
  prompt: ['提示词', 'prompt', '提示'],
  memories: ['记忆', '长期记忆', 'memory', 'memories'],
  template: ['模板', '整理模板', 'template'],
  file: ['文件', '工作区', '目录', 'file', 'workspace', 'folder'],
  shortcuts: ['快捷键', '键盘', 'shortcut', 'keyboard', 'hotkey'],
  imageMethod: ['图像识别', '文字识别', '图片识别', 'ocr', 'vlm', '视觉模型'],
  audio: ['语音', '音频', '录音', '朗读', '转写', 'audio', 'voice', 'speech', 'tts', 'stt', 'asr', 'sensevoice', 'funasr'],
  meeting: ['会议', '纪要', '会议录音', 'meeting', 'summary', 'minutes'],
  report: ['周报', '汇报', 'weekly report', 'report'],
  dev: ['开发者', '代理', '调试', '数据清理', '配置文件', 'dev', 'developer', 'proxy', 'debug'],
}

export type ModelType = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'rerank';

export interface ModelConfig {
  id: string
  model: string
  modelType: ModelType
  temperature?: number
  topP?: number
  voice?: string
  enableStream?: boolean
  maxTokens?: number
  tokenLimitParam?: 'max_completion_tokens' | 'max_tokens'
}

export interface AiConfig {
  key: string
  title: string
  apiKey?: string
  baseURL?: string
  templateKey?: string
  templateSource?: 'builtin' | 'remote' | 'custom'
  icon?: string
  apiKeyUrl?: string
  customHeaders?: Record<string, string>
  models?: ModelConfig[]
  // 保持向后兼容
  model?: string
  temperature?: number
  topP?: number
  modelType?: ModelType
  voice?: string
  speed?: number
  enableStream?: boolean
  maxTokens?: number
  tokenLimitParam?: 'max_completion_tokens' | 'max_tokens'
}

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

// Define base AI configuration without translations
const builtinProviderTemplates: AiConfig[] = [
  {
    key: 'chatgpt',
    title: 'ChatGPT',
    baseURL: 'https://api.openai.com/v1',
    icon: 'https://s2.loli.net/2025/06/25/cVMf586WTBYAju4.png',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'gemini',
    title: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    icon: 'https://s2.loli.net/2025/06/25/JU2jVxLFsW4lB6S.png',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    key: 'ollama',
    title: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    icon: 'https://s2.loli.net/2025/06/25/legkEpHACDBQ5Xz.png',
  },
  {
    key: 'lmstudio',
    title: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    icon: 'https://s2.loli.net/2025/06/25/IifFV4HTQ9dpGZE.png',
  },
]

const baseAiConfig = builtinProviderTemplates

export { baseAiConfig, builtinProviderTemplates }
