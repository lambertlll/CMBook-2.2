import type OpenAI from 'openai'
import { convertImageToBase64 } from '@/lib/ai/utils'

const MAX_TOOL_RESULT_CHARS = 12000
const MAX_HISTORY_MESSAGES = 60

function isToolMessage(message: OpenAI.Chat.ChatCompletionMessageParam) {
  return message.role === 'tool'
}

function compactToolMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam
): OpenAI.Chat.ChatCompletionMessageParam {
  if (!isToolMessage(message)) {
    return message
  }

  const content = typeof message.content === 'string' ? message.content : ''
  if (content.length <= MAX_TOOL_RESULT_CHARS) {
    return message
  }

  return {
    ...message,
    content: [
      content.slice(0, MAX_TOOL_RESULT_CHARS),
      '',
      `[tool result truncated: ${content.length - MAX_TOOL_RESULT_CHARS} characters omitted]`,
    ].join('\n'),
  }
}

export class AgentContextManager {
  prepareMessages(
    messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const compacted = messages.map(compactToolMessage)

    if (compacted.length <= MAX_HISTORY_MESSAGES) {
      return compacted
    }

    const head = compacted.slice(0, 3)
    const tail = compacted.slice(-(MAX_HISTORY_MESSAGES - 3))
    const omitted = compacted.length - head.length - tail.length

    return [
      ...head,
      {
        role: 'system',
        content: `[Earlier conversation compacted: ${omitted} messages omitted. Continue from the preserved recent context.]`,
      },
      ...tail,
    ]
  }

  async buildCurrentUserMessage(
    text: string,
    imageUrls?: string[]
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam> {
    if (!imageUrls || imageUrls.length === 0) {
      return {
        role: 'user',
        content: text,
      }
    }

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = []

    for (const imageUrl of imageUrls) {
      const base64Image = await convertImageToBase64(imageUrl)
      if (base64Image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: base64Image,
          },
        })
      }
    }

    content.push({
      type: 'text',
      text,
    })

    return {
      role: 'user',
      content,
    }
  }
}
