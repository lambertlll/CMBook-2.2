<div align="center">
  <h1>CMBook（招本）</h1>
  <p><strong>招本，记录招行智慧 —— 录音 + 笔记 → AI 智能纪要，一站式会议记录工具</strong></p>
  <p>
    基于开源项目 <a href="https://github.com/codexu/note-gen">codexu/note-gen</a> 优化完善
  </p>
  <p>
    <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-ffc131?style=flat-square&logo=tauri&logoColor=111111">
    <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white">
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=111111">
    <img alt="License" src="https://img.shields.io/github/license/lambertlll/CMBook?style=flat-square&color=0f766e">
  </p>
</div>

## 项目简介

本项目基于优秀的开源笔记应用 [NoteGen](https://github.com/codexu/note-gen) 进行二次开发，在保留原有笔记功能的基础上，**新增了完整的会议模式**，专注于会议场景的录音、转写和智能纪要生成。

### 与原版的主要区别

| 功能 | 原版 NoteGen | 本版本 |
|------|-------------|--------|
| 会议模式 | ❌ 无 | ✅ 完整会议录音+纪要流程 |
| 录音转写 | 仅语音便签 | 支持长时间会议录音（2h+）分段转写 |
| AI 纪要生成 | ❌ 无 | ✅ 4种专业模板，支持选择模型 |
| 多会议管理 | ❌ 无 | ✅ 左侧列表，后台并行处理 |
| 编辑器工具栏 | 选中弹出 | 常驻格式工具栏（桌面端） |
| 纪要模型选择 | ❌ 无 | ✅ 底部操作栏可选模型 |

## 核心功能：会议模式

### 使用流程

1. **开始会议** — 点击会议 Tab → 新建会议 → 自动录音
2. **边录边记** — 录音过程中用编辑器记录重点笔记
3. **结束转写** — 停止录音 → 自动 STT 转写（硅基流动 SenseVoice / 阿里云百炼 FunASR）
4. **编辑确认** — 三栏视图查看和编辑笔记/转录内容
5. **选择模型和模板** — 底部操作栏选择 AI 模型和纪要模板
6. **生成纪要** — AI 流式生成结构化会议纪要
7. **保存导出** — 保存为笔记文件 / 复制 / 重新生成

### 会议纪要模板

- **标准会议纪要** — 会议背景 + 会谈内容 + 后续待跟进事项（表格）
- **行动项清单** — 按优先级分组的待办事项
- **决策记录** — 每个决策独立记录背景、方案和结论
- **简要纪要** — 300字以内快速总结

### 技术特性

- **分段转写** — 超过10分钟自动切分，最多3段并行，失败自动重试，支持2小时以上会议
- **音频格式兼容** — 原始格式（webm/opus 等）本地保存，转写时自动转码适配 STT API
- **模型灵活切换** — 每个会议可独立选择 AI 模型（DeepSeek V4、Qwen 等）
- **数据本地存储** — SQLite 持久化，音频文件保存在本地 AppData
- **会议搜索** — 按标题/内容过滤历史会议
- **标题自动生成** — AI 从转录内容提取 ≤10 字标题
- **错误可恢复** — 录音/转写/生成失败明确提示，支持重新转写、重新生成
- **凭据加密** — API Key 加密存储，主密钥由系统钥匙串（keyring）管理

## 原版功能（完整保留）

- 📝 Markdown 笔记编辑器（TipTap，支持表格/图表/数学公式）
- 🧩 快速记录：文字、语音、截图、图片、链接、文件、待办
- 🧠 AI 对话与知识库问答
- 🔄 多端同步（GitHub / Gitee / WebDAV / S3）
- 🖼️ 图片 OCR 和 AI 识别
- 🔍 向量知识库搜索

## 技术栈

- **框架**：Tauri 2 + Next.js 15 + React 19
- **编辑器**：TipTap
- **状态管理**：Zustand
- **UI 组件**：shadcn/ui + Tailwind CSS
- **国际化**：next-intl
- **数据存储**：SQLite（tauri-plugin-sql）
- **STT**：硅基流动 SenseVoice（免费）/ 阿里云百炼 FunASR
- **AI 纪要**：支持 DeepSeek V4 / Qwen / 其他 OpenAI 兼容模型

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm ≥ 8
- Rust ≥ 1.70
- CMake
- LLVM（Windows 需要，用于 libclang）

### 安装运行

```bash
git clone https://github.com/lambertlll/CMBook.git
cd CMBook
git checkout dev
pnpm install
pnpm run tauri dev
```

### Windows 启动（每次新开终端）

```powershell
$env:LIBCLANG_PATH="D:\Program Files\LLVM\bin"; $env:CFLAGS="/utf-8"; $env:CXXFLAGS="/utf-8"
cd D:\AImeeting\note-gen
pnpm run tauri dev
```

## AI 模型配置

在设置中添加模型配置：

| 用途 | 推荐模型 | 提供商 |
|------|---------|--------|
| 会议纪要生成 | DeepSeek-V4-Flash / V4-Pro | 硅基流动 / DeepSeek 官方 |
| 语音转写 (STT) | SenseVoiceSmall / FunASR | 硅基流动（免费）/ 阿里云百炼 |
| 日常对话 | Qwen3-8B（内置免费） | CMBook 默认 |

硅基流动 API 配置：
- Base URL：`https://api.siliconflow.cn/v1`
- 模型名：`deepseek-ai/DeepSeek-V4-0324` 或 `deepseek-ai/DeepSeek-V4-Flash`

## 致谢

- [codexu/note-gen](https://github.com/codexu/note-gen) — 优秀的开源笔记应用，本项目的基础
- [硅基流动](https://cloud.siliconflow.cn/) — 提供免费的 STT 和 AI 模型服务
- [DeepSeek](https://deepseek.com/) — 高质量开源大语言模型

## 许可证

本项目遵循原版 [MIT License](./LICENSE)。
