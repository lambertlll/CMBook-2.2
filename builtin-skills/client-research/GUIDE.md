# client-research 操作指南（Agent 执行用）

> 本文件是 client-research skill 的执行入口说明。完整正式指令见 SKILL.md；
> 如需完整版可用 `skill_load`（file_type 传 `SKILL.md`）加载。

## 输入

调用方会给出：客户名称、客户类型（企业/个人/混合）、所属行业（可空）、客户文件夹路径、**确切输出路径**。
若缺少输出路径，先向用户确认，不要自行编造。

## 执行流程（严格按顺序）

1. **确认客户与输出路径**：客户名、类型、输出路径三者齐全才开始。
2. **本地知识库优先**：用 `search_markdown_files`（mode=`rag`，folderPath=客户文件夹路径）检索该客户的历史拜访纪要、既往报告与资料；必要时用 `list_markdown_files` / `read_markdown_file` 精读。整理「内部已知信息」（既往拜访、需求、承诺、待办、授信线索）。
3. **联网补充**：先用 `skill_load`（file_type=`references/sources.json`）获取数据源与搜索关键词策略，再按策略用 `web_search` 搜索、`web_fetch` 精读重点页面。重点为近 3 个月信息，重大事项可追溯 6 个月。web_search 提示未配置时，跳过联网部分并说明。
4. **按模板成稿**：用 `skill_load` 加载对应模板（企业：`references/enterprise-report.md`；个人：`references/individual-report.md`；混合：`references/combined-report.md`），按模板结构生成报告。
5. **信息标注（硬性要求）**：本地知识库内容逐条标注 `【内部信息】` 并注明出处文件名；联网内容逐条标注 `【公开信息】` 并注明来源与日期。查不到写「未查询到公开信息」，禁止编造。
6. **写入并汇报**：用 `create_file`（已存在用 `update_markdown_file` 覆盖）把报告写入调用方给的**确切输出路径**，然后在回复中汇报 5-10 条关键发现摘要并注明报告路径。

## 合规

仅使用公开渠道信息与本应用本地知识库；报告仅供内部参考；风险信息如实呈现并提示需核实，不下定性结论。
