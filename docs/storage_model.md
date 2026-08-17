# PA 存储模型：不可变 Analysis 与可变 Report 指针

PA 自有持久层保存分析规格、报告身份、看板、导出票据、业务词典与观察记录。分析结果、CSV、
人员名单和只读 parquet 都不进入 SQLite。本文规定这套存储的值与身份划分、写入语义、读取路径
与引用完整性约束。

## 1. 值与身份

```text
analysis
  id + owner + spec + created_at
          ▲
          │ analysis_id
report
  id + owner + name + revision + archived_at + render_shape
          │
          └── report_revision
                report_id + revision + name + analysis_id

board.tiles ── report_id
usage_log  ── analysis_id
```

- Analysis 是不可变的规格值。`analysis_id` 永久标识同一份已验证的查询与呈现定义，不冻结执行结果；
  查看与重放始终读取当前数据，表没有 update 路径。
- Report 是可变的身份。它只增加名称、属主、revision、归档与当前 `analysis_id` 指针，不复制 spec。
- ReportRevision 保存历史名称与历史 `analysis_id`，不复制 spec；恢复版本就是把 Report 指针切回旧值。
- Board 只引用 `report_id`，因此 Report 改名、恢复或替换内容后，瓦片仍指向同一个业务身份。
- UsageLog 只记录本次执行使用的 `analysis_id`，执行事件不会成为第二份规格事实源。

全库只有 `analysis.spec` 一列物化语义规格：`report` 与 `report_revision` 都没有 spec 列。

## 2. 写入语义

- 新建分析在校验和执行后创建 Analysis；调整规格或呈现会创建新 Analysis，原值永不修改。
- 读取分析时按当前数据与权限返回 canonical spec 和执行结果。编辑始终是读回 spec、改写并创建新 Analysis。
- 人员记录投影引用已创建的 Analysis，分页时按当前数据与权限重新解析同一规格；人员行不持久化。
- 保存报告只校验 Analysis 属主并创建命名指针，不重新编译、不执行、不复制规格。
- Report 改名只更新名称；替换分析原子切换 `analysis_id`；归档只更新生命周期状态。
- Web 的查询记录、报告与有权查看的看板瓦片共用一个编辑器。编辑器先预览并创建新 Analysis，
  保存时再创建 Report 或用 CAS 切换既有 Report 指针；仅改名不创建 Analysis。
- Board Application Service 统一执行创建者校验、报告归属、重复加入、瓦片摘要装配和使用记录；
  HTTP 路由只校验请求结构并映射状态码，repository 只承担结构校验、引用完整性与 revision CAS。
- 每次 Report 修改先把旧名称与旧指针写入 ReportRevision，再递增 revision；最多保留最近 20 版。

保存、替换、恢复、Report 重放与 Board 重放都不复制规格，也不生成额外 Analysis。CAS 冲突直接
拒绝，不覆盖并发修改。

## 3. 读取与执行

- 直接按 `analysis_id` 访问时校验 Analysis owner。
- 按 Report 访问时先校验 Report owner；按 Board 访问时校验看板存在且包含该 Report 指针，
  再以当前查看者身份解析并执行。
- Report 与 Board 重放都复用当前 `analysis_id`，只按当前数据与当前访问者权限重新编译、执行和记日志，
  不铸造新 Analysis。
- 即席 Analysis、Report 与 Board 复用同一个 Record Projection Service。即席名单只接受无分组、
  单业务时间桶的聚合结果，分类条件必须已固化在 Analysis 筛选中；Report 与 Board 格点入口校验
  服务端签发的指标、维度和时间坐标。三者都沿指标自身的底层记录契约与 RecordSet 字段投影重新查询；
  Board 额外校验瓦片引用，并把同一次板级时间覆盖同时用于聚合结果与人员名单。
- Report 读取返回当前 `analysis_id`；展示与导出均使用该 Analysis 身份，导出不接受 Report 作为规格来源。

## 4. 呈现形态提示

`report.render_shape` 是最近一次 owner 重放得到的布局提示，用于看板预选尺寸。它不属于 Analysis
内容，也不承诺未来数据仍保持同一形态。Report 切换到不同 `analysis_id` 时清空；异步回写必须同时
匹配 `report.id` 与 `analysis_id`，旧执行不能污染新指针。它不参与 revision，也不需要 spec 指纹。

## 5. 生命周期与引用完整性

- `report.analysis_id` 与 `report_revision.analysis_id` 都以外键引用 Analysis，删除策略为 RESTRICT。
- Analysis 的 180 天保留期只清理超过期限且未被 Report 或 ReportRevision 引用的值。
- 查询记录里的 Analysis 在保留期内可进入同一编辑器；命名只增加稳定 Report 身份、看板引用与版本历史，
  不成为查看、重放、导出、记录投影或编辑的门槛。即席 Analysis、Report 与引用 Report 的 Board
  都可发起受控记录投影；名单不持久化，始终按当前查看者权限即时重算。
- 被当前 Report 或保留历史引用的旧 Analysis 继续可读；历史版本被裁剪后，失去引用的 Analysis
  才在后续惰性清理中删除。
- UsageLog 可以保留已经清理的 analysis_id 作为历史坐标，但不提供重放入口。
- Report 归档不等于删除，Board 引用与版本历史都继续有效。

## 6. 业务术语

业务术语与模型目录分开持久化。术语始终按完整对象读写，因此用一张表保存：

```text
business_term
  id + canonical_term + definition + context + aliases[] + related_member_ids[]
```

- `business_term` 保存规范叫法、自含定义、可选适用语境、其他叫法和相关公开语义成员 id；两个集合
  以受 JSON 数组约束的列保存，避免为只随术语整体读写的小集合建立独立生命周期。
- 规范叫法和其他叫法统一归一后参与匹配与重复校验，但保留原文展示。成员关联只用于 Catalog 导航，
  不保存物理字段、数据值、过滤器或查询配方；成员下线时管理端显示失效关联，公共端不投影它。
- 新建和修改提交后立即生效，删除即移除整条术语。
- Catalog 查询时现读全部术语，返回解释和可选成员导航，不把术语写入编译器目录。
