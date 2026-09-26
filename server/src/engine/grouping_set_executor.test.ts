import { describe, expect, test } from "bun:test";
import type { ResolvedMetricLoad } from "./metric_calculator.js";
import type { MetricQueryPlan } from "./metric_planner.js";
import { applyGroupingSets } from "./grouping_set_executor.js";
import type { ResolvedGroupingSetPlan, ResolvedResultSignature } from "./grouping_set_planner.js";
import { resolveFilterLineage } from "./filter_lineage.js";

const ORG = "test_people_metrics.organization_name";
const LEVEL = "test_people_metrics.job_level_band";
const MEASURE = "test_people_metrics.active_employee_count";
const TIME = {
  outputGrain: "total" as const,
  coordinates: [
    {
      kind: "range" as const,
      from: "2025-01",
      to: "2026-07",
      buckets: [{ from: "2025-01", to: "2026-07" }],
    },
  ],
};

const metricPlan = (dimensions: string[]): MetricQueryPlan => ({
  kind: "metric_query",
  business_time: TIME,
  time_view: "test_people_metrics",
  legs: [],
  nodes: {},
  dimensions,
  measures: [MEASURE],
  output_metric_ids: {},
});

const signature = (grouping_set: string[]): ResolvedResultSignature => ({
  grouping_set,
  business_time: TIME,
});

const PLAN: ResolvedGroupingSetPlan = {
  view_id: "result",
  base_signature: signature(["dimension:organization_name", "dimension:job_level_band"]),
  base_keys: [ORG, LEVEL],
  base_grouping_members: [ORG, LEVEL],
  legs: [
    {
      id: "grouping_set_1",
      signature: signature(["dimension:organization_name"]),
      filter_lineage: resolveFilterLineage(),
      plan: metricPlan([ORG]),
    },
  ],
  calculations: [
    {
      kind: "grouping_share",
      id: "calculation:job_level_share",
      title: "职级占比",
      column: "calculation_job_level_share",
      measure: MEASURE,
      category_member: LEVEL,
      numerator_leg: "base",
      denominator_leg: "grouping_set_1",
    },
  ],
};

const load = (data: ResolvedMetricLoad["data"]): ResolvedMetricLoad => ({
  data,
  annotation: { measures: {}, dimensions: {} },
});

describe("grouping-set 执行", () => {
  test("执行时业务时间与基础结果不一致则报错", () => {
    const mismatched: ResolvedGroupingSetPlan = {
      ...PLAN,
      legs: PLAN.legs.map((leg) => ({
        ...leg,
        signature: {
          ...leg.signature,
          business_time: { ...TIME, outputGrain: "year" },
        },
      })),
    };
    expect(() => applyGroupingSets(mismatched, load([]), new Map())).toThrow(
      "执行时的业务时间与基础分组集不一致",
    );
  });

  test("执行时粗分组集不是基础分组集的语义子集则报错", () => {
    const mismatched: ResolvedGroupingSetPlan = {
      ...PLAN,
      legs: PLAN.legs.map((leg) => ({
        ...leg,
        signature: signature(["dimension:unknown"]),
      })),
    };
    expect(() => applyGroupingSets(mismatched, load([]), new Map())).toThrow(
      "执行分组集不是基础分组集的语义子集",
    );
  });

  test("执行时层级补全后的物理分组不比基础分组更粗则报错", () => {
    const mismatched: ResolvedGroupingSetPlan = {
      ...PLAN,
      legs: PLAN.legs.map((leg) => ({ ...leg, plan: metricPlan([ORG, LEVEL]) })),
    };
    expect(() =>
      applyGroupingSets(mismatched, load([]), new Map([["grouping_set_1", load([])]])),
    ).toThrow("执行物理分组没有形成真子集");
  });

  test("粗分组结果行缺失或重复时整个结果报错", () => {
    const base = load([{ [ORG]: "甲", [LEVEL]: "Band B", [MEASURE]: 10 }]);
    expect(() => applyGroupingSets(PLAN, base, new Map([["grouping_set_1", load([])]]))).toThrow(
      "缺少对应的粗分组结果行",
    );
    expect(() =>
      applyGroupingSets(
        PLAN,
        base,
        new Map([
          [
            "grouping_set_1",
            load([
              { [ORG]: "甲", [MEASURE]: 10 },
              { [ORG]: "甲", [MEASURE]: 10 },
            ]),
          ],
        ]),
      ),
    ).toThrow("粗分组集在规范结果键上出现重复行");
  });

  test("缺少结果键或指标列时报错，不当作空值处理", () => {
    expect(() =>
      applyGroupingSets(
        PLAN,
        load([{ [ORG]: "甲", [MEASURE]: 10 }]),
        new Map([["grouping_set_1", load([{ [ORG]: "甲", [MEASURE]: 10 }])]]),
      ),
    ).toThrow(`基础分组集缺少规范结果键 ${LEVEL}`);
    expect(() =>
      applyGroupingSets(
        PLAN,
        load([{ [ORG]: "甲", [LEVEL]: "Band B", [MEASURE]: 10 }]),
        new Map([["grouping_set_1", load([{ [ORG]: "甲" }])]]),
      ),
    ).toThrow(`分母缺少指标列 ${MEASURE}`);
  });

  test("分子为空或分母为零时占比为空", () => {
    const base = load([
      { [ORG]: "甲", [LEVEL]: "Band B", [MEASURE]: null },
      { [ORG]: "乙", [LEVEL]: "Band C", [MEASURE]: 0 },
    ]);
    const coarse = load([
      { [ORG]: "甲", [MEASURE]: 10 },
      { [ORG]: "乙", [MEASURE]: 0 },
    ]);
    expect(applyGroupingSets(PLAN, base, new Map([["grouping_set_1", coarse]])).load.data).toEqual([
      {
        [ORG]: "甲",
        [LEVEL]: "Band B",
        [MEASURE]: null,
        calculation_job_level_share: null,
      },
      {
        [ORG]: "乙",
        [LEVEL]: "Band C",
        [MEASURE]: 0,
        calculation_job_level_share: null,
      },
    ]);
  });

  test("总体行的构成占比为 100%，总体值为空或零时占比为空", () => {
    const summaryLeg = {
      id: "grouping_set_2",
      signature: signature([]),
      filter_lineage: resolveFilterLineage(),
      plan: metricPlan([]),
    };
    const plan: ResolvedGroupingSetPlan = {
      ...PLAN,
      legs: [...PLAN.legs, summaryLeg],
      summary_leg: summaryLeg.id,
    };
    for (const [value, expected] of [
      [30, 1],
      [0, null],
      [null, null],
    ] as const) {
      const result = applyGroupingSets(
        plan,
        load([]),
        new Map([
          ["grouping_set_1", load([])],
          ["grouping_set_2", load([{ [MEASURE]: value }])],
        ]),
      );
      expect(result.summary?.data).toEqual([
        { [MEASURE]: value, calculation_job_level_share: expected },
      ]);
    }
  });
});
