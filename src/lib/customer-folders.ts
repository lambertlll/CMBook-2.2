import { exists, mkdir, rename } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from './workspace'

// 客户文件夹根目录（工作区相对路径）
export const CUSTOMER_ROOT = 'customers'

// 客户文件夹的固定子目录（访前/访中/访后产物 + 用户资料）
export const CUSTOMER_SUBFOLDERS = ['访前', '访中', '访后', '资料'] as const

// 访中产物子目录名（会议纪要自动导出的目标目录，与 CUSTOMER_SUBFOLDERS[1] 保持一致）
export const CUSTOMER_MEETING_SUBFOLDER = '访中'

// 客户文件夹名称最大长度（按 Unicode 码点计，避免 Windows 路径过长）
const MAX_FOLDER_NAME_LENGTH = 60

// Windows 保留设备名（不区分大小写），不能直接用作目录名
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 清洗客户名称，得到合法的文件夹名：
 * 1. 剔除 Windows 非法字符 \ / : * ? " < > | 与控制字符；
 * 2. 按 Unicode 码点限长（[...str] 切分，不会切断 emoji 代理对）；
 * 3. 再 trim 首尾空格和点号（限长后可能残留尾部空格/点，Windows 不允许目录名以其结尾）；
 * 4. 命中 Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）时追加下划线后缀。
 * 清洗结果为空时返回空串（调用方需校验）。
 */
export function sanitizeCustomerFolderName(name: string): string {
  const stripped = name
    // Windows 文件系统非法字符
    .replace(/[\\/:*?"<>|]/g, '')
    // 控制字符
    .replace(/[\x00-\x1f]/g, '')
  // 按码点限长，避免切断 emoji 等代理对字符
  const truncated = [...stripped].slice(0, MAX_FOLDER_NAME_LENGTH).join('')
  // 限长后再去首尾空格与点号
  const cleaned = truncated.replace(/^[\s.]+|[\s.]+$/g, '')
  // 保留设备名加后缀规避（大小写不敏感）
  if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
    return `${cleaned}_`
  }
  return cleaned
}

/**
 * 检查工作区相对路径是否存在（兼容自定义工作区绝对路径与默认 AppData 工作区）
 */
async function workspacePathExists(relativePath: string): Promise<boolean> {
  const options = await getFilePathOptions(relativePath)
  return exists(
    options.path,
    options.baseDir ? { baseDir: options.baseDir } : undefined
  )
}

/**
 * 幂等创建客户文件夹结构：customers/<客户名>/{访前,访中,访后,资料}
 * 同名目录已存在时视为同名冲突，自动追加 -2、-3 后缀，返回实际使用的相对路径。
 * 注意：创建客户时调用一次并把返回路径落库；后续请使用库中存的 folderPath，
 * 不要对同一客户重复调用本函数（会被当作新冲突而追加后缀）。
 */
export async function ensureCustomerFolderStructure(
  customerName: string
): Promise<string> {
  const base = sanitizeCustomerFolderName(customerName)
  if (!base) {
    throw new Error('客户名称清洗后为空，无法创建文件夹')
  }

  // 同名冲突：目录已存在则追加 -2、-3 后缀，直到找到可用名称
  let candidate = base
  let suffix = 2
  while (await workspacePathExists(`${CUSTOMER_ROOT}/${candidate}`)) {
    candidate = `${base}-${suffix}`
    suffix++
  }

  // mkdir recursive 幂等创建 4 个子目录
  const folderPath = `${CUSTOMER_ROOT}/${candidate}`
  for (const sub of CUSTOMER_SUBFOLDERS) {
    const options = await getFilePathOptions(`${folderPath}/${sub}`)
    await mkdir(options.path, {
      baseDir: options.baseDir,
      recursive: true,
    })
  }
  return folderPath
}

/**
 * 客户改名时重命名文件夹：customers/<旧名> → customers/<新名>
 * 同名冲突自动追加 -2、-3 后缀（与 ensureCustomerFolderStructure 一致）。
 * 返回新的相对路径；旧路径不存在时返回空串（调用方决定是否继续更新库记录）。
 * 注意：重命名会移动客户文件夹内全部产物（访前/访中/访后/资料），
 * 调用方需同步更新库中的 folderPath 与关联的导出路径。
 */
export async function renameCustomerFolder(
  oldFolderPath: string,
  newCustomerName: string
): Promise<string> {
  const base = sanitizeCustomerFolderName(newCustomerName)
  if (!base) {
    throw new Error('客户名称清洗后为空，无法重命名文件夹')
  }
  if (!oldFolderPath) return ''

  // 旧目录不存在（如从未建文件夹）：无需移动，直接返回新名称的目录路径（不实际创建）
  if (!(await workspacePathExists(oldFolderPath))) {
    return `${CUSTOMER_ROOT}/${base}`
  }

  // 目标同名冲突（含自身路径相同的情形——重名不改时不移动）
  let candidate = base
  let suffix = 2
  while (
    await workspacePathExists(`${CUSTOMER_ROOT}/${candidate}`)
  ) {
    // 与旧路径完全相同视为无变化
    if (`${CUSTOMER_ROOT}/${candidate}` === oldFolderPath) {
      return oldFolderPath
    }
    candidate = `${base}-${suffix}`
    suffix++
  }

  const newFolderPath = `${CUSTOMER_ROOT}/${candidate}`
  const oldOptions = await getFilePathOptions(oldFolderPath)
  const newOptions = await getFilePathOptions(newFolderPath)
  await rename(oldOptions.path, newOptions.path, {
    oldPathBaseDir: oldOptions.baseDir,
    newPathBaseDir: newOptions.baseDir,
  })
  return newFolderPath
}
