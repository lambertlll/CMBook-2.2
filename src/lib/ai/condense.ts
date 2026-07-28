import { fetchAi } from './chat'
import { Chat } from '@/db/chats'
import { estimateTokens } from './token-counter'
import useSettingStore from '@/stores/setting'
export { getChatsAfterLastClear, buildChatHistoryForAI, buildMessagesWithHistory } from './history-messages'

const CONDENSE_THRESHOLD = 3 // AI 消息超过 3 条时检查压缩
const MIN_TOKEN_TO_CONDENSE = 100 // 单条消息超过 100 token 才压缩

/**
 * 获取可压缩的 AI 消息（排除用户消息和已压缩的）
 * 规则：
 * - 用户消息永不压缩
 * - 最新的 N 条 AI 消息不压缩
 * - 已有摘要的消息不重复压缩
 */
function getCondensableChats(chats: Chat[], keepLatestCount: number): Chat[] {
  // 只处理 AI (system) 的 chat 和 note 类型消息
  const aiMessages = chats.filter(c =>
    (c.type === 'chat' || c.type === 'note') &&
    c.role === 'system'
  )

  // 排除最新的 N 条
  const toCheck = aiMessages.slice(0, -keepLatestCount)

  // 只返回没有摘要的消息
  return toCheck.filter(c => !c.condensedContent)
}

/**
 * 检查是否需要压缩
 */
export async function shouldCondense(chatsAfterClear: Chat[]): Promise<boolean> {
  const settings = useSettingStore.getState()

  // 检查是否启用摘要
  if (!settings.enableCondense) {
    return false
  }

  // 获取可压缩的 AI 消息
  const condensableChats = getCondensableChats(chatsAfterClear, settings.keepLatestCount)

  if (condensableChats.length < CONDENSE_THRESHOLD) {
    return false
  }

  // 检查这些消息中是否有需要压缩的（超过 token 阈值）
  const needsCondense = condensableChats.some(chat =>
    estimateTokens(chat.content || '') > MIN_TOKEN_TO_CONDENSE
  )

  return needsCondense
}

/**
 * 为多条消息生成摘要
 * @returns 每条消息的摘要结果数组
 */
export async function condenseChats(chatsAfterClear: Chat[]): Promise<Array<{ chatId: number, summary: string | null }>> {
  const settings = useSettingStore.getState()

  // 检查是否启用摘要
  if (!settings.enableCondense) {
    return []
  }

  // 获取需要压缩的消息
  const toCondense = getCondensableChats(chatsAfterClear, settings.keepLatestCount)

  if (toCondense.length === 0) {
    return []
  }

  // 获取用户配置的摘要模型
  const { condenseModel } = settings
  const hasCondenseModel = !!condenseModel

  // 如果配置了 condenseModel，使用 'condenseModel' store key，否则使用 'primaryModel'
  const storeKey = hasCondenseModel ? 'condenseModel' : 'primaryModel'

  // 构建提示词
  const prompt = `请将以下对话内容压缩为简洁的摘要，用于节省 token 使用量。

压缩原则：
1. 保留代码块、数据、结论、TODO 等关键信息
2. 简化过程描述和中间思考
3. 使用清晰的段落或要点组织内容
4. 控制在 ${settings.condenseMaxLength} 字以内

原始内容：
{content}

请输出摘要：`

  const results: Array<{ chatId: number, summary: string | null }> = []

  // 为每条消息生成摘要
  for (const chat of toCondense) {
    const content = chat.content || ''
    const originalTokenCount = estimateTokens(content)

    // 只压缩超过阈值的消息
    if (originalTokenCount <= MIN_TOKEN_TO_CONDENSE) {
      results.push({ chatId: chat.id, summary: null })
      continue
    }

    try {
      const finalPrompt = prompt.replace('{content}', content)
      const summary = await fetchAi(finalPrompt, storeKey)

      if (summary) {
        results.push({ chatId: chat.id, summary })
      } else {
        results.push({ chatId: chat.id, summary: null })
      }
    } catch (error) {
      console.error('[Condense] 消息', chat.id, '摘要生成出错:', error)
      results.push({ chatId: chat.id, summary: null })
    }
  }

  return results
}
