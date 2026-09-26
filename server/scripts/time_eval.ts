/** 用真实 Cube 检查公开 Demo 的比率指标是否按预期拆成单表子查询。 */
import { createFormalMetricEvalRuntime } from "./formal_metric_eval_runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const { semanticPackage, execute } = await createFormalMetricEvalRuntime();
if (semanticPackage.id !== "pa_demo") throw new Error("此检查只适用于公开 Demo 包 pa_demo");

const hireRate = "employee_hire_metrics.monthly_hire_rate";
const hire = await execute([hireRate], "employee_hire_metrics");
assert(
  hire.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_hire_metrics,workforce_exposure_metrics",
  "月度入职率应拆成入职、在职人月两张事实表的子查询",
);
assert(Number.isFinite(Number(hire.row[hireRate])), "月度入职率没有返回有限值");

const turnoverRate = "employee_leave_metrics.monthly_separation_rate";
const turnover = await execute([turnoverRate], "employee_leave_metrics");
assert(
  turnover.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_leave_metrics,workforce_exposure_metrics",
  "月度离职率应拆成离职、在职人月两张事实表的子查询",
);
assert(Number.isFinite(Number(turnover.row[turnoverRate])), "月度离职率没有返回有限值");

const fulfillmentRate = "headcount_plan_metrics.headcount_plan_attainment_rate";
const fulfillment = await execute([fulfillmentRate], "headcount_plan_metrics");
assert(
  fulfillment.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_snapshot_metrics,headcount_plan_metrics",
  "编制达成率应拆成人员快照、计划编制两张事实表的子查询",
);
assert(Number.isFinite(Number(fulfillment.row[fulfillmentRate])), "编制达成率没有返回有限值");

const q12FavorableRate = "q12_survey_response_metrics.q12_favorable_rate";
const q12 = await execute([q12FavorableRate], "q12_survey_response_metrics");
assert(
  q12.plan.legs.length === 1 && q12.plan.legs[0]?.source_view === "q12_survey_response_metrics",
  "Q12 正向作答率应只查询答卷事实表，在一条子查询里算出分子分母后重算",
);
assert(Number.isFinite(Number(q12.row[q12FavorableRate])), "Q12正向作答率没有返回有限值");
console.log("公开 Demo 比率指标拆分检查通过");
