import CryptoJS from 'crypto-js'
import { getPassword, setPassword } from 'tauri-plugin-keyring-api'

// 持久化边界加密工具：
// 敏感配置（如 API Key）写入 store.json 前用 AES 加密，主密钥保存在系统钥匙串（keyring）。
// 读取时兼容历史明文：没有 enc:v1: 前缀的值原样返回，下次写入时再加密。
// 若 keyring 不可用（如 Rust 插件未注册），静默降级为明文存储，行为与加密改造前一致。

const KEYRING_SERVICE = 'com.codexu.NoteGen'
const KEYRING_USER = 'store-credential-key'
const ENCRYPTED_PREFIX = 'enc:v1:'

let masterKeyPromise: Promise<string | null> | null = null

// 从系统钥匙串获取主密钥，不存在则生成随机密钥并写入
async function getMasterKey(): Promise<string | null> {
  if (!masterKeyPromise) {
    masterKeyPromise = (async () => {
      try {
        const existing = await getPassword(KEYRING_SERVICE, KEYRING_USER)
        if (existing) {
          return existing
        }
        // 生成 32 字节随机密钥（hex）
        const bytes = new Uint8Array(32)
        crypto.getRandomValues(bytes)
        const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
        await setPassword(KEYRING_SERVICE, KEYRING_USER, key)
        return key
      } catch (error) {
        // keyring 不可用时降级为明文存储
        console.debug('[credential-crypto] keyring 不可用，敏感配置将按明文存储:', error)
        return null
      }
    })()
  }
  return masterKeyPromise
}

// 加密敏感值；keyring 不可用时返回原文（幂等：已加密的值不会重复加密）
export async function encryptSecret(plain: string): Promise<string> {
  if (!plain || plain.startsWith(ENCRYPTED_PREFIX)) {
    return plain
  }
  const key = await getMasterKey()
  if (!key) {
    return plain
  }
  try {
    return ENCRYPTED_PREFIX + CryptoJS.AES.encrypt(plain, key).toString()
  } catch (error) {
    console.debug('[credential-crypto] 加密失败，按明文存储:', error)
    return plain
  }
}

// 解密敏感值；兼容历史明文（无前缀的值原样返回）
export async function decryptSecret(stored: string): Promise<string> {
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored
  }
  const key = await getMasterKey()
  if (!key) {
    // 无法解密时返回空串，避免把密文当密钥发出去
    return ''
  }
  try {
    const bytes = CryptoJS.AES.decrypt(stored.slice(ENCRYPTED_PREFIX.length), key)
    const plain = bytes.toString(CryptoJS.enc.Utf8)
    return plain || ''
  } catch (error) {
    console.debug('[credential-crypto] 解密失败:', error)
    return ''
  }
}
