'use client'

import { create } from 'zustand'

/**
 * 全局网络状态 store。
 * 三层检测：
 * 1. navigator.onLine + online/offline 事件（基础，浏览器 API）
 * 2. 主动探测失败反馈：调用方在 AI/ASR 请求失败且为网络类错误时调 markOffline()
 * 3. 恢复检测：探测成功时调 markOnline()
 * 离线模式用途：会议录音可继续（纯本地），但跳过实时转写/整段转写/AI 纪要，
 * 录音保留，联网后提示补转写。
 */

export type NetworkStatus = 'online' | 'offline' | 'unknown'

interface NetworkState {
  status: NetworkStatus
  /** 标记离线（请求失败为网络类错误时调用） */
  markOffline: () => void
  /** 标记在线（探测成功/online 事件时调用） */
  markOnline: () => void
  /** 重置为未知（应用启动时） */
  reset: () => void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  status:
    typeof navigator !== 'undefined'
      ? navigator.onLine
        ? 'online'
        : 'offline'
      : 'unknown',
  markOffline: () => set({ status: 'offline' }),
  markOnline: () => set({ status: 'online' }),
  reset: () =>
    set({
      status:
        typeof navigator !== 'undefined'
          ? navigator.onLine
            ? 'online'
            : 'offline'
          : 'unknown',
    }),
}))

/**
 * 在应用根挂载一次：监听 online/offline 事件同步 store。
 * 返回清理函数（组件卸载时调用）。
 */
export function initNetworkListeners(): () => void {
  const handleOnline = () => useNetworkStore.getState().markOnline()
  const handleOffline = () => useNetworkStore.getState().markOffline()

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}

/**
 * 判断错误是否为网络类（断网/连接失败/超时）：
 * - 无 HTTP 状态码的请求失败（Rust 端网络错误）
 * - 超时/连接拒绝/网络错误关键字
 * 返回 true 时调用方可据此标记离线或快速失败。
 *
 * 注意：HTTP 状态码类错误（4xx/5xx，含业务文案带"连接/超时"字样如"连接数超限"）
 * 一律不算网络类——避免服务端业务错误误判为断网导致永久离线（P0-3）。
 */
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  // Rust 端错误格式 "Request failed: {status} {body}"：有状态码的是 HTTP 类错误，非断网
  const statusMatch = msg.match(/Request failed: (\d{3})\b/)
  if (statusMatch) {
    return false
  }
  // 无状态码时才按关键字判定（连接失败/超时/网络错误）
  return (
    lower.includes('network') ||
    lower.includes('net::') ||
    lower.includes('failed to connect') ||
    lower.includes('connection refused') ||
    lower.includes('connect error') ||
    lower.includes('socket') ||
    lower.includes('timeout') ||
    lower.includes('超时') ||
    lower.includes('网络') ||
    lower.includes('offline') ||
    lower.includes('dns') ||
    lower.includes('无网络')
  )
}
