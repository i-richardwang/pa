import { describe, expect, test } from "bun:test";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import {
  TIME_GRAINS,
  TIME_INPUT,
  type TimeInput,
  timeBuckets,
} from "../semantic_core/time_contract.js";
import { planMetricQuery } from "./metric_planner.js";
import { planTimeQuery } from "./time_plan.js";

/** 截止月份坐标恒为单月桶，与结果粒度无关。 */
const atCutoff = (month: string) => ({
  kind: "cutoff" as const,
  from: month,
  to: month,
  buckets: [{ from: month, to: month }],
});

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
    internalMeasures: [
      {
        name: "test_people_metrics.ytd_guarded_event_count_raw",
        title: "YTD受资格约束事件内部计数",
        type: "number",
        meta: {
          internal: true,
          time_contract: { aggregation: "sum", window: "year_to_date" },
        },
      },
    ],
  },
  {
    name: "headcount_plan",
    title: "人员与编制",
    meta: { time_source: "headcount_plan" },
    dimensions: [],
    measures: [
      {
        name: "headcount_plan.point_in_time_target_count",
        title: "月度目标数",
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

describe("业务时间桶枚举", () => {
  test("截止月份是单月桶，与结果粒度无关", () => {
    for (const grain of TIME_GRAINS) {
      expect(timeBuckets({ kind: "cutoff", cutoff: "2026-06" }, grain)).toEqual([
        { from: "2026-06", to: "2026-06" },
      ]);
    }
  });

  test("按月逐月成桶，按年每个日历年一桶，合计整段一个大桶", () => {
    const range = { kind: "range", from: "2025-11", to: "2026-02" } as const;
    expect(timeBuckets(range, "month")).toEqual([
      { from: "2025-11", to: "2025-11" },
      { from: "2025-12", to: "2025-12" },
      { from: "2026-01", to: "2026-01" },
      { from: "2026-02", to: "2026-02" },
    ]);
    expect(timeBuckets(range, "year")).toEqual([
      { from: "2025-11", to: "2025-12" },
      { from: "2026-01", to: "2026-02" },
    ]);
    expect(timeBuckets(range, "total")).toEqual([{ from: "2025-11", to: "2026-02" }]);
  });

  test("非 1 月起点与未满年的年度期间产出部分年桶，不是特例", () => {
    expect(timeBuckets({ kind: "range", from: "2024-06", to: "2026-07" }, "year")).toEqual([
      { from: "2024-06", to: "2024-12" },
      { from: "2025-01", to: "2025-12" },
      { from: "2026-01", to: "2026-07" },
    ]);
  });

  test("桶恒覆盖整段且首尾对齐坐标，终点即桶末月", () => {
    const ranges = [
      { from: "2026-06", to: "2026-06" },
      { from: "2025-11", to: "2026-02" },
      { from: "2024-01", to: "2026-06" },
      { from: "2024-06", to: "2026-07" },
      { from: "2024-12", to: "2025-01" },
    ];
    for (const range of ranges) {
      for (const grain of TIME_GRAINS) {
        const buckets = timeBuckets({ kind: "range", ...range }, grain);
        expect(buckets[0].from).toBe(range.from);
        expect(buckets.at(-1)!.to).toBe(range.to);
        buckets.forEach((bucket, index) => {
          expect(bucket.from <= bucket.to).toBe(true);
          if (index > 0) expect(bucket.from > buckets[index - 1].to).toBe(true);
        });
      }
    }
  });
});

describe("TimePlan 业务时间坐标", () => {
  test("受控明细可沿内部计数成员规划时间，公开目录仍不暴露该成员", () => {
    const internal = "test_people_metrics.ytd_guarded_event_count_raw";
    const plan = planTimeQuery({ measures: [internal] }, { cutoff: "2026-06" }, context, views);
    expect(plan.query.measures).toEqual([internal]);
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2026-06-01", "2026-06-30"],
    });
    expect(views[0].measures.some((measure) => measure.name === internal)).toBe(false);
  });

  test("同一截止月份允许期末值、区间聚合与 YTD 指标同查", () => {
    const plan = planTimeQuery(
      {
        measures: [
          "test_people_metrics.active_employee_count",
          "test_people_metrics.new_hire_count",
          "test_people_metrics.ytd_primary_event_rate",
        ],
        dimensions: ["test_people_metrics.organization_name"],
      },
      { cutoff: "2026-06" },
      context,
      views,
    );
    expect(plan.query.timeDimensions).toEqual([
      {
        dimension: "test_people_metrics.period_month",
        granularity: "month",
        dateRange: ["2026-06-01", "2026-06-30"],
      },
    ]);
    expect(plan.query.filters).toEqual([
      { member: "test_people_metrics.year", operator: "equals", values: ["2026"] },
    ]);
  });

  test("月度率允许单月与按月序列，拒绝把多个月份合并为一个率", () => {
    const measure = "test_people_metrics.current_month_turnover_rate";
    expect(
      planTimeQuery({ measures: [measure] }, { cutoff: "2026-06" }, context, views).query
        .timeDimensions?.[0],
    ).toMatchObject({
      granularity: "month",
      dateRange: ["2026-06-01", "2026-06-30"],
    });
    expect(
      planTimeQuery(
        { measures: [measure] },
        { range: { from: "2026-04", to: "2026-06" }, grain: "month" },
        context,
        views,
      ).query.timeDimensions?.[0],
    ).toMatchObject({
      granularity: "month",
      dateRange: ["2026-04-01", "2026-06-30"],
    });
    expect(
      planTimeQuery(
        { measures: [measure] },
        { range: { from: "2026-04", to: "2026-06" } },
        context,
        views,
      ).businessTime.outputGrain,
    ).toBe("month");
    expect(() =>
      planTimeQuery(
        { measures: [measure] },
        { range: { from: "2026-04", to: "2026-06" }, grain: "total" },
        context,
        views,
      ),
    ).toThrow(/按月定义.*不能合并多个月份/);
    expect(() =>
      planTimeQuery(
        { measures: [measure] },
        { range: { from: "2025-01", to: "2026-06" }, grain: "year" },
        context,
        views,
      ),
    ).toThrow(/按月定义.*不能合并多个月份/);
  });

  test("仅有 cutoff 时 flow 解释为当前桶", () => {
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.new_hire_count"] },
      { cutoff: "2026-05" },
      context,
      views,
    );
    expect(plan.time.windows).toEqual([{ from: "2026-05-01", to: "2026-05-31" }]);
  });

  test("point 与 PTD 的总计 range 都取终点月", () => {
    const plan = planTimeQuery(
      {
        measures: [
          "test_people_metrics.active_employee_count",
          "test_people_metrics.ytd_primary_event_rate",
        ],
      },
      { range: { from: "2026-01", to: "2026-06" }, grain: "total" },
      context,
      views,
    );
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2026-06-01", "2026-06-30"],
    });
  });

  test("flow 的连续期间按月分桶", () => {
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.new_hire_count"] },
      { range: { from: "2025-11", to: "2026-02" }, grain: "month" },
      context,
      views,
    );
    expect(plan.query.timeDimensions).toEqual([
      {
        dimension: "test_people_metrics.period_month",
        granularity: "month",
        dateRange: ["2025-11-01", "2026-02-28"],
      },
    ]);
    expect(plan.query.filters).toEqual([
      {
        member: "test_people_metrics.year",
        operator: "equals",
        values: ["2025", "2026"],
      },
    ]);
  });

  test("日历年初对齐的 PTD range 生成逐月 YTD", () => {
    const plan = planTimeQuery(
      {
        measures: [
          "test_people_metrics.active_employee_count",
          "test_people_metrics.ytd_primary_event_rate",
        ],
      },
      { range: { from: "2026-01", to: "2026-06" }, grain: "month" },
      context,
      views,
    );
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2026-01-01", "2026-06-30"],
    });
  });

  test("对照截止月份编译为多窗并自动带出年份", () => {
    const input = TIME_INPUT.parse({
      cutoff: "2026-06",
      compare: [{ cutoff: "2024-06" }, { cutoff: "2025-06" }],
    });
    const plan = planTimeQuery(
      {
        measures: [
          "test_people_metrics.active_employee_count",
          "test_people_metrics.ytd_primary_event_rate",
        ],
      },
      input,
      context,
      views,
    );
    expect(plan.query.timeDimensions?.[0].compareDateRange).toEqual([
      ["2026-06-01", "2026-06-30"],
      ["2024-06-01", "2024-06-30"],
      ["2025-06-01", "2025-06-30"],
    ]);
    expect(plan.businessTime.outputGrain).toBe("year");
    expect(plan.businessTime.coordinates).toEqual([
      atCutoff("2026-06"),
      atCutoff("2024-06"),
      atCutoff("2025-06"),
    ]);
  });

  test("相对对照 years_ago 与等价绝对坐标编译一致", () => {
    const relative = TIME_INPUT.parse({
      cutoff: "2026-06",
      compare: [{ years_ago: 1 }, { years_ago: 2 }],
    });
    const absolute = TIME_INPUT.parse({
      cutoff: "2026-06",
      compare: [{ cutoff: "2025-06" }, { cutoff: "2024-06" }],
    });
    expect(
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        relative,
        context,
        views,
      ),
    ).toEqual(
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        absolute,
        context,
        views,
      ),
    );
    const relativePlan = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      relative,
      context,
      views,
    );
    expect(relativePlan.businessTime.coordinates).toEqual([
      atCutoff("2026-06"),
      atCutoff("2025-06"),
      atCutoff("2024-06"),
    ]);
  });

  test("省略主截止月的 years_ago 对照落到 actual_through 并保守按月", () => {
    const relative = TIME_INPUT.parse({ compare: [{ years_ago: 1 }] });
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      relative,
      context,
      views,
    );
    expect(plan.businessTime.outputGrain).toBe("month");
    expect(plan.businessTime.coordinates).toEqual([atCutoff("2026-07"), atCutoff("2025-07")]);
  });

  test("range 主坐标的 years_ago 对照两端同移一年", () => {
    const relative = TIME_INPUT.parse({
      range: { from: "2026-01", to: "2026-06" },
      compare: [{ years_ago: 1 }],
      grain: "month",
    });
    const absolute = TIME_INPUT.parse({
      range: { from: "2026-01", to: "2026-06" },
      compare: [{ range: { from: "2025-01", to: "2025-06" } }],
      grain: "month",
    });
    expect(
      planTimeQuery({ measures: ["test_people_metrics.new_hire_count"] }, relative, context, views),
    ).toEqual(
      planTimeQuery({ measures: ["test_people_metrics.new_hire_count"] }, absolute, context, views),
    );
  });

  test("相对窗口 last:{months} 与等价绝对 range 逐字节一致，随锚点滚动", () => {
    const relative = TIME_INPUT.parse({ cutoff: "2026-07", last: { months: 12 } });
    const absolute = TIME_INPUT.parse({
      range: { from: "2025-08", to: "2026-07" },
      grain: "month",
    });
    expect(
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        relative,
        context,
        views,
      ),
    ).toEqual(
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        absolute,
        context,
        views,
      ),
    );
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.active_employee_count"] },
      relative,
      context,
      views,
    );
    expect(plan.businessTime.coordinates).toEqual([
      {
        kind: "range",
        from: "2025-08",
        to: "2026-07",
        buckets: timeBuckets({ kind: "range", from: "2025-08", to: "2026-07" }, "month"),
      },
    ]);
  });

  test("相对窗口 last:{years} 历年口径与等价绝对 range 逐字节一致", () => {
    const relative = TIME_INPUT.parse({ cutoff: "2026-07", last: { years: 3 } });
    const absolute = TIME_INPUT.parse({
      range: { from: "2024-01", to: "2026-07" },
      grain: "year",
    });
    expect(
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        relative,
        context,
        views,
      ),
    ).toEqual(
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        absolute,
        context,
        views,
      ),
    );
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      relative,
      context,
      views,
    );
    expect(plan.businessTime.outputGrain).toBe("year");
    // 相对窗口 last:{years:3} 以锚点年 1 月起算，末年止于锚点月，产出部分年桶。
    expect(plan.businessTime.coordinates).toEqual([
      {
        kind: "range",
        from: "2024-01",
        to: "2026-07",
        buckets: [
          { from: "2024-01", to: "2024-12" },
          { from: "2025-01", to: "2025-12" },
          { from: "2026-01", to: "2026-07" },
        ],
      },
    ]);
  });

  test("省略锚点的 last 落到 actual_through 并随数据滚动", () => {
    const relative = TIME_INPUT.parse({ last: { months: 6 } });
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.active_employee_count"] },
      relative,
      context,
      views,
    );
    expect(plan.businessTime.outputGrain).toBe("month");
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2026-02-01", "2026-07-31"],
    });
    expect(plan.businessTime.coordinates).toEqual([
      {
        kind: "range",
        from: "2026-02",
        to: "2026-07",
        buckets: timeBuckets({ kind: "range", from: "2026-02", to: "2026-07" }, "month"),
      },
    ]);
  });

  test("同年截止月份自动按月区分，显式按年则 fail-closed", () => {
    const implicit = planTimeQuery(
      { measures: ["test_people_metrics.active_employee_count"] },
      { cutoff: "2026-06", compare: [{ cutoff: "2026-07" }] },
      context,
      views,
    );
    expect(implicit.businessTime.outputGrain).toBe("month");
    expect(implicit.query.timeDimensions?.[0]).toMatchObject({ granularity: "month" });
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        { cutoff: "2026-06", compare: [{ cutoff: "2026-07" }], grain: "year" },
        context,
        views,
      ),
    ).toThrow(/按年.*2026 年.*无法区分.*按月/);
  });

  test("跨年 range 对照按输出桶检查重叠，不以窗口终点代替唯一性", () => {
    const time: TimeInput = {
      range: { from: "2025-11", to: "2026-02" },
      compare: [{ range: { from: "2024-11", to: "2025-02" } }],
    };
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.new_hire_count"] },
      { ...time, grain: "month" },
      context,
      views,
    );
    expect(plan.businessTime.outputGrain).toBe("month");
    expect(plan.time.windows).toEqual([
      { from: "2025-11-01", to: "2026-02-28" },
      { from: "2024-11-01", to: "2025-02-28" },
    ]);
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.new_hire_count"] },
        { ...time, grain: "year" },
        context,
        views,
      ),
    ).toThrow(/按年.*2025 年.*无法区分.*按月/);
  });

  test("省略 cutoff 使用 actual_through，不误用未来计划月份", () => {
    const input = TIME_INPUT.parse({});
    const plan = planTimeQuery(
      { measures: ["headcount_plan.point_in_time_target_count"] },
      input,
      context,
      views,
    );
    expect(plan.query.timeDimensions?.[0].dateRange).toEqual(["2026-07-01", "2026-07-31"]);
    expect(plan.businessTime.coordinates).toEqual([atCutoff("2026-07")]);
  });

  test("显式 cutoff 可以查询已登记的未来计划月", () => {
    expect(() =>
      planTimeQuery(
        { measures: ["headcount_plan.point_in_time_target_count"] },
        { cutoff: "2026-12" },
        context,
        views,
      ),
    ).not.toThrow();
  });
});

describe("TimePlan fail-closed 与覆盖守卫", () => {
  test("时间输入只接受业务坐标", () => {
    expect(TIME_INPUT.safeParse({ mode: "as_of", at: "2026-07" }).success).toBe(false);
    expect(TIME_INPUT.safeParse({ cutoff: "最近月份" }).success).toBe(false);
  });

  test("截止月份与期间互斥，对照坐标必须同类", () => {
    expect(
      TIME_INPUT.safeParse({
        cutoff: "2026-07",
        range: { from: "2026-01", to: "2026-07" },
      }).success,
    ).toBe(false);
    expect(
      TIME_INPUT.safeParse({
        cutoff: "2026-07",
        compare: [{ range: { from: "2025-01", to: "2025-07" } }],
      }).success,
    ).toBe(false);
  });

  test("连续期间与相对窗口互斥，但锚点截止月可叠加相对窗口", () => {
    expect(
      TIME_INPUT.safeParse({
        range: { from: "2024-01", to: "2026-07" },
        last: { years: 3 },
      }).success,
    ).toBe(false);
    expect(TIME_INPUT.safeParse({ cutoff: "2026-06", last: { years: 3 } }).success).toBe(true);
    expect(TIME_INPUT.safeParse({ last: { months: 12 } }).success).toBe(true);
    expect(TIME_INPUT.safeParse({ last: { months: 6 }, compare: [{ years_ago: 1 }] }).success).toBe(
      true,
    );
  });

  test("公开查询不能直接引用物理时间字段", () => {
    expect(() =>
      planTimeQuery(
        {
          measures: ["test_people_metrics.active_employee_count"],
          filters: [
            {
              member: "test_people_metrics.year",
              operator: "equals",
              values: ["2026"],
            },
          ],
        },
        {},
        context,
        views,
      ),
    ).toThrow(/时间字段不能直接/);
  });

  test("PTD 跨年连续期间按月为单窗，按年展开为逐年终点桶", () => {
    const monthly = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      { range: { from: "2024-01", to: "2026-06" }, grain: "month" },
      context,
      views,
    );
    expect(monthly.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2024-01-01", "2026-06-30"],
    });
    expect(monthly.query.filters).toEqual([
      {
        member: "test_people_metrics.year",
        operator: "equals",
        values: ["2024", "2025", "2026"],
      },
    ]);

    const yearly = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      { range: { from: "2024-01", to: "2026-06" }, grain: "year" },
      context,
      views,
    );
    expect(yearly.businessTime.outputGrain).toBe("year");
    expect(yearly.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      compareDateRange: [
        ["2024-12-01", "2024-12-31"],
        ["2025-12-01", "2025-12-31"],
        ["2026-06-01", "2026-06-30"],
      ],
    });
    expect(yearly.query.filters).toEqual([
      {
        member: "test_people_metrics.year",
        operator: "equals",
        values: ["2024", "2025", "2026"],
      },
    ]);
  });

  test("快照跨年连续期间按年走同一逐年终点桶展开", () => {
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.active_employee_count"] },
      { range: { from: "2024-05", to: "2026-06" }, grain: "year" },
      context,
      views,
    );
    expect(plan.businessTime.outputGrain).toBe("year");
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      compareDateRange: [
        ["2024-12-01", "2024-12-31"],
        ["2025-12-01", "2025-12-31"],
        ["2026-06-01", "2026-06-30"],
      ],
    });
  });

  test("PTD 非 1 月起点的年内连续期间合法，逐桶自年初重算", () => {
    const plan = planTimeQuery(
      { measures: ["test_people_metrics.ytd_primary_event_rate"] },
      { range: { from: "2026-03", to: "2026-06" }, grain: "month" },
      context,
      views,
    );
    expect(plan.query.timeDimensions?.[0]).toMatchObject({
      granularity: "month",
      dateRange: ["2026-03-01", "2026-06-30"],
    });
  });

  test("PTD 跨年连续期间的合计无良定义，fail-closed 并给出改法", () => {
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        { range: { from: "2025-01", to: "2026-06" }, grain: "total" },
        context,
        views,
      ),
    ).toThrow(/跨多个日历年时无法合并为一个合计.*按年或按月/);
  });

  test("连续期间总计中的 flow 与终点类指标自动编译为不同物理查询腿", () => {
    const plan = planMetricQuery(
      {
        measures: [
          "test_people_metrics.active_employee_count",
          "test_people_metrics.new_hire_count",
        ],
      },
      { range: { from: "2026-01", to: "2026-06" }, grain: "total" },
      context,
      views,
    );
    expect(plan.legs.map((leg) => leg.plan.query.measures)).toEqual([
      ["test_people_metrics.active_employee_count"],
      ["test_people_metrics.new_hire_count"],
    ]);
    expect(plan.legs.map((leg) => leg.plan.time.windows)).toEqual([
      [{ from: "2026-06-01", to: "2026-06-30" }],
      [{ from: "2026-01-01", to: "2026-06-30" }],
    ]);
  });

  test("求值形态不同的指标直接同查即报错，形态相同则放行", () => {
    const mixed = [
      "test_people_metrics.active_employee_count",
      "test_people_metrics.new_hire_count",
    ];
    // 按年与合计：快照取桶终点、期间聚合整段，发射形态不同，拆腿前的安全网必须命中。
    expect(() =>
      planTimeQuery(
        { measures: mixed },
        { range: { from: "2024-01", to: "2026-06" }, grain: "year" },
        context,
        views,
      ),
    ).toThrow(/不能混用不同时间窗口/);
    expect(() =>
      planTimeQuery(
        { measures: mixed },
        { range: { from: "2026-01", to: "2026-06" }, grain: "total" },
        context,
        views,
      ),
    ).toThrow(/不能混用不同时间窗口/);
    // 按月与截止月份：桶即单月，两类求值发射同一形态，安全网不得误报。
    expect(() =>
      planTimeQuery(
        { measures: mixed },
        { range: { from: "2026-01", to: "2026-06" }, grain: "month" },
        context,
        views,
      ),
    ).not.toThrow();
    expect(() =>
      planTimeQuery({ measures: mixed }, { cutoff: "2026-06" }, context, views),
    ).not.toThrow();
  });

  test("坏范围、未来月份和无标识多窗全部拒绝", () => {
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.new_hire_count"] },
        { range: { from: "2026-06", to: "2026-05" } },
        context,
        views,
      ),
    ).toThrow(/开始月份不能晚于结束月份/);
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        { cutoff: "2026-08" },
        context,
        views,
      ),
    ).toThrow(/可查询至 2026-07/);
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        { cutoff: "2026-06", compare: [{ cutoff: "2025-06" }], grain: "total" },
        context,
        views,
      ),
    ).toThrow(/不能合并为无时间标识的总计/);
  });

  test("每类合法输入都有活路", () => {
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.active_employee_count"] },
        { cutoff: "2026-06" },
        context,
        views,
      ),
    ).not.toThrow();
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.new_hire_count"] },
        { range: { from: "2026-01", to: "2026-06" } },
        context,
        views,
      ),
    ).not.toThrow();
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        { cutoff: "2026-06" },
        context,
        views,
      ),
    ).not.toThrow();
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        { range: { from: "2024-01", to: "2026-06" }, grain: "month" },
        context,
        views,
      ),
    ).not.toThrow();
    expect(() =>
      planTimeQuery(
        { measures: ["test_people_metrics.ytd_primary_event_rate"] },
        { range: { from: "2024-03", to: "2026-06" }, grain: "year" },
        context,
        views,
      ),
    ).not.toThrow();
  });
});
