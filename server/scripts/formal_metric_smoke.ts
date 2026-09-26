/** 对当前语义包登记的每个正式指标，用 Planner 规划并在真实 Cube 上执行一次，确认能返回数值。 */
import { createFormalMetricEvalRuntime } from "./formal_metric_eval_runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const { semanticPackage, execute } = await createFormalMetricEvalRuntime();

for (const metric of semanticPackage.formal_metrics) {
  const measure = `${metric.host_view}.${metric.name}`;
  const { row } = await execute([measure], metric.host_view);
  assert(Object.hasOwn(row, measure), `正式指标 ${measure} 没有返回输出列`);
  const value = row[measure];
  assert(value === null || Number.isFinite(Number(value)), `正式指标 ${measure} 返回了非数值结果`);
}

console.log(
  `${semanticPackage.id} 正式指标检查通过（${semanticPackage.formal_metrics.length} 项）`,
);
