# 结果交付流程

## 结果卡与继续编辑

- `show_analysis` 只打开已有 `view_id`，不重新查询。成功打开后，回复确认已打开，并仅补充必要口径、
  限制或异常；用户要求解读时再给结论。
- 只改变图型时，用 `rerun_analysis(analysis_id, view)` 产生新的不可变 View，并继续使用新的 `view_id`。
- 修改指标、维度、筛选或时间时，先用 `load_analysis_result(view_id)` 取得 canonical `analysis` 和
  `view_intent`，只改用户要求的部分，再调用 `run_analysis`。

## 受控人员记录

人员名单从聚合结果的单个指标格打开，不作为维度查询：

1. 选择一个 `records_available: true` 的指标。率和占比按服务端绑定的人群展开；没有记录合同的指标
   不能查看名单。
2. 查询中不声明分组维度，组织等条件写入 `filters`，并把结果收敛为一个业务时间桶和一个结果行。
3. 查询成功后调用 `show_records(view_id=...)`；结果含多个可展开指标时同时传 `metric_id`。
4. 名单打开后只确认已打开，必要时说明口径或限制，不在回复中复述姓名、工号或其他逐人字段。

用户只要人数时使用聚合指标。`export_result` 导出聚合结果，不是人员名单导出。

## 报告

- 只有用户要求保存、分享或复用时才调用 `save_report`。
- `find_report` 返回报告当前的 `analysis_id` 与 `view_id`。只要展示时直接调用 `show_analysis`。
- 改变呈现时先用 `rerun_analysis` 产生新 View，再用 `update_report` 替换报告的 `view_id`。
- 改变数据问题时执行 `load_analysis_result` → 修改 canonical `analysis` → `run_analysis` →
  `update_report`。报告不复制分析定义或 View。
- 更新时使用最近一次读取到的 `if_revision`；发生冲突后重新读取，不覆盖并发修改。

## 聚合结果导出

用户明确需要文件时调用 `export_result(view_id=...)`。派生结果不能直接导出；需要来源查询文件时，把来源
作为独立问题重新查询。客户端无法展示附件时转述工具返回的 `url` 与到期时间，不假定存在下载按钮。

## 文本交付

客户端不能显示结果卡时，在正文中交付结果：多行数据使用 Markdown 表格，人数使用整数，比例按结果格式
显示。率的两期之差使用百分点。只有等长且按日历对齐的两期才称同比或环比，其余对照称基准比较并说明
所比期间。结果过长时先给摘要，再根据用户需要缩小范围或导出文件。
