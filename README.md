<div align="center">
  <h1>CMBook（招本）</h1>
  <p><strong>招本，记录招行智慧 —— 录音 + 笔记 → AI 智能纪要，一站式客户会议管理工具</strong></p>
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-2.4.0-0f766e?style=flat-square">
    <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-ffc131?style=flat-square&logo=tauri&logoColor=111111">
    <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white">
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=111111">
    <img alt="License" src="https://img.shields.io/github/license/lambertlll/CMBook?style=flat-square&color=0f766e">
  </p>
</div>

## 项目简介

CMBook（招本）是一款面向客户经理的智能会议管理工具，以「录音 → 转写 → AI 纪要 → 客户管理」为核心链路，将会议录音、语音转写、AI 结构化纪要、客户拜访管理、待办追踪和知识库问答融为一体。所有数据本地存储，凭据加密保护，隐私安全可控。

## 核心功能

### 会议录音与转写

- **长时间录音** — 支持 2 小时以上会议录音，分段存储，崩溃后可恢复
- **续录** — 已结束的会议可继续追加录音
- **分段转写** — 超过 10 分钟自动切分，最多 3 段并行转写，失败自动重试
- **实时转写** — 基于阿里云 qwen3-asr 的 WebSocket 真流式实时转写，~100ms 帧级延迟，边录边看
- **说话人分离** — FunASR 自动标注不同说话人
- **热词注入** — 支持自定义热词提升识别准确率
- **音频格式兼容** — 原始格式（webm/opus 等）本地保存，转写时自动转码适配 STT API

### AI 智能纪要

- **5 种纪要模板** — 标准会议纪要、行动项清单、决策记录、简要纪要、客户拜访纪要（银行场景专用）
- **自定义模板** — 在设置中管理自定义纪要模板
- **流式生成** — AI 流式输出结构化纪要，实时可见
- **模型灵活切换** — 每个会议可独立选择 AI 模型（DeepSeek V4、Qwen 等）
- **标题自动生成** — AI 从转录内容提取 ≤10 字标题
- **三栏视图** — 笔记 / 转录 / 纪要并排查看编辑
- **导出 Word** — 纪要一键导出为 Word 文档（.doc）

### 客户拜访管理

- **客户档案** — 企业/个人客户管理，支持搜索、筛选、置顶
- **拜访时间线** — 按时间倒序展示拜访记录，关联的会议纪要自动展示
- **拜访全生命周期** — 访前尽调 → 访中录音纪要 → 访后待办追踪，完整闭环
- **访前材料** — 列出客户访前目录文件，一键 AI 生成访前尽调报告
- **客户知识库** — 按访前/访中/访后/资料分组管理，支持拖拽上传（.md/.txt/.docx/.pdf），自动向量化索引
- **AI 客户报告** — 一键生成财报分析、审贷会材料
- **会议自动归类** — 未关联客户的会议 AI 自动识别并归类
- **任务中心** — 顶部横条展示当前客户进行中的 AI 生成任务

### 周报

- **AI 一键生成** — 自动汇总本周拜访记录、待办完成情况，AI 流式生成三段式周报（本周拜访 / 待办进展 / 下周规划）
- **12 周导航** — 左栏展示最近 12 周周报列表，快速切换查看
- **编辑/预览切换** — 中栏支持 Markdown 编辑与渲染预览双模式，编辑工具栏一键插入格式
- **周统计面板** — 右栏展示本周拜访次数、待办完成率等关键数据
- **自定义模板** — 设置中管理多个周报模板，生成时选择对应模板
- **独立模型配置** — 周报生成可使用独立 AI 模型，与会议纪要模型解耦
- **多格式导出** — 支持复制剪贴板、另存为笔记、导出 Word 文档

### 待办事项

- **纪要待办自动提取** — 会议纪要生成后，AI 自动解析待办事项
- **确认弹窗** — 待办提取后弹出确认窗口，用户可勾选确认或跳过
- **智能分组** — 按逾期 / 今天 / 本周 / 以后 / 已完成五组展示
- **客户关联** — 每条待办绑定客户与拜访记录
- **办结时间** — 手动添加待办时可设置办结截止日期
- **角标提醒** — 客户 Tab 入口显示未完成待办数量
- **新待办高亮** — 新提取的待办 10 秒内高亮动画提示

### AI 对话与知识库

- **多模型对话** — 支持切换 AI 模型，流式打字机输出
- **RAG 知识库检索** — 对话中可开关知识库检索增强
- **图片附件** — 最多 6 张图片，拖拽排序、粘贴上传
- **文件关联** — 将笔记文件作为对话上下文
- **引用对话** — 编辑器中选中文本可引用到 AI 对话
- **联网搜索** — 支持 Tavily / Bocha 等搜索引擎
- **MCP 工具集成** — Model Context Protocol 外部工具链对接
- **Skills 技能系统** — 全局/项目级可执行技能包
- **长期记忆** — AI 持久化记忆管理
- **Agent 审批** — AI Agent 操作需经用户审批确认
- **消息操作** — 复制 / 朗读 / 翻译 / 提取为笔记

### Markdown 笔记编辑器

- **TipTap 富文本** — Markdown 双向支持，所见即所得
- **斜杠命令** — 输入 `/` 触发命令菜单
- **代码高亮** — highlight.js 语法高亮
- **数学公式** — KaTeX 行内/块级公式
- **Mermaid 图表** — 流程图 / 时序图 / Gantt 图
- **表格编辑** — 完整的行列增删
- **AI 补全** — 内联 AI 续写
- **AI 润色** — 选中文字一键润色/精简/扩写/翻译，Diff 预览
- **多格式导出** — Markdown / HTML / JSON / PDF / Word（.doc）
- **图床上传** — 支持 GitHub / PicGo / S3 / SMMS 四种图床

### 多端同步

- **6 种同步平台** — GitHub / Gitee / Gitlab / Gitea / S3 / WebDAV
- **自动同步** — 定时自动推拉，打开时自动拉取
- **数据同步** — 标签、记忆等应用数据自动上传/下载
- **冲突解决** — 同步冲突检测与交互式解决
- **同步状态** — 状态栏实时显示连通状态

### 其他功能

- **OCR 图片识别** — 多语言 OCR（中简/繁、英、日、韩），VLM 降级识别
- **向量知识库** — 本地向量数据库，BM25 混合检索，Re-rank 重排，可配置切块/重叠/阈值
- **快捷键自定义** — 编辑器与全局快捷键
- **国际化** — 中/英/繁/日/葡 5 种语言，next-intl
- **凭据加密** — API Key 加密存储，主密钥由系统钥匙串（keyring）管理

## 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 前端框架 | Next.js 15 + React 19 |
| 编辑器 | TipTap 3 |
| 状态管理 | Zustand 5 |
| UI 组件 | shadcn/ui + Tailwind CSS 4 |
| 国际化 | next-intl |
| 数据存储 | SQLite (tauri-plugin-sql) + IndexedDB |
| STT 语音转写 | 硅基流动 SenseVoice / 阿里云百炼 FunASR / qwen3-asr |
| AI 纪要 | DeepSeek V4 / Qwen / 其他 OpenAI 兼容模型 |
| 向量检索 | 本地 Embedding + BM25 混合检索 + Re-rank |

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm ≥ 8
- Rust ≥ 1.70
- CMake
- LLVM（Windows 需要，用于 libclang）

### 安装运行

```bash
git clone https://github.com/lambertlll/CMBook-2.2.git
cd CMBook-2.2
pnpm install
pnpm run tauri dev
```

### Windows 启动（每次新开终端）

```powershell
$env:LIBCLANG_PATH="D:\Program Files\LLVM\bin"; $env:CFLAGS="/utf-8"; $env:CXXFLAGS="/utf-8"
cd D:\AImeeting\CMBook-2.2
pnpm run tauri dev
```

开发服务器默认运行在 `http://localhost:3456`。

## AI 模型配置

在设置 → AI 模型中添加模型配置：

| 用途 | 推荐模型 | 提供商 |
|------|---------|--------|
| 会议纪要生成 | DeepSeek-V4-Flash / V4-Pro | 硅基流动 / DeepSeek 官方 |
| 周报生成 | DeepSeek-V4-Flash / Qwen | 硅基流动 / 阿里云百炼 |
| 语音转写 (STT) | SenseVoiceSmall / FunASR / qwen3-asr | 硅基流动（免费）/ 阿里云百炼 |
| 日常对话 | Qwen3-8B（内置免费） | CMBook 默认 |

硅基流动 API 配置示例：
- Base URL：`https://api.siliconflow.cn/v1`
- 模型名：`deepseek-ai/DeepSeek-V4-0324` 或 `deepseek-ai/DeepSeek-V4-Flash`

## 项目结构

```
CMBook-2.2/
├── src/
│   ├── app/core/
│   │   ├── main/
│   │   │   ├── meeting/      # 会议录音、转写、纪要、实时转写
│   │   │   ├── customer/     # 客户管理、拜访时间线、知识库
│   │   │   ├── report/       # 周报生成、编辑、导出
│   │   │   ├── chat/         # AI 对话面板
│   │   │   └── editor/       # Markdown 编辑器
│   │   └── setting/          # 设置页面（含周报设置）
│   ├── components/            # 通用组件（待办面板等）
│   ├── stores/               # Zustand 状态管理
│   ├── db/                   # SQLite 数据访问层
│   └── lib/                  # 工具库（OCR、RAG、同步等）
├── src-tauri/                # Rust 后端（录音、ASR、文件操作）
├── messages/                 # i18n 翻译文件（zh/en/zh-TW/ja/pt-BR）
└── .github/workflows/        # CI 构建（Windows/macOS）
```

## 致谢

- [codexu/note-gen](https://github.com/codexu/note-gen) — 本项目基于此开源笔记应用进行二次开发
- [硅基流动](https://cloud.siliconflow.cn/) — 提供免费的 STT 和 AI 模型服务
- [DeepSeek](https://deepseek.com/) — 高质量开源大语言模型
- [阿里云百炼](https://bailian.console.aliyun.com/) — FunASR / qwen3-asr 语音识别服务

## 许可证

[MIT License](./LICENSE)
