import { describe, expect, test } from "bun:test";
import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./semantic_package.js";
import {
  applyFormalMetricModel,
  metricNodeOf,
  type FormalMetricDefinition,
} from "./metric_model.js";

const { formal_metrics: formalMetrics } = await loadSemanticPackage(configuredSemanticPackageDir());
const guardedMetric: FormalMetricDefinition = {
  name: "guarded_count",
  metric_domain_id: "metric_domain:workforce_movement",
  host_view: "employee_leave_metrics",
  title: "受可用性保护的计数",
  description: "批次不可用时返回空值的示例计数。",
  time_contract: { aggregation: "sum", window: "year_to_date" },
  node: {
    kind: "availability_guard",
    value: { metric_id: "measure:guarded_count_raw", missing: "zero" },
    availability: { metric_id: "measure:guarded_population_count", missing: "null" },
    unavailable: "null",
  },
  record_projection: {
    view: "employee_leave_records",
    underlying_records: {
      record_set: "termination_event",
      selection: { kind: "measure", member: "guarded_count_raw" },
    },
  },
};

const measure = (
  view: string,
  name: string,
  aggregation: "sum" | "last" | "average" = "sum",
): CubeMember => ({
  name: `${view}.${name}`,
  title: name,
  type: "number",
  meta: { time_contract: { aggregation, window: "selected" } },
});

const view = (name: string, measures: CubeMember[], detail = false): CubeView => ({
  name,
  title: name,
  meta: detail ? { query_surface: "detail" } : {},
  measures,
  dimensions: [],
});

describe("正式指标模型", () => {
  test("跨来源组件全部可见时替换 Cube 中的同名比例并保留目录身份", () => {
    const oldRate = {
      ...measure("employee_leave_metrics", "current_month_turnover_rate"),
      description: "旧定义",
    };
    const modeled = applyFormalMetricModel(
      [
        view("employee_leave_metrics", [
          measure("employee_leave_metrics", "turnover_count"),
          oldRate,
        ]),
        view("employee_snapshot_metrics", [
          measure("employee_snapshot_metrics", "active_employee_count", "last"),
        ]),
      ],
      formalMetrics,
    );
    const rate = modeled[0].measures.find(
      (member) => member.name === "employee_leave_metrics.current_month_turnover_rate",
    );

    expect(rate?.title).toBe("本月离职率");
    expect(rate?.description).toBe("所选月份离职人数除以同月月末在职人数。");
    expect(rate?.meta?.components).toEqual({
      numerator: "turnover_count",
      denominator: "active_employee_count",
    });
    expect(rate && metricNodeOf(rate)).toEqual({
      kind: "ratio",
      numerator: { metric_id: "measure:turnover_count", missing: "zero" },
      denominator: { metric_id: "measure:active_employee_count", missing: "null" },
      division_by_zero: "null",
    });
  });

  test("组件不可见时不暴露复合指标，权限沿叶子指标闭合", () => {
    const modeled = applyFormalMetricModel(
      [
        view("employee_leave_metrics", [measure("employee_leave_metrics", "turnover_count")]),
        view("employee_leave_records", [], true),
      ],
      formalMetrics,
    );
    expect(
      modeled[0].measures.some((member) => member.name.endsWith(".current_month_turnover_rate")),
    ).toBe(false);
    expect(
      modeled[1].measures.some((member) => member.name.endsWith(".current_month_turnover_rate")),
    ).toBe(false);
  });

  test("受控记录面使用同一正式定义并把率指标下钻绑定到分子记录集", () => {
    const modeled = applyFormalMetricModel(
      [
        view("employee_leave_metrics", [measure("employee_leave_metrics", "turnover_count")]),
        view("employee_snapshot_metrics", [
          measure("employee_snapshot_metrics", "active_employee_count", "last"),
        ]),
        view("employee_leave_records", [], true),
      ],
      formalMetrics,
    );
    const detail = modeled.find((candidate) => candidate.name === "employee_leave_records")!;
    const rate = detail.measures.find(
      (member) => member.name === "employee_leave_records.current_month_turnover_rate",
    );
    expect(rate?.meta?.underlying_records).toEqual({
      record_set: "termination_event",
      selection: { kind: "numerator" },
    });
    expect(rate?.meta?.components).toEqual({
      numerator: "turnover_count",
      denominator: "active_employee_count",
    });
  });

  test("内部计数与公开成员资格共同装配可用性守卫，并复用到记录面", () => {
    const attrition = view("employee_leave_metrics", []);
    attrition.internalMeasures = [measure("employee_leave_metrics", "guarded_count_raw")];
    const modeled = applyFormalMetricModel(
      [
        attrition,
        view("employee_snapshot_metrics", [
          measure("employee_snapshot_metrics", "guarded_population_count", "last"),
        ]),
        view("employee_leave_records", [], true),
      ],
      [guardedMetric],
    );
    const count = modeled[0].measures.find((member) => member.name.endsWith(".guarded_count"));
    const detail = modeled[2].measures.find((member) => member.name.endsWith(".guarded_count"));

    expect(count && metricNodeOf(count)).toMatchObject({
      kind: "availability_guard",
    });
    expect(detail?.meta?.underlying_records).toEqual({
      record_set: "termination_event",
      selection: {
        kind: "measure",
        member: "guarded_count_raw",
      },
    });
  });
});
