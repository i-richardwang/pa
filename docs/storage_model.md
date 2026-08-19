# PA 存储模型：Analysis、View 与 Report

PA 自有持久层保存分析定义、呈现视图、报告身份、看板、导出票据、业务词典与观察记录。
查询结果、`RenderBundle`、CSV、人员名单和只读 parquet 不进入 SQLite。

## 1. 值与身份

```text
analysis
  id + owner + definition + created_at
          │
          └── analysis_view
                id + analysis_id + intent + preferences + created_at
                            ▲
                            │ view_id
report ─────────────────────┘
  id + owner + name + revision + archived_at + render_shape
          │
          └── report_revision
                report_id + revision + name + view_id

board.tiles ── report_id
usage_log  ── analysis_id + view_id
```

- Analysis 是不可变的数据问题，`definition` 只包含指标、维度、筛选、时间和受控计算。
- View 是不可变的呈现选择，`intent` 保存图型与数据通道，`preferences` 保存人类作者视觉偏好。
- 一个 Analysis 可以拥有多个 View。创建 View 不复制 Analysis，也不保存查询结果。
- Report 是可变业务身份，只引用当前 `view_id`；ReportRevision 保存历史名称与历史 `view_id`。
- Board 只引用 `report_id`。Report 改名、恢复或替换 View 后，瓦片仍指向同一个 Report。
- UsageLog 同时记录本次 Run 使用的 `analysis_id` 与 `view_id`，但不是定义或结果的事实源。

协议中的 `view_id` 始终指 AnalysisView 的持久身份；AnalysisDefinition 内唯一结果节点及其绑定使用
`result_view_id`，两者不能互换。

全库只有 `analysis.definition`、`analysis_view.intent` 和 `analysis_view.preferences` 三处物化对应领域值。
Report、ReportRevision 与 UsageLog 都不复制这些 JSON。

## 2. 写入语义

- 新数据问题先通过编译与执行，再原子创建 Analysis 及首个 View；失败的 Run 不留下身份。
- 修改指标、维度、筛选、时间或计算会执行新的 Run，并创建新的 Analysis 与首个 View。
- Web 仅修改 ViewIntent 或 ViewPreferences 时，只编译并创建新的 View，不执行查询。
- MCP `rerun_analysis` 按当前数据重执行既有 Analysis，并创建新的 View；它不修改或复制 Analysis。
- 保存 Report 只校验 View 属主并创建命名指针，不重新编译、不执行、不复制领域值。
- Report 改名只更新名称；替换呈现原子切换 `view_id`；归档只更新生命周期状态。
- 每次 Report 修改先把更新前的名称与 `view_id` 写入 ReportRevision，再递增 revision；最多保留最近 20 版。
- Board Application Service 负责创建者校验、Report 归属、重复加入、瓦片摘要与使用记录；HTTP 路由只做协议映射，repository 只承担结构、引用完整性与 revision CAS。

CAS 冲突直接拒绝。保存、替换、恢复、Report 重放与 Board 重放都不复制 Analysis 或 View。

## 3. 读取与执行

- 直接访问 Analysis 或 View 时校验 Analysis owner。
- 按 Report 访问时先校验 Report owner；按 Board 访问时校验看板包含该 Report，再以当前查看者身份执行。
- View、Report 与 Board 重放都读取当前数据、重新鉴权、重新编译和执行，不持久化 Run 产物。
- 即席 View、Report 与 Board 共用 Record Projection Service。即席名单只接受无分组、单业务时间桶的聚合结果；Report 与 Board 格点入口校验服务端签发的指标、维度和时间坐标。
- 展示、受控记录投影与导出都使用 `view_id` 定位完整定义；`analysis_id` 只标识可被多个 View 复用的数据问题。

## 4. 瞬态 Run 与呈现提示

`RenderBundle` 只随一次 Web 响应存在，由完整聚合 `ViewBlock` 与公共渲染声明组成。它不拥有持久身份，
也不进入 Report、UsageLog 或 AnalysisView。

`report.render_shape` 是最近一次 owner 重放得到的布局提示，用于看板预选尺寸。它不属于 View，
也不承诺未来数据仍保持同一形态。Report 切换到不同 `view_id` 时清空；异步回写必须同时匹配
`report.id` 与 `view_id`。它不参与 revision。

## 5. 生命周期与引用完整性

- `analysis_view.analysis_id` 外键引用 Analysis，删除 Analysis 时级联删除其未受保护 View。
- `report.view_id` 与 `report_revision.view_id` 以 RESTRICT 引用 AnalysisView。
- Analysis 的 180 天保留期只清理超过期限且没有任何 View 被当前 Report 或保留历史引用的值。
- 被当前 Report 或 ReportRevision 引用的 View 会保护其 Analysis；历史版本被裁剪后，未被引用的 Analysis 才可在后续清理中删除。
- UsageLog 可以保留已经清理的身份作为历史坐标，但不提供重放入口。
- Report 归档不等于删除，Board 引用与版本历史继续有效。

`app_database.ts` 的最终 DDL 是应用库唯一结构基线；空库直接建立当前结构，非空库的结构印记不一致时
fail-closed，由部署环境重建数据库。

## 6. 业务术语

业务术语与模型目录分开持久化：

```text
business_term
  id + canonical_term + definition + context + aliases[] + related_member_ids[]
```

- 术语保存规范叫法、自含定义、可选适用语境、其他叫法和公开语义成员 id。
- 规范叫法和其他叫法统一归一后参与匹配与重复校验，但保留原文展示。
- 成员关联只用于 Catalog 导航，不保存物理字段、数据值、过滤器或查询配方。
- Catalog 查询时现读全部术语，不把术语写入编译器目录。
