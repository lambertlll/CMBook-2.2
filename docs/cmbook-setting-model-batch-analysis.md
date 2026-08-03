# CMBook 2.6.0 设置梳理 + 模型关联问题 + 批处理分析报告

> 日期：2026-08-03 ｜ 性质：只读诊断，未修改任何代码
> 三个问题：① 设置页失效项梳理；② 模型关联断链根因；③ 笔记/会议批处理切入点

---

## 一、设置页内容梳理（21 个 Tab，5 组导航）

### 1.1 失效 / 孤儿设置（建议删除）

| # | 设置项 | 证据（仅 store 定义、无消费方） | 判定 |
|---|---|---|---|
| 1 | `placeholderModel` | `stores/setting.ts:64,694`，全 src 无消费方（灵感由 `inspirationModel` 承担） | 失效，删除 |
| 2 | `previewTheme` | `stores/setting.ts:187,996`，无消费方（实际用 `codeTheme`） | 失效，删除 |
| 3 | `darkMode` | `stores/setting.ts:184,993`；主题已改用 next-themes | 失效，删除 |
| 4 | `language` / `setLanguage` | 仅 store；语言改用 `useI18n` + localStorage | 失效，删除 |
| 5 | `giteeAutoSync` / `gitlabAutoSync` / `giteaAutoSync` | `stores/setting.ts:226/239/255`，各 sync 组件不渲染、lib 无读取 | 失效，删除 |
| 6 | `record/`、`readAloud/`、`defaultModel/` 整目录 | 无导航入口（config.tsx 无 anchor），仅直链可达 | 孤儿页，删除或并入 |
| 7 | `chat/primary-model-settings.tsx` | chat 页用 `DefaultModelsSettings type="chat"` 替代，文件未被引用 | 孤儿组件，删除 |
| 8 | `editor/commit.tsx`、`editor/completion.tsx` | editor 页未引用，已由 `default-models-settings.tsx:87-113` 覆盖 | 孤儿组件，删除 |
| 9 | `general/tool-settings.tsx` | 仅静态文字，general 页未引用 | 占位组件，删除 |
| 10 | `readAloud/setting.tsx` 语速滑杆 | `modelType === 'audio'` 判断（:36），但模型均为 `tts` 类型，永不匹配 | 失效逻辑，随页删除 |

### 1.2 在用但有小缺陷的设置

| # | 位置 | 问题 |
|---|---|---|
| 1 | `chat/toolbar-settings.tsx:119` | `chatToolbarConfigMobile.length > 0 ? mobile : pc` —— 两者都有默认值，**PC 端也会编辑"移动端配置"**，逻辑错误，应加 `isMobile` 判断 |
| 2 | `readAloud` 与 `audio` 页语速 | `modelType` 不一致（audio 页用 `tts`、readAloud 页用 `audio`） |
| 3 | `markDescModel` 的 UI 入口丢失 | 字段消费于 `lib/ai/description.ts:12`（记录图片描述），但唯一 UI 在**孤儿页 defaultModel** 中，建议在 imageMethod 或 editor 页补入口 |

### 1.3 在用且正常（保留，不误删）

| 设置 | 证据 |
|---|---|
| 图床 imageHosting | 编辑器插图 `lib/image-handler.ts:199`、剪贴板 `mark/clipboard.tsx:106` 均在用 |
| 同步 sync | `settingsSync.ts:76-317`、`auto-data-sync-queue.ts:845`、`sync-manager.ts:133` 大量消费 |
| OCR/VLM | `control-scan.tsx:244`、`lib/image-recognition.ts:61` 在用；Rust `list_ocr_providers` |
| 朗读 | 聊天朗读 `read-aloud-control.tsx:52 → lib/audio.ts:267` 在用（但独立 readAloud 页是孤儿） |
| 记忆 memories | `lib/context/loader.ts` 自动注入对话上下文，机制在用 |
| 快捷键 | 全局 `stores/shortcut.ts:46` + 编辑器快捷键均注册生效 |
| dev 页 | proxy 被 sync/imageHosting 大量消费，无调试残留 |
| RAG/websearch/prompt/template/skills/mcp/meeting/report/file | 全部有真实消费方 |

---

## 二、模型关联断链根因（用户反馈的"默认主模型无法使用"）

### 2.1 模型配置架构

- **AiConfig**：`key/title/apiKey/baseURL/models[]`；ModelConfig：`id/model/modelType/...`
- **store 字段**：`primaryModel`（默认 `''`）、`reportModel`/`embeddingModel`/`rerankingModel`/`audioModel`/`sttModel`/`imageMethodModel`/`condenseModel`/`inspirationModel` 均为 string 引用
- **UI 入口**：`default-models-settings.tsx:38`（`ModelSelect modelKey="primaryModel"`）在"对话设置"页；`chat/primary-model-settings.tsx` 是未被引用的孤儿

### 2.2 三条断链根因（均已代码实证）

**断链 A：primaryModel 永不自赋值（最核心）**
- `initSettingData` 的自动默认循环（`setting.ts:561-589`）覆盖 completion/markDesc/commit/condense/inspiration/**report** 六项，**唯独不含 primaryModel**；
- `create.tsx:80-110` 新建配置只 `setAiModelList`，无"设为默认主模型"；
- **结果**：新用户只配 AI 模型后，`primaryModel` 恒为 `''`，全部"留空回退 primaryModel"的链路（会议纪要/周报/翻译/摘要/组织笔记）**全部断链**；
- config-health-banner 只查非空串（`config-health.ts:26`），不校验可解析性——主模型为空时横幅会提示，但指向已删模型/无 baseURL 时仍显示"已配置"。

**断链 B：下拉存裸 id vs 自动默认存组合键（格式不一致）**
- `model-select.tsx:283` 下拉 `onSelect` 存的是 **裸 id**（`item.model.id`）；
- 而自动默认循环写入的是**组合键** `${config.key}-${model.id}`（`setting.ts:578`）；
- `embedding.ts:37` / `audio.ts:98` 等解析函数**只支持裸 id 匹配**（`model.id === embeddingModel`），组合键值解析失败 → 返回 null → 静默失败；
- `resolveModelConfig`（`meeting-model-config.ts:16-25`）**支持组合键**，但先直接匹配裸 id——两个 provider 有相同模型 id 时**错配首个 config 的 baseURL/apiKey**。

**断链 C：静默失败路径多，无统一错误**
- 翻译 `translate.ts:21`：`translateModel || primaryModel`，空时静默；
- 摘要 `condense.ts:81`：`hasCondenseModel ? condenseModel : primaryModel`，主模型空则静默；
- embedding/audio 空配置时 `createOpenAIClient(undefined)`（`utils.ts:293`）读空 baseURL → 发到空地址才报错；
- 仅 meeting/report/title/rewrite 有显式 throw（有提示），其余静默。

### 2.3 回退项断链风险清单

| 配置项 | resolve 逻辑 | 风险 |
|---|---|---|
| reportModel | `resolveModelConfig(reportModel || undefined)`，空则 throw | 主模型空 → 显式报错（有提示） |
| 会议纪要/标题 | `resolveModelConfig(modelId)` | 主模型空 → throw（有提示） |
| RAG embedding | `embedding.ts:26` 只读 embeddingModel，**不回退主模型**，空→null→throw | **独立断链** |
| TTS/STT | `audio.ts:86/122` 空则 throw，仅匹配裸 id | 格式不兼容即失败 |
| OCR/VLM | `image-recognition.ts:61`，空则静默降级 OCR | 低风险 |
| 翻译/摘要/组织笔记 | 回退 primaryModel | 主模型空则静默或禁用 |

### 2.4 修复方向（供后续实施参考）

1. `primaryModel` 纳入 initSettingData 自动默认循环；create.tsx 首建配置后提供"设为默认主模型"
2. model-select 统一保存组合键 `${configKey}-${model.id}`；embedding/audio/stt 解析对齐 `resolveModelConfig` 的组合键前缀匹配
3. `resolveModelConfig`/`getAISettings` 增加 baseURL/apiKey 完整性校验 + "未配置主模型"统一错误，消除静默空请求
4. config-health-banner 改为校验 `resolveModelConfig(primaryModel)` 是否命中，而非仅非空串

---

## 三、批处理功能分析

### 3.1 现有批量能力盘点

| 模块 | 多选/批量 | 现状 |
|---|---|---|
| 文件/笔记 | ✅ 已有完整批量 | `file-selection.ts`（框选）+ `batch-selection-context-menu.tsx`（批量复制/剪切/删除） |
| 标注 mark | ✅ 已有完整批量 | `mark-toolbar.tsx` 多选模式 + 批量删除/转移标签 |
| 会议 | ❌ 无 | `meeting-list.tsx` 仅单条删除/归类 |
| 待办 | ❌ 无 | todo-panel 无批量 |
| 客户 | ❌ 无 | 仅单条删除（带级联统计） |
| 周报 | ❌ 无 | report-list 无批量 |

**无共用批量组件**——文件用框选、标注用多选模式、其余没有，三套并存。

### 3.2 批处理功能建议（按优先级）

| 优先级 | 功能 | 复用基础 | 技术可行性 |
|---|---|---|---|
| P0 | **会议列表多选**（checkbox，参照标注多选模式）→ 批量删除/批量转写/批量纪要/批量导出 | `transcribeAudio`（meeting-transcribe.ts:54 纯函数）、`generateMeetingSummary`（纯函数）、`deleteMeeting`（meeting-store.ts:378） | ✅ 状态机 per-meeting，天然支持多会议同时 transcribing；唯一单例限制是 meeting-panel 的 recorder/processingRef（组件级），批量需绕过 |
| P0 | **批量转写 + 批量纪要** | 套 `visit-generate-manager.ts` 队列骨架（模块级 FIFO，卸载不中断） | ✅ 但需裁剪其 chat loading 依赖；跨会议需新建全局并发池（现有"3 路并发"是段级限流） |
| P1 | **批量导出 Word** | `exportMarkdownToWord`（export-word.ts:145 纯函数） | ⚠️ `saveWordDocument` 每次弹系统保存对话框，一次一文件；需新增"先选目录再批量 writeFile"模式 |
| P1 | **批量归类客户** | `autoClassifyMeeting`（meeting-result.tsx:1223）、`ClassifyToCustomerDialog` | ✅ 需将 `identifyingCustomer` 布尔改计数 |
| P2 | **批量删除旧会议/无音频会议** | `deleteMeeting` 循环 | ✅ 简单低风险，需处理级联（客户导出文件/向量索引/失败回滚） |
| P2 | 文件模块补**批量导出/归档** | 已有选择基础 | 成本最低 |

### 3.3 实现难点

1. **跨会议并发限流**：需全局并发池（参考 `mapWithConcurrency` L272），替代段级 3 路
2. **批量导出对话框**：Tauri `save()` 一次一文件，需目录选择改造
3. **进度反馈**：多会议同时 `updateMeeting` 时 store 防抖保存已按 id 隔离（meeting-store.ts:221），风险低
4. **批量删除级联**：需逐项处理客户导出文件/向量索引/失败回滚

---

## 四、结论摘要

1. **设置失效项**：10 项死字段/孤儿页可删（placeholderModel/previewTheme/darkMode/language/三个 AutoSync/record/readAloud/defaultModel 目录/4 个孤儿组件）；1 处真 bug（toolbar-settings 移动端判断）；1 处 UI 入口丢失（markDescModel）；图床/同步/OCR/朗读/记忆均在用**不能误删**。
2. **模型断链**：根因是**主模型永不自动赋值 + 裸 id 与组合键格式不一致 + 静默失败路径多**三件事叠加，解释了"默认主模型的配置项用不了"。
3. **批处理**：文件/标注已有批量；会议/待办/客户/周报空白。最高价值是**会议批量转写/纪要/导出**，技术上完全可行（纯函数可并发 + 队列模板可复用），难点在并发池与导出对话框。

---

*本报告仅诊断，未修改代码。修复优先级建议：模型断链 A/B（影响所有回退项）> 设置失效清理 > 会议批处理。*
