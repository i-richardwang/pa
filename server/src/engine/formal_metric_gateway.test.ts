import { expect, test } from "bun:test";
import type { CubeGateway, CubeSecurityContext, CubeView } from "../ports/cube_gateway.js";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./semantic_package.js";
import { withFormalMetricModel } from "./formal_metric_gateway.js";

const { formal_metrics: formalMetrics } = await loadSemanticPackage(configuredSemanticPackageDir());

const context: CubeSecurityContext = {
  subject: "test",
  groups: ["pa_full"],
  orgScope: "*",
};

const view = (name: string, measure: string): CubeView => ({
  name,
  title: name,
  meta: { query_surface: "metric_source" },
  measures: [{ name: `${name}.${measure}`, title: measure, type: "number" }],
  dimensions: [],
});

test("正式指标由端口装饰层叠加，原始 Cube gateway 保持物理模型", async () => {
  const physical = [
    view("employee_hire_metrics", "new_hire_count"),
    view("employee_snapshot_metrics", "active_employee_count"),
  ];
  const gateway = {
    meta: async () => physical,
    load: async () => ({ data: [], annotation: { measures: {}, dimensions: {} } }),
    loadMulti: async () => [],
    sql: async () => [],
    timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
  } satisfies CubeGateway;

  const modeled = withFormalMetricModel(gateway, formalMetrics);
  const views = await modeled.meta(context);
  const hires = views.find((candidate) => candidate.name === "employee_hire_metrics");

  expect(physical[0].measures.map((member) => member.name)).toEqual([
    "employee_hire_metrics.new_hire_count",
  ]);
  expect(hires?.measures.map((member) => member.name)).toContain(
    "employee_hire_metrics.current_month_new_hire_rate",
  );
  expect(modeled.load).toBe(gateway.load);
});
