import { describe, expect, test } from "bun:test";
import type { CubeGateway, CubeQuery, CubeView, LoadResponse } from "../ports/cube_gateway.js";
import type { CubeSecurityContext } from "../ports/cube_gateway.js";
import { executeMetricQuery } from "./metric_executor.js";
import { planMetricQuery } from "./metric_planner.js";

const periodic = "periodic_quality_metrics";
const organization = `${periodic}.organization_name`;
const agreeRate = `${periodic}.positive_response_rate`;
const sampleCount = `${periodic}.sample_count`;

const views: CubeView[] = [
  {
    name: periodic,
    title: "周期质量评估",
    meta: { time_source: "workforce" },
    measures: [
      {
        name: agreeRate,
        title: "正向回答比例",
        type: "number",
        format: "percent",
        meta: {
          time_contract: { aggregation: "last", window: "selected" },
          components: {
            numerator: "positive_response_count",
            denominator: "sample_count",
          },
          result_guards: [
            { kind: "minimum_support", support_measure: "sample_count", threshold: 5 },
          ],
        },
      },
      {
        name: sampleCount,
        title: "样本数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
    dimensions: [
      { name: organization, title: "组织", type: "string" },
      { name: `${periodic}.year`, title: "年", type: "number" },
      { name: `${periodic}.month`, title: "月", type: "number" },
      { name: `${periodic}.period_month`, title: "期间", type: "time" },
    ],
  },
];

const context = {
  dataAsOf: "2026-07",
  sources: {
    workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
  },
};

const security: CubeSecurityContext = {
  subject: "tester",
  groups: [],
  accessScope: { kind: "all" },
};

function response(query: CubeQuery, rows: Record<string, unknown>[]): LoadResponse {
  return {
    data: rows,
    annotation: {
      measures: Object.fromEntries(
        (query.measures ?? []).map((member) => [member, { title: member }]),
      ),
      dimensions: Object.fromEntries(
        (query.dimensions ?? []).map((member) => [member, { title: member }]),
      ),
    },
  };
}

function cubeWith(
  load: (query: CubeQuery) => Promise<LoadResponse>,
): Pick<CubeGateway, "load" | "loadMulti"> {
  return {
    load: (query) => load(query),
    loadMulti: async (query) => [await load(query)],
  };
}

describe("聚合后结果保护", () => {
  test("支撑量不足的结果格置空并统计，达到阈值的原样保留", async () => {
    const plan = planMetricQuery(
      { measures: [agreeRate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      periodic,
    );

    // 支撑指标未被请求，Planner 必须自动带上。
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].plan.query.measures).toContain(sampleCount);
    expect(plan.result_guards).toEqual([
      {
        kind: "minimum_support",
        measure: agreeRate,
        support_measure: "measure:sample_count",
        threshold: 5,
      },
    ]);

    const cube = cubeWith(async (query) =>
      response(query, [
        { [organization]: "A", [agreeRate]: 0.9, [sampleCount]: 4 },
        { [organization]: "B", [agreeRate]: 0.8, [sampleCount]: 5 },
        { [organization]: "C", [agreeRate]: 0.7, [sampleCount]: null },
      ]),
    );
    const result = await executeMetricQuery(cube, plan, security, views);

    expect(result.data).toEqual([
      { [organization]: "A", [agreeRate]: null },
      { [organization]: "B", [agreeRate]: 0.8 },
      { [organization]: "C", [agreeRate]: null },
    ]);
    expect(result.masked).toEqual([{ member: agreeRate, threshold: 5, groups: 2 }]);
  });

  test("全部结果格支撑量充足时不产生遮蔽统计", async () => {
    const plan = planMetricQuery(
      { measures: [agreeRate], dimensions: [organization] },
      { cutoff: "2026-07", grain: "total" },
      context,
      views,
      periodic,
    );
    const cube = cubeWith(async (query) =>
      response(query, [{ [organization]: "A", [agreeRate]: 0.9, [sampleCount]: 200 }]),
    );
    const result = await executeMetricQuery(cube, plan, security, views);

    expect(result.data).toEqual([{ [organization]: "A", [agreeRate]: 0.9 }]);
    expect(result.masked).toBeUndefined();
  });

  test("minimum_support 缺少显式支撑指标时 fail-closed", () => {
    const broken: CubeView[] = [
      {
        ...views[0],
        measures: [
          {
            name: agreeRate,
            title: "正向回答比例",
            type: "number",
            meta: {
              time_contract: { aggregation: "last", window: "selected" },
              result_guards: [{ kind: "minimum_support", threshold: 5 }],
            },
          },
        ],
      },
    ];
    expect(() =>
      planMetricQuery(
        { measures: [agreeRate] },
        { cutoff: "2026-07", grain: "total" },
        context,
        broken,
        periodic,
      ),
    ).toThrow("支撑指标必须显式声明");
  });

  test("支撑指标独立于公式分母并可来自另一张事实", () => {
    const supportView = "periodic_quality_support";
    const withRespondents: CubeView[] = [
      {
        ...views[0],
        measures: [
          {
            ...views[0].measures[0],
            meta: {
              ...views[0].measures[0].meta,
              result_guards: [
                {
                  kind: "minimum_support",
                  support_measure: "respondent_count",
                  threshold: 5,
                },
              ],
            },
          },
          views[0].measures[1],
        ],
      },
      {
        name: supportView,
        title: "评估参与情况",
        meta: { time_source: "workforce" },
        measures: [
          {
            name: `${supportView}.respondent_count`,
            title: "答卷人数",
            type: "number",
            meta: { time_contract: { aggregation: "last", window: "selected" } },
          },
        ],
        dimensions: [
          { name: `${supportView}.year`, title: "年", type: "number" },
          { name: `${supportView}.month`, title: "月", type: "number" },
          { name: `${supportView}.period_month`, title: "期间", type: "time" },
        ],
      },
    ];
    const plan = planMetricQuery(
      { measures: [agreeRate] },
      { cutoff: "2026-07", grain: "total" },
      context,
      withRespondents,
      periodic,
    );
    expect(plan.result_guards).toEqual([
      {
        kind: "minimum_support",
        measure: agreeRate,
        support_measure: "measure:respondent_count",
        threshold: 5,
      },
    ]);
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs.find((leg) => leg.source_view === supportView)?.plan.query.measures).toContain(
      `${supportView}.respondent_count`,
    );
  });

  test("minimum_support 阈值不是正整数时 fail-closed", () => {
    const broken: CubeView[] = [
      {
        ...views[0],
        measures: [
          {
            name: agreeRate,
            title: "正向回答比例",
            type: "number",
            meta: {
              time_contract: { aggregation: "last", window: "selected" },
              components: { numerator: "x", denominator: "sample_count" },
              result_guards: [
                { kind: "minimum_support", support_measure: "sample_count", threshold: 0 },
              ],
            },
          },
          views[0].measures[1],
        ],
      },
    ];
    expect(() =>
      planMetricQuery(
        { measures: [agreeRate] },
        { cutoff: "2026-07", grain: "total" },
        context,
        broken,
        periodic,
      ),
    ).toThrow("正整数");
  });
});
