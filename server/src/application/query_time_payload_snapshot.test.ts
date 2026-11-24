import { expect, test } from "bun:test";
import type { CubeGateway, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";
import type { TimeInput } from "../semantic_core/time_contract.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { createQueryExecutionService } from "./query_execution_service.js";
import { authorizeTestAnalysisPlan } from "../test_support/dashboard.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";

/**
 * 公共交付协议的逻辑时间黄金对；物理查询窗口是内部计划，不进 Web 与 Agent 契约。
 * 改契约须同改本文件的黄金值。
 */
const GOLDEN_PATH = new URL("./query_time_payload.golden.json", import.meta.url);

const principal: Principal = {
  email: "viewer@example.com",
  roles: ["user"],
  accessScope: { kind: "limited", values: ["研发"] },
};
const TABLE_PRESENTATION: PresentationSpec = {
  type: "table",
};
const VIEW = "test_people_metrics";
const TIME_SOURCE = "workforce";

const view: CubeView = {
  name: VIEW,
  title: "人员总览",
  meta: { time_source: TIME_SOURCE, observation_scope: "测试人群口径。" },
  measures: [
    {
      name: `${VIEW}.active_employee_count`,
      title: "在职人数",
      type: "number",
      meta: { time_contract: { aggregation: "last", window: "selected" } },
    },
    {
      name: `${VIEW}.turnover_count`,
      title: "离职人数",
      type: "number",
      meta: { time_contract: { aggregation: "sum", window: "selected" } },
    },
    {
      name: `${VIEW}.ytd_event_rate`,
      title: "YTD事件率",
      type: "number",
      format: "percent",
      meta: { time_contract: { aggregation: "recompute", window: "year_to_date" } },
    },
    {
      name: `${VIEW}.monthly_event_rate`,
      title: "月度事件率",
      type: "number",
      format: "percent",
      meta: {
        time_contract: { aggregation: "recompute", window: "selected", grain: "month" },
      },
    },
  ],
  dimensions: [{ name: `${VIEW}.organization_name`, title: "组织", type: "string" }],
};

/** 黄金对不含结果行，桩只返回结构完整的空结果。 */
const emptyLoad = (query: CubeQuery) => ({
  data: [],
  annotation: {
    measures: Object.fromEntries(
      (query.measures ?? []).map((measure) => [measure, { title: measure }]),
    ),
    dimensions: Object.fromEntries(
      (query.dimensions ?? []).map((dimension) => [dimension, { title: dimension }]),
    ),
  },
});

const cube = {
  meta: async () => [view],
  timeContext: async () => ({
    dataAsOf: "2026-07",
    sources: { [TIME_SOURCE]: { actualThrough: "2026-07", availableThrough: "2026-07" } },
  }),
  load: async (query: CubeQuery) => emptyLoad(query),
  loadMulti: async (query: CubeQuery) =>
    (query.timeDimensions?.[0]?.compareDateRange ?? [[]]).map(() => emptyLoad(query)),
} as unknown as CubeGateway;

const service = createQueryExecutionService({
  cube,
});

/** 指标组合覆盖三种求值基准、按月定义的降级，以及拆腿路径。 */
const MEASURE_SETS: Record<string, string[]> = {
  point: [`${VIEW}.active_employee_count`],
  monthly: [`${VIEW}.monthly_event_rate`],
  flow: [`${VIEW}.turnover_count`],
  ptd: [`${VIEW}.ytd_event_rate`],
  "point+flow": [`${VIEW}.active_employee_count`, `${VIEW}.turnover_count`],
  "point+ptd": [`${VIEW}.active_employee_count`, `${VIEW}.ytd_event_rate`],
  "point+flow+ptd": [
    `${VIEW}.active_employee_count`,
    `${VIEW}.turnover_count`,
    `${VIEW}.ytd_event_rate`,
  ],
};

const TIME_INPUTS: Record<string, TimeInput> = {
  cutoff_default: {},
  cutoff: { cutoff: "2026-06" },
  range_month: { range: { from: "2025-11", to: "2026-02" }, grain: "month" },
  range_year: { range: { from: "2024-01", to: "2026-06" }, grain: "year" },
  range_year_partial_start: { range: { from: "2024-06", to: "2026-07" }, grain: "year" },
  range_total: { range: { from: "2026-01", to: "2026-06" }, grain: "total" },
  range_total_cross_year: { range: { from: "2025-01", to: "2026-06" }, grain: "total" },
  compare_cutoff: { cutoff: "2026-06", compare: [{ cutoff: "2025-06" }] },
  last_years: { cutoff: "2026-07", last: { years: 3 }, grain: "year" },
};

async function deliverTimeContract(measures: string[], time: TimeInput): Promise<string> {
  try {
    const result = await service.execute(
      authorizeTestAnalysisPlan({
        principal,
        plan: planExecution(
          {
            views: [{ id: "result", measures, dimensions: [`${VIEW}.organization_name`], time }],
          },
          { delivery: "identity" },
        ),
        presentation: TABLE_PRESENTATION,
        views: [view],
        timeContext: await cube.timeContext(),
      }),
    );
    const block = result.fullRowViewBlock;
    return JSON.stringify({
      columns: block.columns,
      column_roles: block.column_roles,
      // 每个指标列覆盖桶里哪一段，以及合计位实际求值的期间：结果的时间口径不止于共享的时间轴。
      column_time_basis: block.column_time_basis,
      totals: block.totals?.metrics.map(({ column, periods }) => ({
        column,
        periods: periods.map(({ value: _value, ...period }) => period),
      })),
      time: block.time,
    });
  } catch (error) {
    return `throw: ${(error as Error).message}`;
  }
}

async function deliverAll(): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const [measureKey, measures] of Object.entries(MEASURE_SETS)) {
    for (const [timeKey, time] of Object.entries(TIME_INPUTS)) {
      snapshot[`${measureKey} × ${timeKey}`] = await deliverTimeContract(measures, time);
    }
  }
  return snapshot;
}

test("公共交付协议的时间口径与黄金对逐字节一致", async () => {
  const actual = await deliverAll();
  // UPDATE_PAYLOAD_GOLDEN 只录制契约变更前的基线；在变更后运行会覆盖需要审查的协议差异。
  if (process.env.UPDATE_PAYLOAD_GOLDEN) {
    await Bun.write(GOLDEN_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const golden = (await Bun.file(GOLDEN_PATH).json()) as Record<string, string>;
  // 用例集键也是黄金对的一部分。
  expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  for (const key of Object.keys(golden)) {
    expect(actual[key], `公共时间契约变化：${key}`).toBe(golden[key]);
  }
});

test("黄金对覆盖全部时间形态且不泄漏内部求值方式", async () => {
  const golden = (await Bun.file(GOLDEN_PATH).json()) as Record<string, string>;
  const thrown = Object.values(golden).filter((value) => value.startsWith("throw: "));
  expect(thrown.length).toBeGreaterThan(0);
  expect(thrown.length).toBeLessThan(Object.keys(golden).length);
  expect(
    Object.values(golden)
      .filter((value) => !value.startsWith("throw: "))
      .every((value) => {
        const time = (JSON.parse(value) as { time?: Record<string, unknown> }).time;
        return time !== undefined && !("evaluations" in time);
      }),
    "公共结果不应泄漏指标的内部时间求值方式",
  ).toBe(true);
  expect(golden["point+flow+ptd × range_year"]).toContain(
    '"active_employee_count","turnover_count","ytd_event_rate"',
  );

  type Bucket = { key: { year: number; month?: number } | null; from: string; to: string };
  const allBuckets = Object.values(golden)
    .filter((value) => !value.startsWith("throw: "))
    .map((value) => (JSON.parse(value) as { time?: { buckets?: Bucket[] } }).time?.buckets);
  expect(
    allBuckets.every((buckets) => buckets?.length),
    "每个交付结果都必须声明结果桶",
  ).toBe(true);
  // 部分年桶的起点必须原样保留——这正是从物理窗口反推时会丢失的信息。
  expect(
    allBuckets.some((buckets) =>
      buckets!.some((bucket) => bucket.key?.month === undefined && !bucket.from.endsWith("-01")),
    ),
    "黄金对缺少非 1 月起点的部分年桶",
  ).toBe(true);
  // 无时间列的结果恒为单桶且行键为 null，消费方据此判断整份结果同属一个桶。
  expect(
    allBuckets.some((buckets) => buckets!.length === 1 && buckets![0].key === null),
    "黄金对缺少无时间列的单桶结果",
  ).toBe(true);
});
