import { platform } from "@tauri-apps/plugin-os";

// 缓存平台检测结果
let cachedTauriResult: boolean | null = null;

// PC 端专用版本，始终返回 false（移动端代码已移除）
export function isMobileDevice() {
  return false;
}

// 检查是否在 Tauri 环境中运行
export function checkIsTauri(): boolean {
  // 如果已经检测过，直接返回缓存结果
  if (cachedTauriResult !== null) {
    return cachedTauriResult;
  }

  try {
    // 尝试调用 Tauri API，如果成功则说明在 Tauri 环境中
    platform();
    cachedTauriResult = true;
    return true;
  } catch {
    cachedTauriResult = false;
    return false;
  }
}
