import { expect, test } from "bun:test";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import { planMetricQuery } from "../test_support/planning.js";
import type { TimeInput } from "../semantic_core/time_contract.js";

/** 时间编译快照：每个指标组合 × 每种业务时间输入的编译结果（物理查询或报错文案）。 */
const GOLDEN_PATH = new URL("./time_plan.golden.json", import.meta.url);

const views: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "人员总览",
    meta: { time_source: "workforce" },
    dimensions: [{ name: "test_people_metrics.organization_name", title: "组织", type: "string" }],
    measures: [
      {
        name: "test_people_metrics.active_employee_count",
        title: "在职人数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
      {
        name: "test_people_metrics.new_hire_count",
        title: "入职人数",
        type: "number",
        meta: { time_contract: { aggregation: "sum", window: "selected" } },
      },
      {
        name: "test_people_metrics.current_month_turnover_rate",
        title: "本月离职率",
        type: "number",
        meta: { time_contract: { aggregation: "recompute", window: "selected", grain: "month" } },
      },
      {
        name: "test_people_metrics.ytd_primary_event_rate",
        title: "YTD主要事件率",
        type: "number",
        meta: { time_contract: { aggregation: "recompute", window: "year_to_date" } },
      },
    ],
  },
  {
    name: "headcount_plan",
    title: "人员与编制",
    meta: { time_source: "headcount_plan" },
    dimensions: [
      {
        name: "headcount_plan.organization_name",
        title: "组织",
        type: "string",
      },
    ],
    measures: [
      {
        name: "headcount_plan.point_in_time_target_count",
        title: "月度目标数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
      {
        name: "headcount_plan.planned_position_count",
        title: "规划岗位数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
  },
];

const context: TimeContext = {
  dataAsOf: "2026-07",
  sources: {
    workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
    headcount_plan: {
      actualThrough: "2026-07",
      planThrough: "2026-12",
      availableThrough: "2026-12",
    },
  },
};

const people = "test_people_metrics";
const plan = "headcount_plan";

const MEASURE_SETS: Record<string, string[]> = {
  point: [`${people}.active_employee_count`],
  flow: [`${people}.new_hire_count`],
  ptd: [`${people}.ytd_primary_event_rate`],
  monthly_rate: [`${people}.current_month_turnover_rate`],
  "point+flow": [`${people}.active_employee_count`, `${people}.new_hire_count`],
  "point+ptd": [`${people}.active_employee_count`, `${people}.ytd_primary_event_rate`],
  "point+flow+ptd": [
    `${people}.active_employee_count`,
    `${people}.new_hire_count`,
    `${people}.ytd_primary_event_rate`,
  ],
};

const TIME_INPUTS: Record<string, TimeInput> = {
  cutoff_default: {},
  cutoff: { cutoff: "2026-06" },
  range_month: { range: { from: "2025-11", to: "2026-02" }, grain: "month" },
  range_year: { range: { from: "2024-01", to: "2026-06" }, grain: "year" },
  range_year_partial_start: { range: { from: "2024-06", to: "2026-07" }, grain: "year" },
  range_year_two_months: { range: { from: "2024-12", to: "2025-01" }, grain: "year" },
  range_total: { range: { from: "2026-01", to: "2026-06" }, grain: "total" },
  range_total_cross_year: { range: { from: "2025-01", to: "2026-06" }, grain: "total" },
  range_total_single_month: { range: { from: "2026-06", to: "2026-06" }, grain: "total" },
  last_months: { cutoff: "2026-07", last: { months: 12 }, grain: "month" },
  last_years: { cutoff: "2026-07", last: { years: 3 }, grain: "year" },
  compare_cutoff: { cutoff: "2026-06", compare: [{ cutoff: "2025-06" }] },
  compare_cutoff_years_ago: { cutoff: "2026-06", compare: [{ years_ago: 1 }] },
  compare_range_month: {
    range: { from: "2026-01", to: "2026-06" },
    compare: [{ range: { from: "2025-01", to: "2025-06" } }],
    grain: "month",
  },
  compare_range_year: {
    range: { from: "2026-01", to: "2026-06" },
    compare: [{ years_ago: 1 }],
    grain: "year",
  },
  // 省略截止月时，相对窗口与对照以服务端 actual_through 为截止月。
  last_months_default_anchor: { last: { months: 12 }, grain: "month" },
  last_years_default_anchor: { last: { years: 3 }, grain: "year" },
  compare_years_ago_default_anchor: { compare: [{ years_ago: 1 }] },
  last_months_compare_years_ago_default_anchor: {
    last: { months: 12 },
    compare: [{ years_ago: 1 }],
    grain: "month",
  },
};

function compile(measures: string[], dimension: string, time: TimeInput): string {
  try {
    return JSON.stringify(
      planMetricQuery({ measures, dimensions: [dimension] }, time, context, views),
    );
  } catch (error) {
    return `throw: ${(error as Error).message}`;
  }
}

function compileAll(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [measureKey, measures] of Object.entries(MEASURE_SETS)) {
    for (const [timeKey, time] of Object.entries(TIME_INPUTS)) {
      snapshot[`${measureKey} × ${timeKey}`] = compile(
        measures,
        `${people}.organization_name`,
        time,
      );
    }
  }
  // 计划数据可查询到已登记的未来月份。
  const planMeasures = [`${plan}.point_in_time_target_count`, `${plan}.planned_position_count`];
  const planDimension = `${plan}.organization_name`;
  snapshot["plan_point × cutoff_default"] = compile(planMeasures, planDimension, {});
  snapshot["plan_point × future_cutoff"] = compile(planMeasures, planDimension, {
    cutoff: "2026-12",
  });
  snapshot["plan_point × range_year"] = compile(planMeasures, planDimension, {
    range: { from: "2025-01", to: "2026-12" },
    grain: "year",
  });
  return snapshot;
}

test("时间编译结果与快照文件一致", async () => {
  const actual = compileAll();
  if (process.env.UPDATE_TIME_GOLDEN) {
    await Bun.write(GOLDEN_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const golden = (await Bun.file(GOLDEN_PATH).json()) as Record<string, string>;
  // 新增输入组合后需用 UPDATE_TIME_GOLDEN=1 重新生成快照。
  expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  for (const key of Object.keys(golden)) {
    expect(actual[key], `编译产物变化：${key}`).toBe(golden[key]);
  }
});

test("快照覆盖三种时间语义和各类时间形态，并包含报错用例", async () => {
  const golden = (await Bun.file(GOLDEN_PATH).json()) as Record<string, string>;
  const thrown = Object.values(golden).filter((value) => value.startsWith("throw: "));
  expect(thrown.length).toBeGreaterThan(0);
  expect(thrown.length).toBeLessThan(Object.keys(golden).length);
  for (const marker of [
    "按日历年重新起算",
    "按月定义",
    "compareDateRange",
    '"granularity":"year"',
  ]) {
    expect(
      Object.values(golden).some((value) => value.includes(marker)),
      `黄金对缺少关键形态「${marker}」`,
    ).toBe(true);
  }
});
