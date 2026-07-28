/**
 * 会议音频 MIME 类型与文件扩展名映射
 */

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

const EXT_TO_MIME: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

/** 已知的音频扩展名（用于扫描、回退与清理） */
export const KNOWN_AUDIO_EXTS = Object.keys(EXT_TO_MIME)

/**
 * 按 MIME 类型取文件扩展名（忽略 ;codecs= 参数），未知类型回退 webm
 */
export function extFromMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return MIME_TO_EXT[base] || 'webm'
}

/**
 * 按文件路径还原 MIME 类型，未知扩展名回退 audio/wav（兼容旧数据）
 */
export function mimeTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_MIME[ext] || 'audio/wav'
}
