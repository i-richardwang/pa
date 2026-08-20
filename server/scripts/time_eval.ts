/** 公开 Demo 的正式指标 Planner 真实 Cube 回归。 */
import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { config } from "../src/config.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import { executeMetricQuery } from "../src/engine/metric_executor.js";
import { metricPlanLeafQueries, planMetricQuery } from "../src/engine/metric_planner.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
if (semanticPackage.id !== "pa_demo") throw new Error("本回归只验证公开 pa_demo 包");
const cube = withFormalMetricModel(
  createCubeGateway({
    cubeUrl: config.cubeUrl,
    apiSecret: config.apiSecret,
    accessScopeId: semanticPackage.access_scope.id,
    serviceContext: SERVICE_CUBE_CONTEXT,
    timeSources: semanticPackage.time_sources,
  }),
  semanticPackage.formal_metrics,
);
const views = await cube.meta(SERVICE_CUBE_CONTEXT);
const context = await cube.timeContext();

async function execute(measures: string[], timeView?: string) {
  const plan = planMetricQuery(
    { measures },
    { cutoff: context.dataAsOf },
    context,
    views,
    timeView,
  );
  for (const leaf of metricPlanLeafQueries(plan)) {
    const prefixes = new Set(
      [...(leaf.query.measures ?? []), ...(leaf.query.dimensions ?? [])].map(
        (member) => member.split(".")[0],
      ),
    );
    assert(prefixes.size <= 1, "单条 Cube 查询腿混入多个事实来源");
  }
  const result = await executeMetricQuery(cube, plan, SERVICE_CUBE_CONTEXT, views);
  return { plan, row: result.data[0] ?? {} };
}

const hireRate = "employee_hire_metrics.monthly_hire_rate";
const hire = await execute([hireRate], "employee_hire_metrics");
assert(
  hire.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_hire_metrics,workforce_exposure_metrics",
  "月度入职率没有拆成入职与在职人月两条事实腿",
);
assert(Number.isFinite(Number(hire.row[hireRate])), "月度入职率没有返回有限值");

const turnoverRate = "employee_leave_metrics.monthly_separation_rate";
const turnover = await execute([turnoverRate], "employee_leave_metrics");
assert(
  turnover.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_leave_metrics,workforce_exposure_metrics",
  "月度离职率没有拆成离职与在职人月两条事实腿",
);
assert(Number.isFinite(Number(turnover.row[turnoverRate])), "月度离职率没有返回有限值");

const fulfillmentRate = "headcount_plan_metrics.headcount_plan_attainment_rate";
const fulfillment = await execute([fulfillmentRate], "headcount_plan_metrics");
assert(
  fulfillment.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_snapshot_metrics,headcount_plan_metrics",
  "编制达成率没有拆成人员快照与计划编制两条事实腿",
);
assert(Number.isFinite(Number(fulfillment.row[fulfillmentRate])), "编制达成率没有返回有限值");

const q12FavorableRate = "q12_survey_response_metrics.q12_favorable_rate";
const q12 = await execute([q12FavorableRate], "q12_survey_response_metrics");
assert(
  q12.plan.legs.length === 1 && q12.plan.legs[0]?.source_view === "q12_survey_response_metrics",
  "Q12正向作答率没有在单一答卷事实上完成组件聚合与重算",
);
assert(Number.isFinite(Number(q12.row[q12FavorableRate])), "Q12正向作答率没有返回有限值");
console.log("公开 Demo 正式指标 Planner 回归通过");
