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
    serviceContext: SERVICE_CUBE_CONTEXT,
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

const hireRate = "employee_hire_metrics.current_month_new_hire_rate";
const hire = await execute([hireRate], "employee_hire_metrics");
assert(
  hire.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_hire_metrics,employee_snapshot_metrics",
  "本月入职率没有拆成入职与快照两条事实腿",
);
assert(Number.isFinite(Number(hire.row[hireRate])), "本月入职率没有返回有限值");

const turnoverRate = "employee_leave_metrics.current_month_turnover_rate";
const turnover = await execute([turnoverRate], "employee_leave_metrics");
assert(
  turnover.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_leave_metrics,employee_snapshot_metrics",
  "本月离职率没有拆成离职与快照两条事实腿",
);
assert(Number.isFinite(Number(turnover.row[turnoverRate])), "本月离职率没有返回有限值");

const fulfillmentRate = "headcount_plan_metrics.current_month_fulfillment_rate";
const fulfillment = await execute([fulfillmentRate], "headcount_plan_metrics");
assert(
  fulfillment.plan.legs
    .map((leg) => leg.source_view)
    .sort()
    .join(",") === "employee_snapshot_metrics,headcount_plan_metrics",
  "编制完成率没有拆成人员快照与编制计划两条事实腿",
);
assert(Number.isFinite(Number(fulfillment.row[fulfillmentRate])), "编制完成率没有返回有限值");
console.log("公开 Demo 正式指标 Planner 回归通过");
