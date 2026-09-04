---
name: pa-analytics
description: 查询 PA 组织与人才数据；用于人员规模、流动、编制、受控人员记录、报告和 CSV 导出，并遵守目录、时间、可比性与明细安全合同。
---

# PA 人才分析

Catalog、工具 schema 和查询结果是当前部署的事实源。使用它们提供的成员、参数形状、时间语义和错误信息；
不要根据示例、指标名称或过去的查询经验补充口径。

## 基本流程

1. 用一次 `catalog(terms=[...])` 提交问题中的全部业务概念。每项使用完整概念；查数时始终传 `terms`，
   避免加载无关的完整目录。
2. 阅读目录中的业务定义、成员说明和 `ai_context`：
   - `term_resolutions` 用于理解术语，`related_members` 只用于定位成员，不是过滤值。
   - 术语命中多个解释时，先用用户原话、成员含义和当前查询条件排除不成立的解释；仍有多个业务含义
     成立时再请用户确认。
   - `term_knowledge_status: unavailable` 表示本次没有术语知识，不能自行补充定义。
   - `unmatched_terms` 可用明确的业务同义词再检索；仍未命中时说明目录不支持，不拼算近似指标。
3. 只使用目录返回的语义 `id`。分组、筛选、排序和报告计算遵守所选指标共同支持的
   `query_capabilities`、`time.constraints` 与 `report_calculations`。过滤值不确定时用 `values_of` 核实，
   不从术语、标题或示例推断真实值。
4. 用 `run_analysis` 回答一个语义问题。同一分组、筛选和业务时间坐标下的多个指标放进同一个查询；
   行结构或业务问题不同才拆成多次调用。优先使用正式指标，不能拆查组件后复刻已有公式。
5. 根据结果的 `time`、`column_time_basis`、`totals`、`data_as_of`、`time_context`、
   `observation_scopes` 和 `display_notes` 解释结果。`query_notes` 只帮助正确查询，不向用户逐条复述。
6. 保留成功响应的 `analysis_id` 与 `view_id`。工具面提供 `show_analysis` 时，用 `view_id` 打开结果卡；
   用户要求解读时再补充结论。

## 判断原则

- 让用户决定指标、时间、人群、组织、比较和口径，不主动扩大问题范围。
- 只在存在尚未解决的业务选择时询问用户。参数错误或时间限制由服务端给出结构化原因；能按该原因直接
  修正时无需询问，修正会改变用户意图时再确认。
- `time.value_basis` 说明指标值覆盖哪个期间，`time.constraints` 说明哪些时间选择成立。两者都由指标
  合同提供，不按指标名称推断，也不请用户选择指标内部的求值方式。
- Catalog 可见成员已经过服务端权限裁剪，可以直接使用；不要因指标看起来敏感而自行拒答。
- 空结果先核对时间、过滤值、权限和成员说明。只有目录确实缺少所需指标、维度或口径时才使用
  `feedback`；提报不会改变当前查询。
- `feedback.ask` 保留业务问题即可，不写姓名、工号或其他逐人信息。

## 按需读取

- 涉及趋势、跨事实指标、结构占比、排行或显式派生时，读取
  [query_patterns.md](references/query_patterns.md)。
- 涉及结果卡、人员名单、报告修改或导出时，读取
  [delivery_workflows.md](references/delivery_workflows.md)。
