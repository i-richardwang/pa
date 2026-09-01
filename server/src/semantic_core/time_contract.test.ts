import { describe, expect, test } from "bun:test";
import {
  TIME_INTENT_INPUT,
  compileTimeIntent,
  expandTimeCompare,
  expandTimeWindow,
  metricTimeCapabilities,
  resolvedTimeDisplay,
  resolveTimeOutputGrain,
  totalPeriodOf,
} from "./time_contract.js";

describe("business time intent", () => {
  test("同一 YTD 窗口可明确选择年度或月度序列", () => {
    const yearly = compileTimeIntent({ window: { kind: "year_to_date" }, display: "year" });
    const monthly = compileTimeIntent({ window: { kind: "year_to_date" }, display: "month" });
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
      window: { kind: "range", from: "2026-01", to: "2026-07" },
      display: "month",
    });
    expect(expandTimeWindow(frozen, "2026-09")).toEqual({
      range: { from: "2026-01", to: "2026-07" },
      grain: "month",
    });
    // 滚动窗口随数据推进改变解，绝对窗口不改变——这正是两种表达式的分工。
    expect(
      expandTimeWindow(compileTimeIntent({ window: { kind: "year_to_date" } }), "2026-09").range,
    ).toEqual({ from: "2026-01", to: "2026-09" });
  });

  test("省略 display 时按窗口选择稳定默认值", () => {
    // 单月窗口即整段单桶；一段连续期间给走势，它的整段合计由合计位承担。
    expect(
      resolveTimeOutputGrain(compileTimeIntent({ window: { kind: "current_month" } }), "2026-07"),
    ).toBe("total");
    expect(
      resolveTimeOutputGrain(
        compileTimeIntent({ window: { kind: "range", from: "2026-01", to: "2026-07" } }),
        "2026-07",
      ),
    ).toBe("month");
    expect(
      resolveTimeOutputGrain(compileTimeIntent({ window: { kind: "year_to_date" } }), "2026-07"),
    ).toBe("month");
    expect(
      resolveTimeOutputGrain(
        compileTimeIntent({
          window: { kind: "trailing", count: 12, unit: "month" },
        }),
        "2026-07",
      ),
    ).toBe("month");
    expect(
      resolveTimeOutputGrain(
        compileTimeIntent({ window: { kind: "trailing", count: 3, unit: "year" } }),
        "2026-07",
      ),
    ).toBe("year");
  });

  test("去年同期只产生一个同口径上一年窗口", () => {
    const base = {
      window: { kind: "year_to_date" as const },
      display: "year" as const,
    };
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
          window: { kind: "trailing", count: 3, unit: "month" },
          display: "month",
          comparison: { kind: "previous_period" },
        }),
        "2026-07",
      ),
      "2026-07",
    );
    expect(resolved.range).toEqual({ from: "2026-05", to: "2026-07" });
    expect(resolved.compare).toEqual([{ range: { from: "2026-02", to: "2026-04" } }]);
  });

  test("显示方式只有序列粒度，YTD 只使用去年同期或明确对照", () => {
    // 整段合计不在这条轴上：不可表达的组合不需要事前拒绝。
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "year_to_date" },
        display: "total",
      }).success,
    ).toBe(false);
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "current_month" },
        display: "year",
        comparison: { kind: "previous_year" },
      }).success,
    ).toBe(true);
    expect(
      TIME_INTENT_INPUT.safeParse({
        window: { kind: "year_to_date" },
        comparison: { kind: "previous_period" },
      }).success,
    ).toBe(false);
  });

  test("任何窗口都不接受截止字段：冻结只能由绝对表达式承载", () => {
    const rejects = (window: unknown) =>
      TIME_INTENT_INPUT.safeParse({ window, display: "month" }).success;
    expect(rejects({ kind: "range", from: "2026-01", to: "2026-07", through: "2026-06" })).toBe(
      false,
    );
    expect(rejects({ kind: "year_to_date", through: "2026-06" })).toBe(false);
    expect(rejects({ kind: "trailing", count: 12, unit: "month", through: "2026-06" })).toBe(false);
    expect(rejects({ kind: "year_to_date" })).toBe(true);
    expect(rejects({ kind: "trailing", count: 12, unit: "month" })).toBe(true);
    expect(rejects({ kind: "current_month", month: "2026-06" })).toBe(true);
  });

  test("自定义对照必须与主窗口保持单月或期间同类", () => {
    const result = TIME_INTENT_INPUT.safeParse({
      window: { kind: "range", from: "2026-01", to: "2026-07" },
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
    expect(() =>
      resolveTimeOutputGrain({
        cutoff: "2026-07",
        grain: "year",
        compare: [{ cutoff: "2026-06" }],
      }),
    ).toThrow("请改为按月呈现");

    const overlappingRanges = () =>
      resolveTimeOutputGrain({
        range: { from: "2024-01", to: "2026-07" },
        grain: "year",
        compare: [{ range: { from: "2023-01", to: "2025-07" } }],
      });
    expect(overlappingRanges).toThrow("请选择互不重叠的主时间或对照时间");
    try {
      overlappingRanges();
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain("按月呈现");
    }
  });
});

describe("整窗合计的求值期间", () => {
  const window = { from: "2025-06", to: "2026-07" };

  test("能整窗合并的指标覆盖整个坐标期间", () => {
    expect(totalPeriodOf({}, window)).toEqual({ ...window, coverage: "window" });
    expect(totalPeriodOf({}, { from: "2026-07", to: "2026-07" })).toEqual({
      from: "2026-07",
      to: "2026-07",
      coverage: "window",
    });
  });

  test("按月定义的指标跨月即退到终点当月，单月窗口仍是整窗", () => {
    const monthly = { multi_month_display: "month" } as const;
    expect(totalPeriodOf(monthly, window)).toEqual({
      from: "2026-07",
      to: "2026-07",
      coverage: "endpoint",
    });
    expect(totalPeriodOf(monthly, { from: "2026-07", to: "2026-07" })).toEqual({
      from: "2026-07",
      to: "2026-07",
      coverage: "window",
    });
  });

  test("年初归零的指标跨日历年即退到终点所在年的年初至今，同年内仍是整窗", () => {
    const scoped = { year_scoped: true } as const;
    expect(totalPeriodOf(scoped, window)).toEqual({
      from: "2026-01",
      to: "2026-07",
      coverage: "endpoint",
    });
    expect(totalPeriodOf(scoped, { from: "2026-03", to: "2026-07" })).toEqual({
      from: "2026-03",
      to: "2026-07",
      coverage: "window",
    });
  });

  test("能力卡由指标合同推导，与目录装配同出一源", () => {
    expect(metricTimeCapabilities({ aggregation: "sum", window: "selected" })).toEqual({});
    expect(metricTimeCapabilities({ aggregation: "recompute", window: "year_to_date" })).toEqual({
      year_scoped: true,
    });
    expect(
      metricTimeCapabilities({ aggregation: "recompute", window: "selected", grain: "month" }),
    ).toEqual({ multi_month_display: "month" });
  });
});

describe("时间该不该占轴", () => {
  const range = { window: { kind: "range" as const, from: "2024-01", to: "2026-07" } };

  test("带业务分组的结果时间不占轴，没有分组时连续期间给走势", () => {
    const time = compileTimeIntent(range);
    expect(resolveTimeOutputGrain(time, "2026-07", { defaultOutput: "total" })).toBe("total");
    expect(resolveTimeOutputGrain(time, "2026-07")).toBe("month");
    // 相对窗口的单位默认同样只对无分组成立。
    const trailing = compileTimeIntent({ window: { kind: "trailing", count: 3, unit: "year" } });
    expect(resolveTimeOutputGrain(trailing, "2026-07", { defaultOutput: "total" })).toBe("total");
    expect(resolveTimeOutputGrain(trailing, "2026-07")).toBe("year");
  });

  test("要在分组之上再看时间，显式声明即可", () => {
    expect(
      resolveTimeOutputGrain(compileTimeIntent({ ...range, display: "month" }), "2026-07", {
        defaultOutput: "total",
      }),
    ).toBe("month");
  });

  test("带对照时仍保留可区分的时间键，分组不改变这一点", () => {
    const compared = compileTimeIntent({
      ...range,
      comparison: { kind: "custom", window: { kind: "range", from: "2021-01", to: "2023-07" } },
    });
    expect(resolveTimeOutputGrain(compared, "2026-07", { defaultOutput: "total" })).not.toBe(
      "total",
    );
  });

  test("年初归零的指标跨日历年不成整段单桶，自动档降为按年", () => {
    const scoped = { year_scoped: true } as const;
    expect(resolvedTimeDisplay(range, "2026-07", scoped, true)).toBe("year");
    expect(
      resolvedTimeDisplay(
        { window: { kind: "range", from: "2026-01", to: "2026-07" } },
        "2026-07",
        scoped,
        true,
      ),
    ).toBe("total");
    expect(resolvedTimeDisplay(range, "2026-07", {}, true)).toBe("total");
  });
});
