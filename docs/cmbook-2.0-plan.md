# CMBook 2.0 升级规划：银行客户经理拜访全流程产品

> 状态：**已确认（2026-07-23，6 项决策已拍板，见第六节）**，进入执行阶段
> 基于 1.0（v0.31.1）代码库与实际接入资产代码分析编写。

---

## 一、现状盘点（代码分析结论）

### 1.1 1.0 已有资产与 2.0 复用方式

| 1.0 资产 | 位置 | 2.0 复用方式 |
|---|---|---|
| 会议模块全流程（录音→转写→纪要） | `src/app/core/main/meeting/` | 直接作为"访中"核心，仅需关联客户/拜访 |
| 纪要生成管线（模板 prompt + map-reduce + 覆盖度自检 + 局部改写） | `meeting-generate-summary.ts` | 报告类功能的生成引擎，访前/访后报告可复用同一管线思路 |
| 自定义纪要模板机制 | `meeting-templates.ts` + `customMeetingTemplates` | 新增内置"客户拜访纪要"模板 |
| Skills 子系统（Agent Skills 标准，SKILL.md + zip 导入 + Agent 工具调用） | `src/lib/skills/`、`src-tauri/src/skills.rs` | 三个银行 skill 按此标准改造后**内置**进 2.0 |
| Agent 工具系统（8 组工具，含 RAG 检索工具） | `src/lib/agent/`、`note-tools.ts` | skill 执行载体；需新增联网工具组 |
| 向量知识库（markdown 切块 + embedding + BM25 混合检索 + 按文件夹范围检索） | `src/lib/rag.ts`、`src/db/vector.ts` | 直接作为"访后知识库"底座；`getContextForQueryInFolder` 已支持按客户文件夹限定范围 |
| 多模型槽位配置（聊天/embedding/纪要模型） | `store.json` + `src/stores/setting.ts` | 报告生成模型沿用槽位制 |
| 多会议列表 + 后台并行处理 | `meeting-store.ts` | 拜访时间线的数据源 |
| SQLite 增量列迁移模式（`ensureColumn`） | `src/db/meetings.ts` | 2.0 新表/新列沿用，另加 `schema_meta` 版本表 |

**关键空白（2.0 必须新建）**：
1. **无联网工具** —— Agent 现有工具组（chat/editor/folder/mark/memory/note/system/tag）里没有 web_search / web_fetch，而三个银行 skill 的核心数据源就是联网搜索。
2. **无客户/拜访概念** —— 全库无 customer/visit 相关表与页面。
3. **会议数据不进知识库** —— 纪要只存 `meetings.summary`（DB），不落工作区文件，不参与向量索引。
4. **会议/客户数据不同步** —— 同步域仅 records + settings + 文件。
5. **无内置 skill 机制** —— 目前 skill 全靠用户手动导入 zip 或在工作区创建。

### 1.2 三个 skill 分析（client-research-skill 仓库 master 分支）

| skill | 功能 | 依赖工具 | 输出 | 融入改造点 |
|---|---|---|---|---|
| **client-research**（客户尽调助手） | 企业/个人/混合尽调，生成访前材料（基本信息、最新动态、风险提示、访前建议 8 段式） | web_search、web_fetch、browser | markdown 报告（3 个模板 + sources.json 数据源/关键词配置） | ① SKILL.md 正文几乎为空，需把 README 中的流程重写为正式 skill 指令；② 输出落客户文件夹；③ 增加"先查本地知识库"步骤 |
| **financial-report-analyzer**（财报分析助手） | 信贷视角财报分析，简化版（搜索）/详细版（年报 PDF 原文）双模式 | web_search、web_fetch、pdf 解析、pandoc | 默认 docx（pandoc 转换） | ① 双模式保留；② 融合本地知识库（历史纪要中的经营信息）；③ docx 导出依赖 pandoc，需做检测与降级 |
| **credit-committee-assistant**（审贷会助手） | 审贷会准备：最新变化分析 + 提问预测（含建议回答）+ 财务/行业分析 | web_search、web_fetch | markdown / docx（562 行完整模板） | ① 模板质量最高，改动最小；② 增加知识库融合（本行授信历史、拜访记录） |

三个 skill 的共同特征：**纯公开信息、搜索驱动、模板化输出**，与 CMBook 的 Agent Skills 子系统天然兼容（同为 agentskills.io 标准）。

### 1.3 小程序分析（bank-assistant-miniapp）

- 本质：**薄客户端** —— 3 个功能（客户尽调/财报分析/审贷会）全部通过 POST 到远端后端（`bankassistant.cn`）创建任务，5 秒轮询拿结果，报告在结果页用简易 markdown 渲染，历史记录存微信本地存储。
- **后端代码不在仓库内**，依赖一台外部服务器和邀请码/配额体系。
- 融入判断：小程序的三个功能与三个 skill **完全一一对应**（就是同一套能力的外卖版）。对行内场景，CMBook 本地运行（自有 API key、数据不出终端）在合规上优于外部服务器中转。
- 可借鉴的 UX：任务分步进度提示（"正在搜索信息…正在生成报告…"）、历史任务列表、报告分享。

---

## 二、2.0 产品框架

### 2.1 核心概念模型

```
客户（Customer）
 └─ 拜访（Visit，一次完整的拜访生命周期）
     ├─ 访前：尽调报告 / 访前材料        → 客户文件夹 .md
     ├─ 访中：会议（录音→转写→拜访纪要）  → meetings 表 + 导出 .md
     └─ 访后：财报分析报告 / 审贷会材料   → 客户文件夹 .md / .docx
客户文件夹（工作区 customers/<客户名>/） = 该客户的知识库（自动向量索引）
```

- **客户**是顶级实体；**拜访**串联访前/访中/访后三个阶段产物。
- **一切产物皆工作区 markdown 文件** → 自动进入向量知识库 → 被后续所有报告检索复用。这是 2.0 的灵魂设计：拜访越多，知识库越厚，报告越准。

### 2.2 数据模型（SQLite 新增）

```sql
-- 客户表
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'enterprise',     -- enterprise | individual
  industry TEXT,                      -- 行业
  profile TEXT,                       -- 备注画像
  folderPath TEXT,                    -- 工作区内客户文件夹相对路径
  isPinned INTEGER DEFAULT 0,
  createdAt INTEGER, updatedAt INTEGER
);

-- 拜访表（生命周期枢纽）
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  title TEXT,                         -- 如"2026-07-30 首次拜访"
  visitDate INTEGER,
  stage TEXT DEFAULT 'preparing',     -- preparing | visited | followed
  previsitDocPath TEXT,               -- 访前材料路径
  meetingId TEXT,                     -- 关联会议（访中）
  postDocs TEXT,                      -- 访后产物路径 JSON 数组
  notes TEXT,
  createdAt INTEGER, updatedAt INTEGER
);
CREATE INDEX idx_visits_customer ON visits(customerId);

-- meetings 表 ensureColumn 增量：customerId TEXT、visitId TEXT
-- schema_meta 版本表（2.0 起引入，替代纯 ensureColumn 裸迁移）
```

### 2.3 客户文件夹约定（工作区内）

```
customers/
└── <客户名>/
    ├── 客户档案.md            # 基本信息卡（首次建客户时生成，可被 skill 更新）
    ├── 访前/
    │   └── 2026-07-30-尽调报告.md
    ├── 访中/
    │   └── 2026-07-30-拜访纪要.md     # 会议纪要自动导出
    ├── 访后/
    │   ├── 2026-08-财报分析.md (.docx)
    │   └── 2026-08-审贷会准备.md
    └── 资料/                  # 用户上传的知识文件（md/txt/docx/pdf→md）
```

整个 `customers/<客户名>/` 即该客户知识库的检索范围（复用 `getContextForQueryInFolder`）。

### 2.4 界面结构

- 左侧导航新增第四个 Tab：**「客户」**（图标 Users），含客户列表（搜索/置顶/新建）。
- 中栏：客户详情页 = 客户档案卡 + 拜访时间线（每次拜访展开访前/访中/访后产物）+ 知识库面板（材料列表、上传、重建索引）。
- 拜访操作流：`新建拜访 → [生成访前材料] → [开始拜访会议]（跳会议模块，自动关联） → [生成财报分析/审贷会材料]`。
- 会议模块改动极小：新建会议时可挂到客户/拜访；纪要完成后自动导出。
- 报告生成采用小程序式任务进度流（分步提示 + 历史任务列表），后台并行。

---

## 三、融入方案

### 3.1 三个 skill → 内置 skill

1. **内置 skill 机制**（新建）：仓库新增 `builtin-skills/` 目录存放三个改造后的 skill；打包为 Tauri resource；首次启动复制到 AppData `skills/` 并注册（新 Rust 命令，注意必须同时注册 `main.rs` 与 `lib.rs`）。设置页 skill 列表标记"内置"，可禁用不可删除。
2. **skill 改造通用项**：
   - 输出路径约定：写到 `customers/<客户名>/访前|访后/`，文件名带日期；
   - 指令开头增加「本地知识库检索」步骤：先按客户文件夹范围检索历史纪要/报告/资料，再做联网搜索，报告中标注哪些是内部信息、哪些是公开信息；
   - 数据来源沿用各 skill 的 sources.json（并入 skill 目录作 references）；
   - client-research 的 SKILL.md 需重写正文（现仅 8 行，实际流程在 README）。
3. **联网工具组**（新建 `src/lib/agent/tools/web-tools.ts`）：
   - `web_search`：可配置 provider（Tavily / 博查 / Bing / SerpAPI），API key 走 `credential-crypto.ts` 加密存储（合规红线：禁止明文）；
   - `web_fetch`：Rust 命令抓取 URL → 正文提取（reqwest + 可读性提取），注册双入口；
   - 设置页 AI 区新增"联网搜索"配置块。
4. **docx 导出**：检测报告完成后提供"导出 Word"——检测 pandoc（`bash -c` 已有权限）；无 pandoc 时降级为内置 md→docx 转换或仅导出 md，并提示。

### 3.2 小程序融入（**已定：本期不动**）

- **决策（2026-07-23）：本期不处理小程序。** 其定位确认为"未来移动端阶段调用 skill 的便捷入口"——届时小程序作为薄客户端对接 2.0 的 skill 能力即可，仓库代码保留在 `_reference/bank-assistant-miniapp/` 备用。
- 小程序的 UX（分步进度提示、历史任务列表、报告分享）仍按原计划移植进 CMBook 报告生成流程。

### 3.3 知识库融合机制

| 时机 | 动作 |
|---|---|
| 会议纪要完成 | 自动导出到 `customers/<名>/访中/` → 调 `processMarkdownFile` 向量化 |
| 访前/访后报告完成 | 同上（落文件即索引） |
| 用户上传资料 | 复制进 `资料/`（docx/pdf 先转 md）→ 向量化 |
| skill 生成报告时 | 第一步：`getContextForQueryInFolder(客户文件夹)` 检索内部信息 → 第二步：web_search 外部信息 → 融合成稿，内外信息分别标注 |

---

## 四、分阶段工作计划

> 每阶段验收底线：`npx tsc --noEmit`、`pnpm lint`、`cargo check` 全绿；文案 5 语言同步。

| 阶段 | 内容 | 关键产出 | 预估 |
|---|---|---|---|
| **P0 地基** | `schema_meta` + customers/visits 建表 + meetings 增量列；客户文件夹 helpers；「客户」导航空壳 + i18n 骨架；内置"客户拜访纪要"模板 | 数据层 + 空模块可编译 | 3–4 天 |
| **P1 访中打通** | 会议关联客户/拜访；拜访纪要模板 prompt（客户需求/承诺/待办/授信线索）；纪要自动导出客户文件夹并自动向量化；客户详情页 + 拜访时间线 | 访中闭环可用 | 3–4 天 |
| **P2 联网工具** | web_search（provider 配置 + 加密 key）+ web_fetch（Rust）+ Agent 工具注册/权限 + 设置页 | Agent 能联网 | 3–5 天 |
| **P3 访前** | 内置 skill 打包/首启导入机制；client-research 改造（重写 SKILL.md、落客户文件夹、先查知识库）；新建客户/拜访 UI + 访前材料生成任务流（进度提示） | 访前闭环可用 | 4–5 天 |
| **P4 访后知识库** | 客户知识库面板（列表/上传/重建索引）；docx/pdf→md 转换；会议纪要与报告自动索引补全；按客户 scoped 检索验证 | 知识库可用 | 4–5 天 |
| **P5 访后报告** | financial-report-analyzer、credit-committee-assistant 改造（知识库融合步骤 + 输出约定）；报告任务流 + 历史；docx 导出（pandoc 检测/降级） | 访后闭环可用 | 4–5 天 |
| **P6 收尾** | 移动端适配评估（含小程序复用）；全量测试与文档 | 2.0 发布候选 | 3–5 天 |

合计约 **24–33 人日**。P0→P1→P2 必须串行，P3 与 P4 可并行，P5 依赖 P2+P4。

---

## 五、风险与注意点

1. **联网搜索质量**是三个 skill 的命门：免费/无 key 的搜索源不稳定，需要行内认可的搜索 API（决策点 2）。
2. **合规**：所有对外请求（搜索/AI）直连，CSP 已放开；客户敏感数据全部本地，报告含"仅供内部参考"水印式声明（沿用 skill 原合规要求）。
3. **双入口陷阱**：新增 Rust 命令（web_fetch、内置 skill 复制）必须注册 `main.rs`。
4. **向量库性能**：JS 侧全量余弦计算，客户文件夹文件增多后需观察；必要时 P6 引入分批/裁剪。
5. **移动端**：本期默认桌面端优先（决策点 5）。

---

## 六、决策记录（2026-07-23 已全部确认）

| # | 事项 | 决策 |
|---|---|---|
| 1 | 小程序处理 | **本期不动**。未来移动端阶段复用，定位为"移动端调用 skill 的便捷入口" |
| 2 | 联网搜索 provider | **默认实现 Tavily + 博查**，key 用户自配、加密存储；预留 provider 抽象，后续替换为行内统一搜索网关（见待办 B1） |
| 3 | 客户数据模型 | **从简**：名称/类型/行业/备注，不做完整 CRM |
| 4 | 平台范围 | **本期只做桌面端**，移动端放 P6 评估 |
| 5 | 上传资料解析 | **md/txt 直接索引，docx/pdf 转 md 纳入 P4** |
| 6 | 多端同步 | **本期不做**（涉隐私信息安全），会议/客户数据保持纯本地 |

## 七、待办事项（Backlog）

| # | 事项 | 触发时机 | 关联 |
|---|---|---|---|
| B1 | **对接行内统一搜索网关**：P2 的 web_search 工具按 provider 抽象层实现，届时新增"行内网关" provider 替换 Tavily/博查 | 行内网关可用时 | P2 |
| B2 | 移动端适配（含小程序复用为移动端 skill 入口） | P6 评估 | P6 |
| B3 | 会议/客户数据多端同步（需先解决隐私安全方案） | 安全方案明确后 | 原 P6 可选项 |

---

## 八、实施记录（P0–P6 全部完成，2026-07-23）

### 各阶段交付摘要

| 阶段 | 关键交付 | 验证 |
|---|---|---|
| P0 地基 | `src/db/customers.ts`/`visits.ts`/`schema-meta.ts`（2.0 基线 v1）；meetings 表 +customerId/visitId；`src/lib/customer-folders.ts`（customers/<名>/{访前,访中,访后,资料}）；「客户」导航 Tab + 模块骨架；内置「客户拜访纪要」模板 | tsc/lint ✓ |
| P1 访中 | `visit-timeline.tsx`（拜访卡片三阶段区块）；`meeting-customer-export.ts`（纪要完成→导出 `访中/YYYY-MM-DD-标题.md`→向量化→visit.stage=visited）；会议列表客户徽章；「同步到知识库」按钮 | tsc/lint ✓ |
| P2 联网 | `src/lib/web/`（search/fetch/config/types，Tavily+博查 provider 抽象、baseURL 可覆盖为行内网关预留）；Agent 工具 web_search/web_fetch（risk=read 免确认）；设置页"联网搜索"独立 anchor；key 走 credential-crypto 加密（含明文迁移）。新依赖 @mozilla/readability、linkedom | tsc/lint ✓ |
| P3 访前 | `builtin-skills/client-research/`（重写 SKILL.md + GUIDE.md + references）；Rust `install_builtin_skills`（dev 回退 CARGO_MANIFEST_DIR、prod 探 resource_dir/_up_，幂等比对、.builtin 标记，双注册 main.rs/lib.rs）；设置页内置徽章+隐藏删除；`previsit-section.tsx` 生成闭环（emitter send-chat-message → Agent 执行 → 轮询回写 previsitDocPath） | tsc/lint/cargo ✓ |
| P4 访后知识库 | `customer-knowledge.tsx` + `src/lib/customer-knowledge.ts`（分组文件列表/索引状态/上传 md/txt/docx(mammoth)/pdf(复用 src/lib/pdf.ts)/全部重建/基于知识库提问——复用 chat 链接文件夹机制，检索确实走 getContextForQueryInFolder）；**修复 rag.ts 既有 bug**：文件夹范围检索的文件名匹配由 basename 改为相对路径+basename 双匹配 | tsc/lint ✓ |
| P5 访后报告 | `builtin-skills/financial-report-analyzer/`、`builtin-skills/credit-committee-assistant/`（SKILL.md+GUIDE.md+references，均含"本地知识库融合"硬步骤与内外信息标注；审贷会模板新增"〇、本行掌握情况"与"2.5 拜访细节类提问"）；`postvisit-section.tsx`（双按钮并行生成、postDocs 合并回写、stage→followed）；Word 导出（bash -c pandoc，检测失败明确提示） | tsc/lint ✓ |
| P6 收尾 | 清理 5 个无引用 i18n 死键；全量验证；移动端评估（见下） | 见下 |

### P6 全量验证结果

- `pnpm exec tsc --noEmit` ✓；`pnpm lint` ✓（仅 1 条 1.0 遗留 img alt warning）
- `cargo check` ✓；`cargo test --lib` 29/29 通过 ✓
- `pnpm build`（next build --turbopack 静态导出）✓

### 移动端评估（Backlog B2 依据）

- 现状：`src/app/mobile/`（51 个 tsx）仅有 chat / record / writing / setting 四块，**连 1.0 的会议模块都未覆盖**，更无客户/拜访/知识库。
- 结论：移动端 App 补齐"会议+客户全流程"成本高（录音/实时转写/编辑器均需重适配）。**维持决策 1：小程序作为移动端调用 skill 的轻量入口**（三个 skill 已内置桌面端，未来小程序后端只需代理到行内 AI 网关 + 同名 skill 逻辑即可复用）；移动端 App 是否补会议模块待小程序跑通后再评估。

### 已知遗留（不阻塞发布，按需跟进）

1. 真实 Tavily/博查 key 未实测（provider 按官方文档实现并做防御性归一化，拿到 key 后各跑一次冒烟）
2. web_fetch 按 UTF-8 解码，GBK 老页面可能乱码；PDF 抓取不支持（skill 内已做降级说明）
3. `.txt` 文件的向量块在文件夹范围检索时不生效（rag.ts 收集逻辑只收 .md，影响面大，暂未改）
4. 端到端链路（装 key→生成尽调/纪要/财报→导出 Word）未经真机运行验证，首次发布前需人工跑一遍
5. 删除拜访后关联会议的 visitId 悬空（仅显示层影响，会议本身不受影响）

## 附：参考代码位置

- 三个 skill 源码已克隆至 `_reference/client-research-skill/`（master 分支）
- 小程序源码已克隆至 `_reference/bank-assistant-miniapp/`
- 1.0 关键复用点见本文 1.1 表格
