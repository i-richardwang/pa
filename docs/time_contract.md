# PA 时间合同

PA 把时间拆成两层：用户按正交的时间轴选择要观察的业务时间，指标只声明跨时间桶的最小聚合规则。
公开指标不声明求值形态；跨时间桶的行为由查询时间与结构化 `time_contract` 共同决定。

## 1. 查询时间是用户协议

分析规格中的时间结构如下：

```json
{
  "window": { "kind": "year_to_date" },
  "display": "month",
  "comparison": { "kind": "previous_year" }
}
```

- `window` 是唯一主选择：最新月份、今年至今、近 N 月/年或明确月份范围；
- **窗口的冻结性是表达式自身的性质**：相对表达式（最新月份、今年至今、近 N 月/年）恒以数据源
  `actual_through` 为终点随数据滚动，绝对表达式（`current_month.month` 的固定单月、`range`
  的明确起止月）天然冻结。任何窗口都不接受额外的截止字段；
- `display` 是可选的**序列粒度**：`month` 或 `year`。省略时由窗口和指标约束稳定推导；
- `comparison` 是可选的单一对照意图：`previous_period` 表示上一等长期间（单月即上月），
  `previous_year` 表示去年同月或去年同期，`custom.window` 表示一个明确的自定义对照窗口。
  今年至今不使用跨年的上一等长期间；它的常规对照是去年同期。

**整段时间的读数由结果自带的合计位承担**：`view.totals` 给出各指标在各时间坐标上的单值，
`display` 只声明序列粒度。

省略 `display` 时的默认按「时间该不该占轴」来定：

| 结果形态 | 默认 | 为什么 |
|---|---|---|
| 有业务分组 | 整段单桶 | 问题本身是各分组在这段时间里各是多少，时间不占轴 |
| 无分组 × 单月窗口 | 整段单桶 | 一个月本来就只有一个数 |
| 无分组 × 连续期间／今年至今／近 N 月 | 按月 | 给走势；整段读数已由合计位承担 |
| 无分组 × 近 N 年（N>1） | 按年 | 单个年桶不成序列 |
| 任何形态 × 带对照 | 按年或按月 | 结果必须保留可区分主期与对照期的时间键 |

要在分组之上再看时间，显式声明按月或按年即可。两条指标能力还会隐式收窄默认：只按月定义的指标
在跨月窗口自动按月（显式要求按年则 fail-closed）；年初归零的指标在跨日历年窗口没有单一合计，
自动降为按年。「今年至今对去年全年」不是等长比较，不设快捷对比；只有用户明确要求时才用
`custom.window` 表达，并把结果陈述为基准差异，不称为同比。

两种绝对（冻结）表达式分别写成：

```json
{ "window": { "kind": "current_month", "month": "2026-06" } }
```

```json
{ "window": { "kind": "range", "from": "2025-08", "to": "2026-07" } }
```

冻结「年初至某月」即写成起点为该年一月的 `range`；它与滚动的 `year_to_date` 在同一锚点上同解，
差别只在数据推进后是否跟着走。

Analysis Planner 在执行规划时只解析一次公开时间协议，产出唯一的业务时间坐标。相对窗口、对照、可用数据范围、
结果粒度和业务桶都在这一步定稿。业务桶使用月份闭区间，终点恒为 `to`；下游不得再次解释用户时间。
持久化 Analysis、Web 书签与 MCP 请求共用同一份 TimeIntent schema，不接受其他时间形态。

默认粒度读取用户声明的基础分组集，不读取某条物理查询腿的 `dimensions`。一个语义查询视图展开出的
基础结果、构成占比分母、总体和 Top-N 排名腿共享同一份 `BusinessTimeResolution`；腿级 Planner 只能
消费这份既成签名。时间成员由签名的 `outputGrain` 唯一派生，不作为第二份字段写入契约。执行时再次
断言各 grouping set 的时间签名精确相等，任何漂移都拒绝整件结果。交付边界同样从执行后签名派生
时间成员及其公共列身份；投影层不按 `year` / `month` 名称或列角色自行放行。

YTD 不是另一种公开指标类型。YTD 是年初到锚点的业务窗口，去年同期由 `previous_year`
将主窗口整体回移一个日历年表达。当前数据与查询时间均为月粒度，因此同期精确到月。

## 2. `time_contract` 是模型内部合同

每个公开指标和运行时依赖的内部指标都必须在模型元数据中声明：

```yaml
meta:
  time_contract:
    aggregation: sum | average | last | recompute
    window: selected | year_to_date
    grain: month # 可选
```

字段含义如下：

| 字段 | 含义 |
|---|---|
| `aggregation: sum` | 在目标窗口内求和，例如离职人数。 |
| `aggregation: average` | 在目标窗口内求平均，例如窗口月均记录数。 |
| `aggregation: last` | 取目标桶终点结果，例如月末在职人数、月度计划编制及其达成率。 |
| `aggregation: recompute` | 先按自身组件与公式聚合，再重算比例，不平均各月比例。 |
| `window: selected` | 使用用户选择的业务桶。 |
| `window: year_to_date` | 在每个目标桶终点读取当年年初至该终点的累计或成员资格结果。 |
| `grain: month` | 指标只在单月桶上有定义，连续多月必须按月返回。 |

`window: year_to_date` 与 `grain: month` 不能并存（合同入口 fail-closed）：年初累计的值
天然覆盖年初至终点，「只按月定义」会让整窗合并的降级期间自相矛盾。

典型映射：

| 指标 | 合同 | 结果 |
|---|---|---|
| 月末在职人数 | `last + selected` | 单月取该月月末；年度或期间总计取桶末月。 |
| 离职人数 | `sum + selected` | 对所选月份求和。 |
| 编制达成率 | `last + selected` | 在桶末月分别聚合快照与编制事实，再重算比例；时间上不聚合月度率。 |
| 月度离职率 | `recompute + selected + month` | 每个月用离职人数和按在职天数折算的平均人员规模重算，禁止把多个月合成一个率。 |

`time_contract` 是计算引擎的内部元数据，不进入 Agent Catalog、MCP schema 或查询结果。用户只需理解
指标业务口径和可用的时间选择，不需要选择求值形态。

目录公开的是它的一层投影——**时间能力卡** `time_constraints`，只写会约束用户选择的时间性格：

| 能力位 | 由合同推导 | 它决定什么 |
|---|---|---|
| `multi_month_display: "month"` | `grain: month` | 跨月窗口显式要求按年即拒绝，省略显示方式则隐式按月；合计位退到终点当月。 |
| `year_scoped: true` | `window: year_to_date` | 业务桶跨日历年时没有单一合计；合计位退到终点所在年的年初至终点。 |

两位各自既约束显示方式，也决定合计位怎么求值——不能整窗合并的指标不留空，而是退到期间终点
求值并写实其真实覆盖期间（`totalPeriodOf`）。能力卡与守卫读同一份合同字段，故编辑器的事前禁用
与服务端的事后拒绝恒一致；卡永不手写，新增守卫判据时必须同步推导规则，一致性由跨层用例逐组合
双向断言把守。求值形态本身（interval / endpoint / year_to_date）仍是引擎私有，不出现在任何消费面。

### 包驱动的时间来源与比较策略

时间来源由 `semantic_package.yml.time_sources` 登记，核心不内置任何业务时钟：

```yaml
time_sources:
  - id: actuals
    title: 实际数据
    role: actual
    primary: true
    comparison_policy: calendar
  - id: plan
    title: 实际与计划数据
    role: plan
    primary: false
    reference_source: actuals
    comparison_policy: calendar
  - id: observations
    title: 非定期观测数据
    role: actual
    primary: false
    comparison_policy: explicit_only
```

注册表只表达通用关系：唯一主时钟、实际或计划角色、计划引用的实际基准，以及比较策略。
`calendar` 允许上一期间和去年同期；`explicit_only` 只允许明确的自定义对照窗口，避免非定期
数据时点被日历平移后静默匹配错误记录。编译器以比较策略统一处理各类业务时间源。

若稀疏事件需要月度查询，语义包的数据构建层可将其密化为月度状态快照：每个月份承载不晚于
桶末的最近一批记录，并用 `last + selected` 读取。批次身份应作为普通业务维度披露，密化规则由
语义包的数据建模层负责。

### 聚合后结果保护（`result_guards`）

需要避免低支撑量结果误导时，指标显式声明保护规则：

```yaml
result_guards:
  - kind: minimum_support
    support_measure: respondent_count
    threshold: 5
```

Planner 自动把 `support_measure` 展开进正式指标图；Calculator 在各事实聚合并对齐后判断支撑量，
低于阈值或支撑量未知的结果格置空，并在结果注记中披露被保护的格数。支撑指标必须显式指定，
核心不会从公式分母、指标名称或业务类型推断它；因此同一能力也可用于门店数、设备数、交易数等
非 HR 数据。

## 3. Planner 编译正式指标图，Cube 负责事实内聚合

Planner 从 `time_contract` 推导内部执行形态：

- `sum / average + selected` 使用整个业务桶区间；
- `last + selected` 使用业务桶终点；
- `year_to_date` 在业务桶终点读取 Cube 中的年初累计指标；
- `recompute + month` 在每个单月桶内计算；
- `recompute` 递归继承分子、分母的时间合同，各组件可以来自不同事实和不同求值形态。

Planner 先把正式指标 DAG 展开到叶子指标，再按“事实来源 × `interval / endpoint` 求值形态”稳定
分组；同一组只生成一条 Cube 查询腿（腿：按事实与求值形态拆出的单条 Cube 查询，定义见
`docs/metric_architecture.md`）。Cube 在单张宽事实内完成筛选、权限和聚合。Executor 对各腿结果
使用规范维度与业务时间构成的完整键执行 full outer 对齐，拒绝任何腿内重复键，再按指标图逐行重算。
缺失分子、缺失分母和零分母分别由指标节点显式声明，不做隐式广播或比例平均。

同一机制同时覆盖单事实的异形态指标组合和跨事实率，不需要 shared dimension、Cube Multi-fact 或
实时事实表 join。Top-N 在正式指标计算完成后排名，因此不会拿任一叶子指标替代复合率；选中分组会转成
规范维度过滤，供“所选分组总体”重新聚合使用。

## 4. 对外结果只有业务时间轴

直查结果只公开 `view.time`：

- `grain`：结果粒度；
- `coordinates`：服务端最终解析的有序主期间与对比期间，第一项是 `primary`，其余为 `comparison`；
- `buckets`：带行键的业务桶列表。

指标求值形态、物理窗口、拆腿方式与执行腿数量都不属于 Agent / Web 协议。派生比较结果没有单一业务
时间轴时，由 provenance 与 display notes 逐列说明来源期间，不伪造合并时间轴。

`column_roles` 对全部结果列必填，呈现层不从列名或数据值猜测列角色。Web 记录投影只按
`view.time.buckets` 定位业务范围；桶缺失或行到桶不唯一时 fail-closed。

呈现层按 `coordinates` 把结果桶切回期间，据此叠加对照系列并派生差值列——这是对服务端**已解析**
坐标的消费，不是重新解释用户时间：桶到期间的归属只做区间包含判定，不唯一即退回单一时间轴形态。
差值由服务端算出后随呈现下发；率作差得百分点，量作差得相对变化率，分母为零时无定义。
消费方（含 MCP 壳）仍不得自行对指标做算术。

## 5. 红线

- 时间编译与公共逻辑时间载荷分别由独立黄金夹具守护；有意变更任一契约时，先审查差异，再更新对应夹具。
- 物理发射是否合腿只由结构化等价性决定，不由指标名单或经验规则决定。
- 不从物理窗口反推业务时间；需要业务范围时只读 `businessTime` 或 `view.time`。
- MCP 壳不得重新定义指标，也不得对未声明的指标做算术。
- 新增时间粒度或桶种类时，须同步验证枚举、行键、结果时间列、标签、图表轴、发射方式与记录投影唯一性。
- 物理绑定变化时须核对标题、导出、记录投影与跨腿共列仍指向同一业务含义；数值相等不代表身份相同。
