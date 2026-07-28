import type { AiConfig } from '@/app/core/setting/config'

// 供应商模板仅保留本地内置模板（见 setting/config.tsx 的 builtinProviderTemplates），
// 内部版本不再从远程配置中心拉取。

function mapBuiltinTemplates(templates: AiConfig[]): AiConfig[] {
  return templates.map((template) => ({
    ...template,
    templateKey: template.templateKey || template.key,
    templateSource: 'builtin' as const,
  }))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function matchProviderTemplate({
  currentConfig,
  templates,
}: {
  currentConfig: AiConfig | undefined
  templates: AiConfig[]
}) {
  if (!currentConfig || templates.length === 0) {
    return null
  }

  if (isNonEmptyString(currentConfig.templateKey)) {
    const matchedByKey = templates.find((item) => item.key === currentConfig.templateKey)
    if (matchedByKey) {
      return matchedByKey
    }
  }

  if (isValidUrl(currentConfig.baseURL)) {
    const matchedByBaseUrl = templates.find((item) => item.baseURL === currentConfig.baseURL)
    if (matchedByBaseUrl) {
      return matchedByBaseUrl
    }
  }

  return null
}

export async function loadProviderTemplates(builtinTemplates: AiConfig[]): Promise<AiConfig[]> {
  return mapBuiltinTemplates(builtinTemplates)
}

export function getProviderTemplateMatch(currentConfig: AiConfig | undefined, templates: AiConfig[]) {
  return matchProviderTemplate({
    currentConfig,
    templates,
  }) as AiConfig | null
}
