import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TIME_INTENT_INPUT,
  compileTimeIntent,
  resolveTimeSelection,
  timeSelectionIssueMessage,
  type TimeCapabilities,
  type TimeIntent,
  type TimeSelectionIssue,
} from "@time";
import { parseAnalysisSpec } from "../../../../src/semantic_core/analysis_spec";
import { DEFAULT_TIME_WINDOW } from "./analysis_draft";
import {
  adjustTimeWindow,
  ComparisonPopup,
  defaultCustomComparisonWindow,
  previousPeriodLabel,
  previousYearLabel,
  seriesGrainOf,
  setTimeComparison,
  summarizeResolvedTime,
  timeChangeIssue,
  TimeBar,
  WindowPopup,
  withCurrent,
  withSeriesGrain,
} from "./time_editor";

const MONTHLY: TimeCapabilities = { grain: "month" };
const YEAR_SCOPED: TimeCapabilities = { year_scoped: true };
const issueText = (issue: TimeSelectionIssue | undefined) =>
  issue ? timeSelectionIssueMessage(issue) : undefined;
const outputGrain = (time: TimeIntent) => {
  const result = resolveTimeSelection(compileTimeIntent(time), "2026-07");
  if (result.status === "invalid") throw new Error(timeSelectionIssueMessage(result.issue));
  return result.selection.outputGrain;
};

const renderBar = (time: TimeIntent, dataAsOf = "2026-07", capabilities: TimeCapabilities = {}) =>
  renderToStaticMarkup(
    <TimeBar capabilities={capabilities} dataAsOf={dataAsOf} onChange={() => {}} time={time} />,
  );

const segmentAttrs = (html: string, label: string) => {
  const match = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  if (!match) throw new Error(`找不到分段「${label}」`);
  return match[1] ?? "";
};

const segmentLabels = (html: string) =>
  [...html.matchAll(/<button[^>]*data-slot="toggle-group-item"[^>]*>([^<]*)<\/button>/g)].map(
    (match) => match[1] ?? "",
  );

test("单月窗口只显示观察时间和对比，没有粒度分段，解析为一个结果", () => {
  const out = renderBar({ window: { kind: "current_month" } });
  expect(out).toContain('aria-label="观察时间"');
  expect(out).toContain('aria-label="添加对比"');
  expect(out).not.toContain('aria-label="序列粒度"');
  expect(segmentLabels(out)).toEqual([]);
  expect(out).toContain("最新月份");
  expect(summarizeResolvedTime({ window: { kind: "current_month" } }, "2026-07")).toBe(
    "观察期 2026年7月 · 一个结果 · 随数据更新",
  );
});

test("期间窗口显示粒度分段，选中项是窗口的粒度", () => {
  const months = renderBar({ window: DEFAULT_TIME_WINDOW.trailing_months });
  expect(segmentLabels(months)).toEqual(["按月", "按年"]);
  expect(segmentAttrs(months, "按月")).toContain('aria-pressed="true"');
  const years = renderBar({ window: DEFAULT_TIME_WINDOW.trailing_years });
  expect(segmentAttrs(years, "按年")).toContain('aria-pressed="true"');
  const monthlyYears = renderBar({
    window: { kind: "trailing", count: 3, unit: "year", grain: "month" },
  });
  expect(segmentAttrs(monthlyYears, "按月")).toContain('aria-pressed="true"');
  expect(segmentAttrs(monthlyYears, "按年")).toContain('aria-pressed="false"');
});

test("解析摘要显示主期、粒度、对比期以及是否随数据更新", () => {
  const rolling: TimeIntent = {
    window: { kind: "trailing", count: 6, unit: "month", grain: "month" },
    comparison: { kind: "previous_period" },
  };
  expect(summarizeResolvedTime(rolling, "2026-07")).toBe(
    "观察期 2026年2月—2026年7月 · 每月一个结果 · 对比 2025年8月—2026年1月 · 随数据更新",
  );
  // 写成起止月的范围是固定时间，不随数据更新。
  const frozen: TimeIntent = {
    window: { kind: "range", from: "2024-01", to: "2026-06", grain: "year" },
  };
  expect(summarizeResolvedTime(frozen, "2026-07")).toBe(
    "观察期 2024年1月—2026年6月 · 每年一个结果 · 固定时间",
  );
});

test("期间窗口可以切换粒度，单月窗口不受影响", () => {
  const years: TimeIntent = { window: DEFAULT_TIME_WINDOW.trailing_years };
  expect(withSeriesGrain(years, "month").window).toEqual({
    kind: "trailing",
    count: 3,
    unit: "year",
    grain: "month",
  });
  const single: TimeIntent = { window: { kind: "current_month" } };
  expect(withSeriesGrain(single, "month")).toEqual(single);
  expect(seriesGrainOf(single.window)).toBeUndefined();
  expect(seriesGrainOf({ kind: "year_to_date", grain: "month" })).toBe("month");
});

test("切换主窗口时显式说明被调整的对比选择", () => {
  const yearToDate = adjustTimeWindow(
    {
      window: { kind: "trailing", count: 6, unit: "month", grain: "month" },
      comparison: { kind: "previous_period" },
    },
    { kind: "year_to_date", grain: "month" },
  );
  expect(yearToDate.time.comparison).toEqual({ kind: "previous_year" });
  expect(yearToDate.adjustment).toContain("已将对比改为“去年同期”");

  const custom = adjustTimeWindow(
    {
      window: { kind: "current_month" },
      comparison: {
        kind: "custom",
        window: { kind: "current_month", month: "2025-07" },
      },
    },
    { kind: "range", from: "2026-01", to: "2026-07", grain: "month" },
  );
  expect(custom.time.comparison).toBeUndefined();
  expect(custom.adjustment).toContain("已移除自定义对照");
});

test("修改对比时窗口和粒度保持不变", () => {
  const next = setTimeComparison(
    { window: { kind: "year_to_date", grain: "year" } },
    { kind: "previous_period" },
  );
  expect(next).toEqual({
    window: { kind: "year_to_date", grain: "year" },
    comparison: { kind: "previous_period" },
  });
  expect(setTimeComparison(next)).toEqual({ window: { kind: "year_to_date", grain: "year" } });
});

test("对比选项文案随主窗口类型变化", () => {
  expect(previousPeriodLabel({ kind: "current_month" })).toBe("上月");
  expect(previousYearLabel({ kind: "current_month" })).toBe("去年同月");
  expect(previousPeriodLabel({ kind: "trailing", count: 6, unit: "month", grain: "month" })).toBe(
    "上一期",
  );
  expect(previousYearLabel({ kind: "year_to_date", grain: "month" })).toBe("去年同期");

  const out = renderBar({
    window: { kind: "year_to_date", grain: "month" },
    comparison: { kind: "previous_year" },
  });
  expect(out).toContain("与去年同期比较");
});

test("自定义对照默认为主窗口整体回移一年", () => {
  const time: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" },
  };
  expect(defaultCustomComparisonWindow(time, "2026-07")).toEqual({
    kind: "range",
    from: "2025-01",
    to: "2025-07",
  });
});

test("期间浮层按月滚动和按日历年分节，每行显示实际起止月", () => {
  const picked: TimeIntent["window"][] = [];
  const out = renderToStaticMarkup(
    <WindowPopup
      latest="2026-07"
      onChange={(time) => {
        picked.push(time.window);
        return true;
      }}
      onPick={() => {}}
      time={{ window: { kind: "trailing", count: 2, unit: "year", grain: "year" } }}
    />,
  );
  const labels = [...out.matchAll(/data-slot="popup-title"[^>]*>([^<]*)</g)].map((m) => m[1]);
  expect(labels).toEqual(["按月滚动", "按日历年"]);
  const rows: Array<[string | undefined, string | undefined]> = [
    ...out.matchAll(
      /<span class="min-w-0 truncate[^"]*">([^<]*)<\/span>(?:<span[^>]*data-slot="popover-list-detail">([^<]*)<\/span>)?/g,
    ),
  ].map((m) => [m[1], m[2]]);
  // 最近 24 个月与最近 2 年（日历年）是不同的时间段。
  expect(rows).toContainEqual(["最近 24 个月", "2024-08 – 2026-07"]);
  expect(rows).toContainEqual(["最近 2 年", "2025-01 – 2026-07"]);
  expect(rows).toContainEqual(["今年至今", "2026-01 – 2026-07"]);
  expect(rows).toContainEqual(["单个月份", undefined]);
  expect(rows.map((r) => r[0]).filter((l) => l?.startsWith("最近"))).toEqual([
    "最近 12 个月",
    "最近 24 个月",
    "最近 2 年",
    "最近 3 年",
    "最近 5 年",
  ]);
  expect(picked).toEqual([]);
});

test("按月定义的指标选按年回看时使用按月粒度，这些选项保持可用", () => {
  const out = renderToStaticMarkup(
    <WindowPopup
      capabilities={MONTHLY}
      latest="2026-07"
      onChange={() => true}
      onPick={() => {}}
      time={{ window: { kind: "current_month" } }}
    />,
  );
  const row = (label: string) => {
    const at = out.indexOf(label);
    if (at < 0) throw new Error(`缺少期间候选：${label}`);
    return out.slice(out.lastIndexOf("<button", at), at);
  };
  expect(row("最近 3 年（按月）")).not.toContain('aria-disabled="true"');
  expect(row("最近 24 个月")).not.toContain('aria-disabled="true"');
  expect(out).not.toContain("不能合并多个月份");
});

test("对照期在某一粒度下与主期结果桶重叠时，该粒度禁用，原因与提交校验一致", () => {
  const out = renderBar(
    {
      window: { kind: "trailing", count: 6, unit: "month", grain: "month" },
      comparison: { kind: "previous_period" },
    },
    "2026-08",
  );
  expect(segmentAttrs(out, "按年")).toContain('aria-disabled="true"');
  expect(segmentAttrs(out, "按月")).toContain('aria-disabled="false"');
  // 禁用原因与 timeChangeIssue 的校验结果一致。
  expect(
    issueText(
      timeChangeIssue(
        {
          window: { kind: "trailing", count: 6, unit: "month", grain: "year" },
          comparison: { kind: "previous_period" },
        },
        "2026-08",
      ),
    ),
  ).toContain("都会产生 2026 年");
});

test("对比浮层中会产生结果桶重叠的选项禁用，其余可用", () => {
  const html = (time: TimeIntent) =>
    renderToStaticMarkup(
      <ComparisonPopup
        capabilities={{}}
        latest="2026-08"
        onChange={() => true}
        onPick={() => {}}
        time={time}
      />,
    );
  const rowAttrs = (out: string, label: string) => {
    const match = out.match(new RegExp(`<button([^>]*)><span[^>]*>${label}</span>`));
    if (!match) throw new Error(`找不到行「${label}」`);
    return match[1] ?? "";
  };
  const years = html({ window: { kind: "trailing", count: 5, unit: "year", grain: "year" } });
  expect(rowAttrs(years, "去年同期")).toContain('aria-disabled="true"');
  expect(rowAttrs(years, "上一期")).not.toContain("aria-disabled");
  const ytd = html({ window: { kind: "year_to_date", grain: "month" } });
  expect(rowAttrs(ytd, "去年同期")).not.toContain("aria-disabled");
});

test("只允许显式对照的指标在点击前禁用日历平移，保留自定义期间", () => {
  const out = renderToStaticMarkup(
    <ComparisonPopup
      capabilities={{ comparison: "explicit_only" }}
      latest="2026-08"
      onChange={() => true}
      onPick={() => {}}
      time={{ window: { kind: "current_month" } }}
    />,
  );
  const rowAttrs = (label: string) => {
    const match = out.match(new RegExp(`<button([^>]*)><span[^>]*>${label}</span>`));
    if (!match) throw new Error(`找不到行「${label}」`);
    return match[1] ?? "";
  };
  expect(rowAttrs("上月")).toContain('aria-disabled="true"');
  expect(rowAttrs("去年同月")).toContain('aria-disabled="true"');
  expect(rowAttrs("自定义对照")).not.toContain("aria-disabled");
  expect(
    issueText(
      timeChangeIssue(
        {
          window: { kind: "current_month" },
          comparison: { kind: "previous_year" },
        },
        "2026-08",
        { comparison: "explicit_only" },
      ),
    ),
  ).toContain("只允许显式对照期间");
});

test("单月窗口对比上月或去年同月时不需要粒度，校验通过", () => {
  for (const kind of ["previous_period", "previous_year"] as const) {
    const time: TimeIntent = { window: { kind: "current_month" }, comparison: { kind } };
    expect(segmentLabels(renderBar(time))).toEqual([]);
    expect(timeChangeIssue(time, "2026-07")).toBeUndefined();
  }
});

test("按月定义的指标跨多个月时只有按月可用", () => {
  const out = renderBar(
    { window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" } },
    "2026-07",
    MONTHLY,
  );
  expect(segmentAttrs(out, "按年")).toContain('aria-disabled="true"');
  expect(segmentAttrs(out, "按月")).toContain('aria-disabled="false"');
  expect(
    segmentAttrs(
      renderBar({ window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" } }),
      "按年",
    ),
  ).toContain('aria-disabled="false"');
});

test("年初归零的指标跨日历年时两档全部可用", () => {
  const crossYear = renderBar(
    { window: { kind: "range", from: "2024-01", to: "2026-07", grain: "year" } },
    "2026-07",
    YEAR_SCOPED,
  );
  for (const label of ["按月", "按年"]) {
    expect(segmentAttrs(crossYear, label)).toContain('aria-disabled="false"');
  }
});

test("指标不支持的粒度在写入草稿前被拒绝，原因与服务端一致", () => {
  const crossMonthYear: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-08", grain: "year" },
  };
  expect(timeChangeIssue(crossMonthYear, "2026-08", MONTHLY)).toMatchObject({
    code: "metric_time_grain_incompatible",
    required_grain: "month",
    selected_grain: "year",
  });
  expect(
    timeChangeIssue(withSeriesGrain(crossMonthYear, "month"), "2026-08", MONTHLY),
  ).toBeUndefined();
  expect(timeChangeIssue(crossMonthYear, "2026-08")).toBeUndefined();
});

test("数据截至月不可用时拒绝编辑，不以浏览器本地月份猜测", () => {
  const out = renderBar({ window: { kind: "current_month" } }, "未知");
  expect(out).toContain("数据最新月份暂不可用");
  expect(out).not.toContain('aria-label="观察时间"');
});

test("会产生重叠结果桶的对比在写入草稿前被拦截", () => {
  const issue = timeChangeIssue(
    {
      window: { kind: "trailing", count: 5, unit: "year", grain: "year" },
      comparison: { kind: "previous_year" },
    },
    "2026-07",
  );
  expect(issue).toEqual({
    code: "time_output_bucket_overlap",
    selected_grain: "year",
    bucket: "2022",
  });
  expect(issueText(issue)).toContain("请选择互不重叠的主时间或对照时间");
  expect(issueText(issue)).not.toContain("改为按月");
});

test("三种默认窗口产生的时间都能组成合法的 AnalysisSpec", () => {
  for (const window of Object.values(DEFAULT_TIME_WINDOW)) {
    expect(() =>
      parseAnalysisSpec({
        views: [
          {
            id: "result",
            measures: ["test_people_metrics.active_employee_count"],
            time: compileTimeIntent({ window }),
          },
        ],
      }),
    ).not.toThrow();
  }
});

test("三种默认窗口都通过契约校验，结果粒度与窗口粒度一致", () => {
  const current = { window: DEFAULT_TIME_WINDOW.current_month };
  const monthly = { window: DEFAULT_TIME_WINDOW.trailing_months };
  const yearly = { window: DEFAULT_TIME_WINDOW.trailing_years };
  for (const time of [current, monthly, yearly])
    expect(() => TIME_INTENT_INPUT.parse(time)).not.toThrow();
  expect(outputGrain(current)).toBe("total");
  expect(outputGrain(monthly)).toBe("month");
  expect(outputGrain(yearly)).toBe("year");
});

test("不在预设列表中的近 N 值会加到列表开头，已在列表中的不重复", () => {
  expect(withCurrent([6, 12, 24, 36], 9)).toEqual([9, 6, 12, 24, 36]);
  expect(withCurrent([2, 3, 4, 5, 6], 7)).toEqual([7, 2, 3, 4, 5, 6]);
  expect(withCurrent([6, 12, 24, 36], 12)).toEqual([6, 12, 24, 36]);
});

test("默认窗口不指定锚点月份，随数据更新", () => {
  expect(DEFAULT_TIME_WINDOW.trailing_months).toEqual({
    kind: "trailing",
    count: 12,
    unit: "month",
    grain: "month",
  });
  expect(DEFAULT_TIME_WINDOW.trailing_years).toEqual({
    kind: "trailing",
    count: 3,
    unit: "year",
    grain: "year",
  });
  expect(DEFAULT_TIME_WINDOW.current_month).toEqual({ kind: "current_month" });
  // 去年同期整体比主窗口早一年，随数据更新。
  const aligned = {
    window: { kind: "year_to_date" as const, grain: "year" as const },
    comparison: { kind: "previous_year" as const },
  };
  expect(() => TIME_INTENT_INPUT.parse(aligned)).not.toThrow();
  expect(outputGrain(aligned)).toBe("year");
});
