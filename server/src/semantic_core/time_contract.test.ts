import { describe, expect, test } from "bun:test";
import {
  TIME_INTENT_INPUT,
  compileTimeIntent,
  expandTimeCompare,
  expandTimeWindow,
  metricTimeCapabilities,
  metricTimeSelectionIssue,
  resolveTimeSelection,
  timeAvailabilityIssue,
  timeSelectionIssueMessage,
  totalPeriodOf,
  type TimeInput,
} from "./time_contract.js";
import type { MetricTimeResolution } from "./metric_time_contract.js";

function resolved(time: TimeInput, latest = "2026-07") {
  const result = resolveTimeSelection(time, latest);
  if (result.status === "invalid") throw new Error(timeSelectionIssueMessage(result.issue));
  return result.selection;
}

describe("business time intent", () => {
  test("同一 YTD 窗口可选择年度或月度序列", () => {
    const yearly = compileTimeIntent({ window: { kind: "year_to_date", grain: "year" } });
    const monthly = compileTimeIntent({ window: { kind: "year_to_date", grain: "month" } });
    // 相对窗口不带端点：锚点由数据 actual_through 在展开时给出。
    expect(yearly).toEqual({ last: { years: 1 }, grain: "year" });
    expect(monthly).toEqual({ last: { years: 1 }, grain: "month" });
    expect(expandTimeWindow(monthly, "2026-07")).toEqual({
      range: { from: "2026-01", to: "2026-07" },
      grain: "month",
    });
  });

  test("冻结的年初至今用绝对起止表达，与滚动窗口同解", () => {
    const frozen = compileTimeIntent({
      window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" },
    });
    expect(expandTimeWindow(frozen, "2026-09")).toEqual({
      range: { from: "2026-01", to: "2026-07" },
      grain: "month",
    });
    // 滚动窗口随数据推进改变解，绝对窗口不改变——这正是两种表达式的分工。
    const rolling = expandTimeWindow(
      compileTimeIntent({ window: { kind: "year_to_date", grain: "month" } }),
      "2026-09",
    );
    expect("range" in rolling ? rolling.range : undefined).toEqual({
      from: "2026-01",
      to: "2026-09",
    });
  });

  test("单月窗口是一个时点，期间窗口的粒度就是窗口自带的那一档，服务端不推导", () => {
    expect(resolved(compileTimeIntent({ window: { kind: "current_month" } })).outputGrain).toBe(
      "total",
    );
    expect(
      resolved(
        compileTimeIntent({
          window: { kind: "range", from: "2024-01", to: "2026-07", grain: "year" },
        }),
      ).outputGrain,
    ).toBe("year");
    expect(
      resolved(
        compileTimeIntent({ window: { kind: "trailing", count: 3, unit: "year", grain: "month" } }),
      ).outputGrain,
    ).toBe("month");
    for (const window of [
      { kind: "year_to_date" },
      { kind: "trailing", count: 3, unit: "year" },
      { kind: "range", from: "2026-01", to: "2026-07" },
    ]) {
      expect(TIME_INTENT_INPUT.safeParse({ window }).success).toBe(false);
    }
    expect(
      TIME_INTENT_INPUT.safeParse({ window: { kind: "current_month", grain: "month" } }).success,
    ).toBe(false);
  });

  test("去年同期只产生一个同口径上一年窗口", () => {
    const base = { window: { kind: "year_to_date" as const, grain: "year" as const } };
    const previousYear = expandTimeCompare(
      expandTimeWindow(
        compileTimeIntent({
          ...base,
          comparison: { kind: "previous_year" },
        }),
        "2026-07",
      ),
      "2026-07",
    );
    expect(previousYear.compare).toEqual([{ range: { from: "2025-01", to: "2025-07" } }]);
    expect(
      TIME_INTENT_INPUT.safeParse({
        ...base,
        comparison: { kind: "previous_years", years_ago: [1], alignment: "same_period" },
      }).success,
    ).toBe(false);
  });

  test("上一相邻周期与主期等长且不重叠", () => {
    const resolved = expandTimeCompare(
      expandTimeWindow(
        compileTimeIntent({
          window: { kind: "trailing", count: 3, unit: "month", grain: "month" },
          comparison: { kind: "previous_period" },
        }),
        "2026-07",
      ),
      "2026-07",
    );
    expect("range" in resolved ? resolved.range : undefined).toEqual({
      from: "2026-05",
      to: "2026-07",
    });
    expect(resolved.compare).toEqual([{ range: { from: "2026-02", to: "2026-04" } }]);
  });

  test("粒度只有序列两档，YTD 只使用去年同期或明确对照", () => {
    // 整段合计不在这条轴上：不可表达的组合不需要事前拒绝。
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "year_to_date", grain: "total" },
      }).success,
    ).toBe(false);
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "current_month" },
        comparison: { kind: "previous_year" },
      }).success,
    ).toBe(true);
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "year_to_date", grain: "month" },
        comparison: { kind: "previous_period" },
      }).success,
    ).toBe(false);
  });

  test("任何窗口都不接受截止字段：冻结只能由绝对表达式承载", () => {
    const accepts = (window: unknown) => TIME_INTENT_INPUT.safeParse({ window }).success;
    const grain = "month";
    expect(
      accepts({ kind: "range", from: "2026-01", to: "2026-07", grain, through: "2026-06" }),
    ).toBe(false);
    expect(accepts({ kind: "year_to_date", grain, through: "2026-06" })).toBe(false);
    expect(accepts({ kind: "trailing", count: 12, unit: "month", grain, through: "2026-06" })).toBe(
      false,
    );
    expect(accepts({ kind: "year_to_date", grain })).toBe(true);
    expect(accepts({ kind: "trailing", count: 12, unit: "month", grain })).toBe(true);
    expect(accepts({ kind: "current_month", month: "2026-06" })).toBe(true);
  });

  test("自定义对照必须与主窗口保持单月或期间同类", () => {
    const result = TIME_INTENT_INPUT.safeParse({
      window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" },
      comparison: {
        kind: "custom",
        window: { kind: "current_month", month: "2025-07" },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(1);
  });

  test("自定义对照只接受一个明确窗口", () => {
    const result = TIME_INTENT_INPUT.safeParse({
      window: { kind: "current_month" },
      comparison: {
        kind: "custom",
        windows: [
          { kind: "current_month", month: "2025-07" },
          { kind: "current_month", month: "2025-07" },
        ],
      },
    });
    expect(result.success).toBe(false);
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "current_month" },
        comparison: {
          kind: "custom",
          window: { kind: "current_month", month: "2025-07" },
        },
      }).success,
    ).toBe(true);
  });

  test("重叠冲突只在按月确实可解时建议改为按月", () => {
    expect(
      resolveTimeSelection(
        {
          cutoff: "2026-07",
          grain: "year",
          compare: [{ cutoff: "2026-06" }],
        },
        "2026-07",
      ),
    ).toEqual({
      status: "invalid",
      issue: {
        code: "time_output_bucket_overlap",
        selected_grain: "year",
        bucket: "2026",
        alternative_grain: "month",
      },
    });

    const overlappingRanges = resolveTimeSelection(
      {
        range: { from: "2024-01", to: "2026-07" },
        grain: "year",
        compare: [{ range: { from: "2023-01", to: "2025-07" } }],
      },
      "2026-07",
    );
    expect(overlappingRanges).toEqual({
      status: "invalid",
      issue: {
        code: "time_output_bucket_overlap",
        selected_grain: "year",
        bucket: "2024",
      },
    });
    if (overlappingRanges.status === "invalid") {
      expect(timeSelectionIssueMessage(overlappingRanges.issue)).not.toContain("按月呈现");
    }
  });

  test("时间自身冲突全部返回结构化 issue", () => {
    expect(
      resolveTimeSelection(
        {
          cutoff: "2026-07",
          grain: "total",
          compare: [{ cutoff: "2025-07" }],
        },
        "2026-07",
      ),
    ).toMatchObject({
      status: "invalid",
      issue: { code: "time_comparison_requires_series" },
    });
    expect(
      resolveTimeSelection(
        {
          cutoff: "2026-07",
          compare: [{ cutoff: "2026-07" }],
        },
        "2026-07",
      ),
    ).toEqual({
      status: "invalid",
      issue: { code: "time_coordinates_duplicate", coordinate: "2026-07" },
    });
    expect(
      resolveTimeSelection(
        {
          range: { from: "2026-07", to: "2026-01" },
          grain: "month",
        },
        "2026-07",
      ),
    ).toEqual({
      status: "invalid",
      issue: { code: "time_range_invalid", from: "2026-07", to: "2026-01" },
    });
    expect(resolveTimeSelection({}, "未知")).toEqual({
      status: "invalid",
      issue: { code: "time_anchor_unavailable" },
    });
    const future = resolveTimeSelection({ cutoff: "2026-08" }, "2026-07");
    if (future.status === "invalid") throw new Error(timeSelectionIssueMessage(future.issue));
    expect(timeAvailabilityIssue(future.selection, "2026-07")).toEqual({
      code: "time_range_unavailable",
      requested: "2026-08",
      available_through: "2026-07",
    });
  });
});

describe("整窗合计的求值期间", () => {
  const window = { from: "2025-06", to: "2026-07" };

  const flow: MetricTimeResolution = {
    contract: { aggregation: "sum", window: "selected" },
    basis: "whole_bucket",
  };
  const snapshot: MetricTimeResolution = {
    contract: { aggregation: "last", window: "selected" },
    basis: "bucket_end",
  };
  const ytd: MetricTimeResolution = {
    contract: { aggregation: "recompute", window: "year_to_date" },
    basis: "year_start_to_bucket_end",
  };
  const monthly: MetricTimeResolution = {
    contract: { aggregation: "recompute", window: "selected", grain: "month" },
    basis: "whole_bucket",
  };

  test("期间指标覆盖整个坐标，时点指标只覆盖终点当月", () => {
    expect(totalPeriodOf(flow, window)).toEqual(window);
    // 快照指标的合计是终点当月的时点值，不是四年的什么东西。
    expect(totalPeriodOf(snapshot, window)).toEqual({ from: "2026-07", to: "2026-07" });
  });

  test("年初累计指标恒从终点所在年的一月起算，与坐标起点无关", () => {
    expect(totalPeriodOf(ytd, window)).toEqual({ from: "2026-01", to: "2026-07" });
    // 同一日历年内也一样：值按年初归零，不因为坐标从三月起就少算两个月。
    expect(totalPeriodOf(ytd, { from: "2026-03", to: "2026-07" })).toEqual({
      from: "2026-01",
      to: "2026-07",
    });
  });

  test("按月定义的指标跨月即降级到终点当月，并显式标记；单月窗口不降级", () => {
    expect(totalPeriodOf(monthly, window)).toEqual({
      from: "2026-07",
      to: "2026-07",
      degraded: true,
    });
    const single = { from: "2026-07", to: "2026-07" };
    expect(totalPeriodOf(monthly, single)).toEqual(single);
  });

  test("能力卡由指标合同推导，与目录装配同出一源", () => {
    expect(metricTimeCapabilities({ aggregation: "sum", window: "selected" })).toEqual({});
    expect(metricTimeCapabilities({ aggregation: "recompute", window: "year_to_date" })).toEqual({
      year_scoped: true,
    });
    expect(
      metricTimeCapabilities({ aggregation: "recompute", window: "selected", grain: "month" }),
    ).toEqual({ grain: "month" });
  });

  test("年初归零指标的跨年总计是结构化冲突，序列粒度不受影响", () => {
    const selection = resolved({
      range: { from: "2025-01", to: "2026-07" },
      grain: "total",
    });
    const requirement = [{ capabilities: { year_scoped: true } as const, title: "YTD事件率" }];
    expect(metricTimeSelectionIssue(requirement, selection)).toEqual({
      code: "metric_time_calendar_year_total_incompatible",
      metric_titles: ["YTD事件率"],
      from: "2025-01",
      to: "2026-07",
      selected_grain: "total",
    });
    expect(
      metricTimeSelectionIssue(requirement, {
        ...selection,
        outputGrain: "year",
      }),
    ).toBeUndefined();
  });
});

describe("时间键", () => {
  const range = {
    window: { kind: "range" as const, from: "2024-01", to: "2026-07", grain: "year" as const },
  };

  test("单月带对照时按坐标给键：同年撞桶按月，跨年按年；省略主截止月恒按月", () => {
    expect(
      resolved(
        compileTimeIntent({
          window: { kind: "current_month", month: "2026-07" },
          comparison: { kind: "previous_period" },
        }),
      ).outputGrain,
    ).toBe("month");
    expect(
      resolved(
        compileTimeIntent({
          window: { kind: "current_month", month: "2026-07" },
          comparison: { kind: "previous_year" },
        }),
      ).outputGrain,
    ).toBe("year");
    expect(
      resolved(
        compileTimeIntent({
          window: { kind: "current_month" },
          comparison: { kind: "previous_year" },
        }),
      ).outputGrain,
    ).toBe("month");
  });

  test("期间带对照时沿用窗口粒度，合计腿不得带对照", () => {
    const compared = compileTimeIntent({
      ...range,
      comparison: { kind: "custom", window: { kind: "range", from: "2021-01", to: "2023-07" } },
    });
    expect(resolved(compared).outputGrain).toBe("year");
    expect(resolveTimeSelection({ ...compared, grain: "total" }, "2026-07")).toMatchObject({
      status: "invalid",
      issue: { code: "time_comparison_requires_series" },
    });
  });
});
