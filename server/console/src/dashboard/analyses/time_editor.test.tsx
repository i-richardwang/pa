import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TIME_INTENT_INPUT,
  compileTimeIntent,
  resolvedTimeDisplay,
  resolveTimeOutputGrain,
  type TimeCapabilities,
  type TimeIntent,
} from "@time";
import { parseAnalysisSpec } from "../../../../src/semantic_core/analysis_spec";
import { DEFAULT_TIME_WINDOW } from "./analysis_draft";
import {
  adjustTimeWindow,
  ComparisonPopup,
  defaultCustomComparisonWindow,
  previousPeriodLabel,
  previousYearLabel,
  setTimeComparison,
  summarizeResolvedTime,
  timeChangeIssue,
  TimeBar,
  toggleDisplayChoice,
  WindowPopup,
  withCurrent,
} from "./time_editor";

const MONTHLY: TimeCapabilities = { multi_month_display: "month" };
const YEAR_SCOPED: TimeCapabilities = { year_scoped: true };

const renderBar = (time: TimeIntent, dataAsOf = "2026-07", capabilities: TimeCapabilities = {}) =>
  renderToStaticMarkup(
    <TimeBar capabilities={capabilities} dataAsOf={dataAsOf} onChange={() => {}} time={time} />,
  );

/** 粒度分段钮的属性串：按可见文本定位，禁用与否只看 aria-disabled 的真值。 */
const segmentAttrs = (html: string, label: string) => {
  const match = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  if (!match) throw new Error(`找不到分段「${label}」`);
  return match[1] ?? "";
};

/** 分段钮的可见文本，按渲染顺序：`toggle-group-item` 是分段的唯一槽位，故此列表即全集。 */
const segmentLabels = (html: string) =>
  [...html.matchAll(/<button[^>]*data-slot="toggle-group-item"[^>]*>([^<]*)<\/button>/g)].map(
    (match) => match[1] ?? "",
  );

test("时间栏三件齐备：观察时间、显示方式、对比，单月窗口解析为一个结果", () => {
  const out = renderBar({ window: { kind: "current_month" } });
  expect(out).toContain('aria-label="观察时间"');
  expect(out).toContain('aria-label="显示方式"');
  expect(out).toContain('aria-label="添加对比"');
  expect(out).toContain("最新月份");
  expect(summarizeResolvedTime({ window: { kind: "current_month" } }, "2026-07")).toBe(
    "主期 2026年7月 · 一个结果 · 随数据更新",
  );
});

test("解析摘要忠实回显主期、对比期与是否随数据滚动", () => {
  const rolling: TimeIntent = {
    window: { kind: "trailing", count: 6, unit: "month" },
    display: "month",
    comparison: { kind: "previous_period" },
  };
  expect(summarizeResolvedTime(rolling, "2026-07")).toBe(
    "主期 2026年2月—2026年7月 · 每月一个结果 · 对比 2025年8月—2026年1月 · 随数据更新",
  );
  // 冻结只由绝对表达式承载：同一段时间写成起止月即与数据推进脱钩。
  const frozen: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-06" },
    display: "month",
  };
  expect(summarizeResolvedTime(frozen, "2026-07")).toBe(
    "主期 2026年1月—2026年6月 · 每月一个结果 · 固定时间",
  );
});

test("按月定义的指标在跨月自动模式下由服务端约束解析为按月", () => {
  const time: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-07" },
  };
  expect(resolvedTimeDisplay(time, "2026-07", MONTHLY)).toBe("month");
  expect(segmentAttrs(renderBar(time, "2026-07", MONTHLY), "按月")).toContain(
    'aria-pressed="true"',
  );
});

test("切换主窗口时显式说明被调整的对比选择", () => {
  const yearToDate = adjustTimeWindow(
    {
      window: { kind: "trailing", count: 6, unit: "month" },
      comparison: { kind: "previous_period" },
    },
    { kind: "year_to_date" },
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
    { kind: "range", from: "2026-01", to: "2026-07" },
  );
  expect(custom.time.comparison).toBeUndefined();
  expect(custom.adjustment).toContain("已移除自定义对照");
});

test("对比只换对比：显示方式是序列粒度，不受对照期影响", () => {
  const next = setTimeComparison(
    { window: { kind: "current_month" }, display: "month" },
    { kind: "previous_period" },
  );
  expect(next).toEqual({
    window: { kind: "current_month" },
    display: "month",
    comparison: { kind: "previous_period" },
  });
  expect(setTimeComparison(next)).toEqual({ window: { kind: "current_month" }, display: "month" });
});

test("对比文案随主窗口说人话", () => {
  expect(previousPeriodLabel({ kind: "current_month" })).toBe("上月");
  expect(previousYearLabel({ kind: "current_month" })).toBe("去年同月");
  expect(previousPeriodLabel({ kind: "trailing", count: 6, unit: "month" })).toBe("上一等长期间");
  expect(previousYearLabel({ kind: "year_to_date" })).toBe("去年同期");

  const out = renderBar({
    window: { kind: "year_to_date" },
    comparison: { kind: "previous_year" },
  });
  expect(out).toContain("与去年同期比较");
});

test("自定义对照默认为主窗口整体回移一年", () => {
  const time: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-07" },
  };
  expect(defaultCustomComparisonWindow(time, "2026-07")).toEqual({
    kind: "range",
    from: "2025-01",
    to: "2025-07",
  });
});

test("时间栏三控件内联在场：粒度只有按月/按年两档，不开浮层即一击可达", () => {
  const out = renderBar({ window: { kind: "current_month" } });
  expect(out).toContain('aria-label="观察时间"');
  expect(out).toContain('aria-label="添加对比"');
  expect(segmentLabels(out)).toEqual(["按月", "按年"]);
  expect(out).not.toContain("自动");
  expect(out).toContain("最新月份");
});

test("分段亮的是实际生效的粒度：省略 display 时按窗口推导，整段单桶时两档都不亮", () => {
  const single = renderBar({ window: { kind: "current_month" } });
  expect(segmentAttrs(single, "按月")).toContain('aria-pressed="false"');
  expect(segmentAttrs(single, "按年")).toContain('aria-pressed="false"');
  const months = renderBar({ window: { kind: "trailing", count: 12, unit: "month" } });
  expect(segmentAttrs(months, "按月")).toContain('aria-pressed="true"');
  const years = renderBar({ window: { kind: "trailing", count: 3, unit: "year" } });
  expect(segmentAttrs(years, "按年")).toContain('aria-pressed="true"');
  const explicit = renderBar({
    window: { kind: "trailing", count: 3, unit: "year" },
    display: "month",
  });
  expect(segmentAttrs(explicit, "按月")).toContain('aria-pressed="true"');
});

test("期间浮层把两种回看口径分节，并在每行印出实际起止月", () => {
  const out = renderToStaticMarkup(
    <WindowPopup
      latest="2026-07"
      onChange={() => true}
      onPick={() => {}}
      time={{ window: { kind: "trailing", count: 2, unit: "year" } }}
    />,
  );
  const labels = [...out.matchAll(/data-slot="popup-title"[^>]*>([^<]*)</g)].map((m) => m[1]);
  expect(labels).toEqual(["按月滚动", "按日历年"]);
  const rows: Array<[string | undefined, string | undefined]> = [
    ...out.matchAll(
      /<span class="min-w-0 truncate[^"]*">([^<]*)<\/span>(?:<span[^>]*data-slot="popover-list-detail">([^<]*)<\/span>)?/g,
    ),
  ].map((m) => [m[1], m[2]]);
  // 同为「回看两年」：滚动 24 个月与日历年 2 年落到实处不是同一段时间。
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
});

test("对照期在某一粒度下与主期撞桶：那一档点击前就灰，理由与落值闸同句", () => {
  const out = renderBar(
    {
      window: { kind: "trailing", count: 6, unit: "month" },
      comparison: { kind: "previous_period" },
    },
    "2026-08",
  );
  expect(segmentAttrs(out, "按年")).toContain('aria-disabled="true"');
  expect(segmentAttrs(out, "按月")).toContain('aria-disabled="false"');
  // 灰掉的理由与落值闸同一句：分段不是另一套规则。
  expect(
    timeChangeIssue(
      {
        window: { kind: "trailing", count: 6, unit: "month" },
        display: "year",
        comparison: { kind: "previous_period" },
      },
      "2026-08",
    ),
  ).toContain("都会产生 2026 年");
});

test("对比浮层：会撞桶的对照档点击前就灰，可用的照常", () => {
  const html = (time: TimeIntent) =>
    renderToStaticMarkup(
      <ComparisonPopup
        capabilities={{}}
        grouped={false}
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
  const years = html({ window: { kind: "trailing", count: 5, unit: "year" } });
  expect(rowAttrs(years, "去年同期")).toContain('aria-disabled="true"');
  expect(rowAttrs(years, "上一等长期间")).not.toContain("aria-disabled");
  const ytd = html({ window: { kind: "year_to_date" } });
  expect(rowAttrs(ytd, "去年同期")).not.toContain("aria-disabled");
});

test("单月对上月：两期同落一年，按年灰、按月可用；换去年同月则两档都可用", () => {
  const sameYear = renderBar({
    window: { kind: "current_month" },
    comparison: { kind: "previous_period" },
  });
  expect(segmentAttrs(sameYear, "按年")).toContain('aria-disabled="true"');
  expect(segmentAttrs(sameYear, "按月")).toContain('aria-disabled="false"');
  const lastYear = renderBar({
    window: { kind: "current_month" },
    comparison: { kind: "previous_year" },
  });
  for (const label of ["按月", "按年"]) {
    expect(segmentAttrs(lastYear, label)).toContain('aria-disabled="false"');
  }
});

test("按月定义的指标跨月时分段只留按月", () => {
  const out = renderBar(
    { window: { kind: "range", from: "2026-01", to: "2026-07" } },
    "2026-07",
    MONTHLY,
  );
  expect(segmentAttrs(out, "按年")).toContain('aria-disabled="true"');
  expect(segmentAttrs(out, "按月")).toContain('aria-disabled="false"');
  expect(
    segmentAttrs(renderBar({ window: { kind: "range", from: "2026-01", to: "2026-07" } }), "按年"),
  ).toContain('aria-disabled="false"');
});

test("年初归零的指标跨日历年时两档全部可用", () => {
  const crossYear = renderBar(
    { window: { kind: "range", from: "2024-01", to: "2026-07" } },
    "2026-07",
    YEAR_SCOPED,
  );
  // 跨日历年按年/按月都成立；整窗读数由合计位按终点降级给出。
  for (const label of ["按月", "按年"]) {
    expect(segmentAttrs(crossYear, label)).toContain('aria-disabled="false"');
  }
});

test("能力卡不成立的显示方式在写入草稿前被拦下，与服务端拒绝同因", () => {
  const crossMonthYear: TimeIntent = {
    window: { kind: "range", from: "2026-01", to: "2026-08" },
    display: "year",
  };
  expect(timeChangeIssue(crossMonthYear, "2026-08", MONTHLY)).toContain("按月定义");
  expect(
    timeChangeIssue({ ...crossMonthYear, display: "month" }, "2026-08", MONTHLY),
  ).toBeUndefined();
  expect(timeChangeIssue(crossMonthYear, "2026-08")).toBeUndefined();
});

test("数据截至月不可用时拒绝编辑，不以浏览器本地月份猜测", () => {
  const out = renderBar({ window: { kind: "current_month" } }, "未知");
  expect(out).toContain("数据最新月份暂不可用");
  expect(out).not.toContain('aria-label="观察时间"');
});

test("显示方式取档：点别的档显式写入，再点已指定的档剥掉 display 键，推导出的档再点不动", () => {
  const single: TimeIntent = { window: { kind: "current_month" } };
  expect(toggleDisplayChoice(single, "month", undefined)).toEqual({ ...single, display: "month" });
  expect(toggleDisplayChoice({ ...single, display: "month" }, "year", "month")).toEqual({
    ...single,
    display: "year",
  });
  expect(toggleDisplayChoice({ ...single, display: "year" }, "year", "year")).toEqual(single);
  expect(toggleDisplayChoice(single, "month", "month")).toBeUndefined();
});

test("会产生重叠结果桶的对比在写入草稿前被拦截", () => {
  const issue = timeChangeIssue(
    {
      window: { kind: "trailing", count: 5, unit: "year" },
      display: "year",
      comparison: { kind: "previous_year" },
    },
    "2026-07",
  );
  expect(issue).toContain("结果无法区分");
  expect(issue).toContain("请选择互不重叠的主时间或对照时间");
  expect(issue).not.toContain("改为按月");
});

test("三种默认窗口产生的业务坐标都能组成权威 AnalysisSpec", () => {
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

// 编辑器只该产出契约合法、结果桶互不重叠的时间坐标。三种默认窗口覆盖 GUI 的全部出口，
// 逐个跑契约校验与唯一编译点的结果粒度解析，锁死「不生产会撞桶/非法坐标」这条不变量。
test("三种默认窗口都通过契约校验并解析出预期结果粒度", () => {
  const current = { window: DEFAULT_TIME_WINDOW.current_month };
  const monthly = { window: DEFAULT_TIME_WINDOW.trailing_months };
  const yearly = { window: DEFAULT_TIME_WINDOW.trailing_years };
  for (const time of [current, monthly, yearly])
    expect(() => TIME_INTENT_INPUT.parse(time)).not.toThrow();
  expect(resolveTimeOutputGrain(compileTimeIntent(current), "2026-07")).toBe("total");
  expect(resolveTimeOutputGrain(compileTimeIntent(monthly), "2026-07")).toBe("month");
  expect(resolveTimeOutputGrain(compileTimeIntent(yearly), "2026-07")).toBe("year");
});

test("off-menu 的近 N 值注入档位列表，触发器不留空白且档位内不重复", () => {
  // agent 写的 last:{months:9}/years:7 不在预设档位，须补进列表头供触发器匹配显示。
  expect(withCurrent([6, 12, 24, 36], 9)).toEqual([9, 6, 12, 24, 36]);
  expect(withCurrent([2, 3, 4, 5, 6], 7)).toEqual([7, 2, 3, 4, 5, 6]);
  expect(withCurrent([6, 12, 24, 36], 12)).toEqual([6, 12, 24, 36]);
});

test("默认窗口一律省略锚点走相对窗口，随数据滚动而非冻结在编辑月", () => {
  expect(DEFAULT_TIME_WINDOW.trailing_months).toEqual({
    kind: "trailing",
    count: 12,
    unit: "month",
  });
  expect(DEFAULT_TIME_WINDOW.trailing_years).toEqual({
    kind: "trailing",
    count: 3,
    unit: "year",
  });
  expect(DEFAULT_TIME_WINDOW.current_month).toEqual({ kind: "current_month" });
  // 同期口径与主窗口整体错开一年，随 actual_through 滚动。
  const aligned = {
    window: { kind: "year_to_date" as const },
    display: "year" as const,
    comparison: { kind: "previous_year" as const },
  };
  expect(() => TIME_INTENT_INPUT.parse(aligned)).not.toThrow();
  expect(resolveTimeOutputGrain(compileTimeIntent(aligned), "2026-07")).toBe("year");
});
