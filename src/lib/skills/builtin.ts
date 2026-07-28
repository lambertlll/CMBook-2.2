/**
 * 内置 Skill 安装与识别
 *
 * 内置 skills 随安装包分发（仓库 builtin-skills/ 目录打包为 Tauri 资源），
 * 应用启动时通过 Rust 命令 install_builtin_skills 复制到 AppData skills/ 下，
 * 并在每个内置 skill 目录写入 .builtin 标记文件（来源 + 应用版本）。
 * 前端依据 .builtin 标记识别内置 skill：设置页显示"内置"徽章、允许启用/禁用、隐藏删除按钮。
 */

import { invoke } from '@tauri-apps/api/core'
import { exists } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'

/** 内置 skill 标记文件名（与 src-tauri/src/skills.rs 的 BUILTIN_MARKER_FILE 保持一致） */
export const BUILTIN_MARKER_FILE = '.builtin'

export interface BuiltinSkillInstallResult {
  name: string
  status: 'installed' | 'updated' | 'skipped'
}

/**
 * 安装/更新内置 skills（幂等，可每次启动调用）。
 * dev 模式下资源目录不含打包文件，Rust 侧自动回退到源码仓库的 builtin-skills/ 目录。
 * 失败时仅告警不抛错，避免阻断应用启动。
 */
export async function installBuiltinSkills(): Promise<BuiltinSkillInstallResult[]> {
  try {
    const results = await invoke<BuiltinSkillInstallResult[]>('install_builtin_skills')
    // 冒烟排错：记录 installed/updated/skipped 汇总与明细
    const summary: Record<BuiltinSkillInstallResult['status'], number> = {
      installed: 0,
      updated: 0,
      skipped: 0,
    }
    for (const r of results) {
      summary[r.status] += 1
    }
    console.info(
      `[BuiltinSkills] 内置 skills 安装完成: installed=${summary.installed}, updated=${summary.updated}, skipped=${summary.skipped}`,
      results
    )
    return results
  } catch (error) {
    console.warn('[BuiltinSkills] 安装内置 skills 失败:', error)
    return []
  }
}

/**
 * 判断全局 skill 目录是否为内置 skill（存在 .builtin 标记文件）。
 * 仅全局 scope（AppData/skills/<name>）可能是内置；工作区 skill 一律返回 false。
 */
export async function isBuiltinSkill(
  skillDirectory: string,
  scope: 'global' | 'project'
): Promise<boolean> {
  if (scope !== 'global') return false
  try {
    return await exists(`${skillDirectory}/${BUILTIN_MARKER_FILE}`, {
      baseDir: BaseDirectory.AppData,
    })
  } catch {
    return false
  }
}
