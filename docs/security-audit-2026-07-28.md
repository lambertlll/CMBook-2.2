# CMBook-2.2 安全审计报告

**审计日期**: 2026-07-28
**审计范围**: 前端 (src/)、Rust 后端 (src-tauri/src/)、依赖包、配置文件
**审计结论**: **未发现后门、隐藏数据传输接口或数据外泄风险**

---

## 一、审计总结

| 审计维度 | 结果 | 说明 |
|----------|------|------|
| 后门代码 | ✅ 未发现 | 无隐藏的远程控制、命令执行或数据窃取代码 |
| 隐藏数据传输 | ✅ 未发现 | 所有网络通信均指向用户配置的 AI 端点或阿里云官方服务 |
| 硬编码凭据 | ✅ 未发现 | 所有 API Key/Token 均为运行时用户配置，走 keyring 加密存储 |
| 遥测/追踪 | ✅ 未发现 | 未集成任何第三方分析/追踪 SDK |
| 远程代码加载 | ✅ 未发现 | 所有 import() 均为本地模块，无外部 URL 动态加载 |
| 混淆代码 | ✅ 未发现 | 无 eval()、Function() 构造、unsafe 块 |
| 恶意依赖 | ✅ 未发现 | 无 postinstall 脚本、无未知来源包、无自定义 registry |
| 数据外泄路径 | ✅ 未发现 | 无读取敏感文件（SSH密钥/浏览器数据等）并外传的代码 |

---

## 二、网络通信清单

所有对外网络通信均经过审计，目标端点如下：

| 端点 | 用途 | 触发方式 | 凭证来源 |
|------|------|----------|----------|
| 用户配置的 AI API (base_url) | AI 对话/纪要生成 | 用户主动调用 | 用户在设置中配置，keyring 加密 |
| `*.cn-beijing.maas.aliyuncs.com` | 阿里云百炼 ASR 实时转写 | 用户开启录音转写 | 用户配置 API Key |
| `api.github.com` / `gitee.com` / GitLab / Gitea | 数据同步 | 用户配置并手动触发同步 | 用户配置 access token |
| 用户配置的 WebDAV / S3 | 数据同步 | 用户手动触发 | 用户配置凭据 |
| `api.tavily.com` / `api.bochaai.com` | 联网搜索 | 用户主动搜索 | 用户配置 API Key |
| `s.ee` (SM.MS 图床) | 图片上传 | 用户主动选择上传 | 用户配置 token |
| `cdn.jsdelivr.net` | GitHub CDN 加速 | 自动（仅加载静态资源） | 无需凭证 |

**无任何向未授权第三方端点发送数据的代码路径。**

---

## 三、凭证安全机制

1. **加密存储**: `credential-crypto.ts` 使用 AES (CryptoJS) 加密 + 系统 keyring 主密钥，`enc:v1:` 前缀标识加密数据
2. **同步排除**: `sync-exclusions.ts` 自动排除 `accesstoken`、`password`、`secret`、`token` 等敏感字段不参与云同步
3. **错误脱敏**: MCP 错误消息自动过滤 `key|token|secret|password=xxx` → `[REDACTED]`
4. **传输安全**: AI API Key 通过 `Authorization: Bearer` 头传输，S3 使用 SigV4 签名

---

## 四、Rust 后端 Tauri 命令审计

全部 30 个 `#[tauri::command]` 函数已逐一审查：

- **网络操作类** (4个): `ai_json_request`、`ai_binary_request`、`ai_multipart_request`、`ai_chat_completion_stream` — 均向用户配置的 AI 端点发送请求
- **ASR 类** (4个): `dashscope_asr_connect/send_pcm/finish/disconnect` — 均连接阿里云 DashScope 官方端点
- **文件操作类** (7个): 截图、备份导入导出、技能安装 — 均为本地操作，不外传
- **MCP 类** (5个): 启动/停止/消息/运行时检查/安装 — 用户主动配置
- **其他** (10个): 模糊搜索、关键词提取、OCR、字体列表、设备ID、托盘菜单、文件打开 — 均无网络操作

**无异常命令，无隐藏的数据传输行为。**

---

## 五、已知风险项（非后门，属于配置宽松问题）

以下问题不是后门或数据外泄，但属于安全加固建议，源自原版 note-gen 项目的通用配置：

| 风险等级 | 问题 | 位置 | 说明 |
|----------|------|------|------|
| 中 | Tauri fs scope 为 `**` | `capabilities/default.json` | 允许前端访问系统任意文件，这是自定义工作区功能所需 |
| 中 | shell:allow-execute `bash -c` | `capabilities/default.json` | 允许执行 shell 命令，MCP 功能依赖 |
| 中 | http:allow-fetch 为 `**` | `capabilities/default.json` | 允许请求任意 URL，AI API 直连所需 |
| 中 | withGlobalTauri: true | `tauri.conf.json` | 全局暴露 Tauri API |
| 低 | Gitee token 在 URL 参数中 | `src/lib/sync/gitee.ts` | Gitee API 自身的 OAuth2 认证方式 |
| 低 | machine-uid 获取硬件标识 | `src-tauri/src/device.rs` | 设备 ID 仅本地使用，不外传 |

**这些配置对于应用的完整功能（自定义工作区、MCP 服务器、AI API 直连、多平台同步）是必需的。在不存在前端 XSS 漏洞的前提下不会造成安全问题。**

---

## 六、结论

**CMBook-2.2 代码安全，不存在后门或隐藏的数据传输接口，信息不会通过代码层面的隐藏通道外泄。**

所有数据传输均由用户主动触发（AI 对话、录音转写、数据同步、联网搜索），目标端点均为用户自行配置的合法服务。无任何静默后台数据上传行为。
