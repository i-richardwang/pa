# PA 存储模型

PA 持久化分析定义、呈现视图、报告、看板、导出票据、业务术语和最小化使用记录。查询结果、
`RenderBundle`、CSV、构成记录和只读 parquet 不进入 SQLite。

## 身份边界

- Analysis 是不可变的数据问题，只保存指标、维度、筛选、时间和受控计算。
- View 是不可变的呈现选择，通过 `analysis_id` 引用 Analysis；图型与数据通道、作者视觉偏好分别保存。
- 一个 Analysis 可以有多个 View。创建 View 不复制 Analysis，也不保存查询结果。
- Report 是可变的业务身份，指向当前 `view_id`；ReportRevision 保存历史名称和历史 View。
- Board 只引用 Report。报告改名、恢复或替换 View 不改变看板引用。
- UsageLog 可以记录一次运行使用的 Analysis 与 View，但不是定义、结果或重放入口。

协议中的 `view_id` 指持久化 View；AnalysisDefinition 内结果节点的 `result_view_id` 是查询内部身份，
二者不得互换。领域值只在 Analysis 定义、View 意图和 View 偏好中各保存一次，其他对象只保存引用。

## 写入、重放与授权

新的数据问题必须先成功编译并执行，再原子创建 Analysis 和首个 View。修改查询定义会产生新的
Analysis；只修改呈现意图或视觉偏好会产生新的 View，不重新执行查询。MCP 重跑既有 Analysis 时按
当前数据执行并创建新 View，不修改原 Analysis。

保存 Report 只建立命名指针。改名、替换 View、归档和恢复都使用 revision CAS；修改前保存历史版本，
保留最近 20 版。Report 和 Board 的应用服务负责属主、引用与使用记录校验，传输层只映射协议。

View、Report 与 Board 每次重放都读取当前数据、按当前查看者重新授权并编译执行。展示、导出和记录
投影使用 `view_id` 定位完整定义；客户端提交的成员、过滤条件或格点坐标不能替代服务端重放与校验。

`RenderBundle` 只属于一次响应，没有持久身份。Report 可以保存最近一次 owner 重放得到的布局提示，
但它不属于 View、不参与 revision，也不承诺未来数据仍具有同一形态；切换 View 时必须失效。

## 生命周期

- View 依附于 Analysis；被当前或历史 Report 引用的 View 必须保护其 Analysis。
- Analysis 的保留期是 180 天，只清理过期且没有受保护 View 的记录。
- UsageLog 只保留最小化观察字段，90 天后清理，不保存原始工具入参或查询结果。
- ExportTicket 只保存查询计划、所有者和 15 分钟时效；读取时按当前权限重新执行。
- Report 归档不是删除，看板引用和版本历史继续有效。

数据库结构以 `app_database.ts` 的最终 DDL 为唯一事实源。空库建立当前结构；非空库结构印记不一致时
fail-closed，由部署环境重建，不在文档中维护第二份表结构。

## 业务术语

业务术语独立于模型目录持久化，保存规范叫法、自含定义、可选语境、其他叫法和公开语义成员 id。
规范叫法与别名统一归一后参与匹配和重复校验，但保留原文展示。成员关联只用于 Catalog 导航，不保存
物理字段、数据值、过滤器或查询配方；应用服务负责管理员授权与成员可见性校验。
