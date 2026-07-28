# AGENTS.md

本文件为 AI 助手（Kimi Code 等）提供本仓库的工作指引。阅读者无需任何项目背景。

## 项目概述

CMBook（中文名"招本"，口号"招本，记录招行智慧"）：基于 [codexu/note-gen](https://github.com/codexu/note-gen) 二次开发的跨平台笔记/会议工具（桌面 Windows/macOS/Linux，另有 iOS/Android 移动端），将用于招商银行内部。核心是"录音 → STT 转写 → AI 生成结构化会议纪要"的会议模式，完整保留原版笔记功能（Markdown 编辑、AI 对话、多端同步、向量知识库 RAG、MCP、Skills 等）。

与原版的主要区别：完整的会议模式（长时录音 2h+ 分段转写、4 种纪要模板、纪要模型可选）、多会议列表管理与后台并行处理、编辑器常驻格式工具栏。

## 技术栈

- **前端**：Next.js 15（Turbopack，静态导出到 `out/`）+ React 19 + TypeScript，TipTap 3 编辑器，Zustand 5 状态管理，shadcn/ui（Radix）+ Tailwind CSS 4，next-intl 国际化，pnpm 包管理
- **桌面端**：Tauri 2（Rust）。关键插件：tauri-plugin-sql（SQLite，底层 sqlx 连接池，数据库文件 `sqlite:note.db`）、tauri-plugin-store（store.json 配置）、tauri-plugin-keyring（凭据主密钥）、tauri-plugin-shell/fs/http/window-state 等（tauri-plugin-updater 已移除，内部版本不做自动升级）
- **AI**：OpenAI 兼容 API（DeepSeek / Qwen 等，前端 `openai` SDK + Rust 侧流式 SSE）；STT 用硅基流动 SenseVoice 或阿里云百炼 FunASR
- **同步**：GitHub / Gitee / Gitea / GitLab / WebDAV / S3（见 `src/lib/sync/`）

## 目录结构

- `src/app/core/` — 桌面端主界面：`main/` 下分 `chat`（AI 对话）、`editor`（编辑器）、`file`（文件）、`mark`（记录）、`meeting`（会议模式）、`customer`（2.0 客户拜访全流程：客户列表 `customer-list.tsx`、时间线 `visit-timeline.tsx`、访前/访后生成 `previsit-section.tsx`/`postvisit-section.tsx`、知识库面板 `customer-knowledge.tsx`、生成任务管理器 `visit-generate-manager.ts`（模块级，全局串行队列+后台完成检测，组件卸载不中断）、`customer-store.ts`）；`setting/` 为设置页
- `src/app/mobile/` — 移动端界面
- `src/lib/web/` — 联网工具：`search.ts`（Tavily/博查）、`fetch.ts`（网页抓取，SSRF 内网拦截 + 10MB 限量）；搜索 API Key 走 credential-crypto，`webSearchApiKeys` 无条件禁止进同步/明文持久化域
- `src/lib/customer-folders.ts` / `customer-knowledge.ts` — 客户文件夹（`customers/<名>[-N]/访前|访中|访后|资料`）与知识库索引；会议纪要导出路径存 `meetings.exportedFilePath`，改名/删会议据此级联清理；拜访会议（visitId）转写完成自动生成一次纪要
- `src/app/core/main/meeting/` — 会议模块：录音（`meeting-audio-recorder.ts`、`meeting-recorder-manager.ts`）、转写（`meeting-transcribe.ts`、`meeting-transcribe-aliyun.ts`、`meeting-transcribe-qwen3.ts`）、实时转写预览（`meeting-live-transcript.ts`，模块级单例；qwen3-asr-flash 走 30 秒切块，qwen3-asr-flash-realtime 走 WebSocket 真流式；右侧面板 `meeting-live-transcript-panel.tsx`）、纪要生成（`meeting-generate-summary.ts`）、状态（`meeting-store.ts`）
- `src/components/` — 共享 UI 组件
- `src/stores/` — Zustand stores（会议模块的 store 在会议目录内）
- `src/db/` — SQLite 数据访问层：`index.ts` 统一初始化建表/索引，按实体分文件（chats、notes、tags、marks、vector、conversations、memories、activity、meetings、customers、visits、schema-meta）
- `src/lib/` — 工具与子系统：`ai/`（AI 调用、embedding）、`sync/`（多端同步）、`mcp/`、`skills/`、`speech/`、`agent/` 等
- `src/hooks/` — 共享 React hooks
- `src-tauri/src/` — Rust 后端命令：`ai.rs`（流式 SSE）、`asr_dashscope_realtime.rs`（阿里云百炼 qwen3-asr-flash-realtime WebSocket 实时识别通道，session 式命令 + app.emit 推送）、`mcp.rs` / `mcp_runtime.rs`、`backup.rs`、`skills.rs`、`screenshot.rs`、`fuzzy_search.rs`、`ocr_packages.rs`、各平台 OCR（`android_ocr.rs` / `ios_ocr.rs`，macOS/iOS 另有 `src-tauri/native-ocr/`）。**注意双入口：`main.rs` 是桌面端真实入口（独立 Builder + generate_handler），`lib.rs` 的 `run()` 供移动端——新增命令必须注册到 `main.rs`（lib.rs 同步注册仅为编译一致），只注册 lib.rs 会导致桌面端 command not found**
- `src-tauri/capabilities/` — Tauri 权限配置（`default.json`、`desktop.json`）
- `messages/` — next-intl 文案，5 种语言（en、ja、pt-BR、zh、zh-TW），`messages/common/` 为公共文案
- `scripts/sync-version.sh` — 从 `tauri.conf.json` 同步版本号到 iOS Info.plist

## 常用命令

```bash
# 开发（Windows 必须先设环境变量）
export LIBCLANG_PATH="D:/Program Files/LLVM/bin" CFLAGS="/utf-8" CXXFLAGS="/utf-8"
pnpm run tauri dev        # 桌面端开发（前端跑在 3456 端口）

# 验证（改动后必须跑）
npx tsc --noEmit                    # 前端类型检查
pnpm lint                           # ESLint（next lint）
cd src-tauri && cargo check         # Rust 编译检查
cd src-tauri && cargo test --lib    # Rust 单元测试

# 构建
pnpm build                          # 前端构建（next build --turbopack，自动清理 sourcemap）
pnpm run tauri build                # 桌面安装包
pnpm sync-version                   # iOS 构建前同步版本号
pnpm ios-build                      # iOS 构建（macOS，需 bash）
```

## 测试策略

- **Rust**：单元测试内嵌在 `src-tauri/src/*.rs`（`ai.rs`、`mcp.rs`、`mcp_runtime.rs` 等），用 `cargo test --lib` 运行
- **前端**：无整体测试框架，仅个别独立模块用 Node 内置 `node:test` 写规格（如 `src/lib/vector-document-key.spec.mjs`，直接 `node --test` 运行）
- 改动后最低要求是 `npx tsc --noEmit` 和 `cargo check` 通过

## 发布流程

- 版本号以 `src-tauri/tauri.conf.json` 为准（当前 0.31.1）
- `.github/workflows/release.yml`：推送到 `release` 分支触发，构建 Android（NDK 29）和桌面端，产物上传 GitHub Releases
- 自动升级已停用：tauri-plugin-updater 及其配置（原端点 download.notegen.top / GitHub Releases）已移除，内部版本通过统一分发更新

## 代码约定

- **提交信息**：Conventional Commits + 中文描述，如 `fix: 长音频转写卡住`、`feat: 集成阿里云百炼 ASR`
- **注释**：中文，风格与周边代码一致；改动行为时同步更新注释
- **Zustand**：订阅必须用 selector 精确取字段（`useStore((s) => s.x)`），禁止全量订阅
- **SQL**：一律参数绑定（`$1, $2`），禁止字符串拼接；动态 SET 走字段白名单；批量操作用单条 SQL（`json_each`），不要用裸 `BEGIN/COMMIT`（连接池不保证同连接）
- **Rust**：async 命令中禁止同步阻塞 I/O（用 `spawn_blocking`）；`Mutex` 不要跨 I/O 持锁；reqwest Client 用 `OnceLock` 共享

## 数据与安全

- 会议音频存 AppData 目录，按真实格式扩展名（webm/ogg 等，旧数据为 .wav）
- 敏感凭据加密：`src/stores/credential-crypto.ts` 是唯一加解密入口（keyring 主密钥 + AES，`enc:v1:` 前缀，兼容明文降级，keyring 不可用时静默回退明文）。**新增敏感配置必须走这里，禁止明文写入 store.json**
- Tauri capabilities 改动需评估：fs/assetProtocol 的宽 scope 是自定义工作区功能必需；shell 仅允许 `bash -c`（skills 功能依赖）；CSP 在 `tauri.conf.json` 配置（connect-src 放开 http/https/ws/wss，AI 接口直连需要），改动后需实际运行验证

## 注意事项

- TipTap v3 的 `useEditor` 只在挂载时读取一次 `content`，外部数据更新需用 `key` 重建或 `setContent`（参考 `meeting-result.tsx` 的 lastContentRef 模式）
- 会议模块录音器由 `meeting-recorder-manager.ts` 模块级持有，组件卸载不销毁——不要在组件 cleanup 里 destroy
- 转写/纪要生成的失败路径统一走 `setMeetingError(id, msg)` 记录错误并回退状态
- 会议支持续录：多段音频路径存 `meetings.audioSegments`（JSON 数组），读取一律走 `meeting-store.ts` 的 `getMeetingAudioPaths()`（兼容老单段 `audioPath` 数据）；续录只转写新段并追加到 transcript
- 会议纪要是可编辑 TipTap 编辑器，summary 始终以 markdown 存库，双向转换用 `@tiptap/markdown` 的 `Markdown` 扩展（`contentType: 'markdown'` / `getMarkdown()`）；局部 AI 改写入口在 `meeting-summary-bubble.tsx`
- 桌面端 Tauri 应用标识为 `com.codexu.NoteGen`；前端为静态导出（`frontendDist: "../out"`），不能用 Next.js 服务端特性
