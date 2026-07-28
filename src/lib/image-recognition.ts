import { fetchAiDesc, fetchAiDescByImage } from '@/lib/ai/description'
import { getAISettings } from '@/lib/ai/utils'
import ocr from '@/lib/ocr'

export type ImageRecognitionStage = 'vlm' | 'ocr' | 'description'

export interface ImageRecognitionResult {
  content: string
  desc: string
  method: 'vlm' | 'ocr' | 'none'
}

interface RecognizeImageOptions {
  imagePath?: string | null
  base64?: string | null
  shouldGenerateDescription?: boolean
  onProgress?: (stage: ImageRecognitionStage) => void
}

async function tryRecognizeWithVlm(base64: string): Promise<string | null> {
  const content = await fetchAiDescByImage(base64)
  return content?.trim() ? content : null
}

async function recognizeWithOcr(
  imagePath?: string | null,
  shouldGenerateDescription = false,
  onProgress?: (stage: ImageRecognitionStage) => void
): Promise<ImageRecognitionResult> {
  if (!imagePath) {
    return {
      content: '',
      desc: '',
      method: 'none',
    }
  }

  onProgress?.('ocr')
  const content = await ocr(imagePath) || ''
  let desc = content

  if (shouldGenerateDescription && content.trim()) {
    onProgress?.('description')
    desc = await fetchAiDesc(content).then((res) => res || content) || content
  }

  return {
    content,
    desc,
    method: 'ocr',
  }
}

export async function recognizeImageWithFallback({
  imagePath,
  base64,
  shouldGenerateDescription = false,
  onProgress,
}: RecognizeImageOptions): Promise<ImageRecognitionResult> {
  try {
    const vlmConfig = base64 ? await getAISettings('imageMethodModel') : undefined
    if (base64 && vlmConfig?.model) {
      onProgress?.('vlm')
      const content = await tryRecognizeWithVlm(base64)

      if (content) {
        return {
          content,
          desc: content,
          method: 'vlm',
        }
      }
    }
  } catch (error) {
    console.warn('VLM image recognition failed, falling back to OCR:', error)
  }

  return recognizeWithOcr(imagePath, shouldGenerateDescription, onProgress)
}
