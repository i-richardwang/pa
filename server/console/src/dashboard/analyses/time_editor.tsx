import { Button } from "@/components/ui/button";
import {
  MonthPickerDialog,
  MonthRangePickerDialog,
  type MonthRange,
} from "@/components/ui/month-picker";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { popoverListCheck, PopoverListPanel, PopoverListRow } from "@/components/ui/popover-list";
import { PopupSection } from "@/components/ui/surface";
import { toastManager } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  compileTimeIntent,
  expandTimeCompare,
  expandTimeWindow,
  parseTimeIntent,
  primaryTimeRange,
  resolveTimeOutputGrain,
  seriesGrainIssues,
  type SeriesGrain,
  type TimeCapabilities,
  type TimeIntent,
} from "@time";
import { CalendarIcon, GitCompareArrowsIcon } from "lucide-react";
import { useState } from "react";
import { monthLabel, monthRangeLabel } from "@format";
import { DEFAULT_TIME_WINDOW } from "./analysis_draft";

type WindowChoice =
  | "current_month"
  | "year_to_date"
  | "trailing_months"
  | "trailing_years"
  | "range";
type ComparisonChoice = "none" | "previous_period" | "previous_year" | "custom";
/** 落一次改动，返回它是否真的落下了——被校验闸拦下时调用方不该再往下走。 */
type ApplyTimeChange = (time: TimeIntent, adjustment?: string) => boolean;
type CustomComparisonWindow = Extract<
  NonNullable<TimeIntent["comparison"]>,
  { kind: "custom" }
>["window"];

/** 常备档只留最常用的几个，其余长度走「自定义范围」。 */
const MONTH_CHOICES = [12, 24] as const;
const YEAR_CHOICES = [2, 3, 5] as const;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthIndex = (month: string) => {
  const [year, part] = month.split("-").map(Number);
  return year * 12 + part - 1;
};
const monthAt = (index: number) => {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
};
const validMonth = (value: string | undefined): value is string =>
  !!value && YEAR_MONTH.test(value);

/** 当前取值不在常备档里时排到最前，触发件与行列表才对得上。 */
export const withCurrent = (choices: readonly number[], current: number): number[] =>
  choices.includes(current) ? [...choices] : [current, ...choices];

/**
 * 观察窗口一句话，也是题名副行的全部内容：只出窗口，不出粒度与对比。
 */
export function windowSummary(time: TimeIntent): string {
  const { window } = time;
  if (window.kind === "current_month") {
    return window.month ? monthLabel(window.month) : "最新月份";
  }
  if (window.kind === "year_to_date") return "今年至今";
  if (window.kind === "trailing") {
    return `最近 ${window.count} ${window.unit === "month" ? "个月" : "年"}`;
  }
  return monthRangeLabel(window.from, window.to);
}

function comparisonChoice(time: TimeIntent): ComparisonChoice {
  return time.comparison?.kind ?? "none";
}

export function previousPeriodLabel(window: TimeIntent["window"]): string {
  return window.kind === "current_month" ? "上月" : "上一等长期间";
}

export function previousYearLabel(window: TimeIntent["window"]): string {
  return window.kind === "current_month" ? "去年同月" : "去年同期";
}

function comparisonSummary(time: TimeIntent): string {
  const comparison = time.comparison;
  if (!comparison) return "添加对比";
  if (comparison.kind === "previous_period") {
    return `与${previousPeriodLabel(time.window)}比较`;
  }
  if (comparison.kind === "previous_year") return `与${previousYearLabel(time.window)}比较`;
  return "自定义对比";
}

/** 冻结与否只看窗口自身是不是绝对表达式：固定单月与明确起止月冻结，其余随数据滚动。 */
function fixedWindow(time: TimeIntent): boolean {
  return (
    time.window.kind === "range" ||
    (time.window.kind === "current_month" && time.window.month !== undefined)
  );
}

/** 单月窗口的观察月：省略即随数据推进取最新月。 */
function withFixedMonth(time: TimeIntent, month?: string): TimeIntent {
  if (time.window.kind !== "current_month") return time;
  return { ...time, window: { kind: "current_month", ...(month ? { month } : {}) } };
}

export function adjustTimeWindow(
  time: TimeIntent,
  window: TimeIntent["window"],
): { time: TimeIntent; adjustment?: string } {
  let comparison = time.comparison;
  const adjustments: string[] = [];
  if (comparison?.kind === "previous_period" && window.kind === "year_to_date") {
    comparison = { kind: "previous_year" };
    adjustments.push("已将对比改为“去年同期”，因为今年至今不使用跨年的上一等长期间。");
  }
  if (comparison?.kind === "custom") {
    const kind = window.kind === "current_month" ? "current_month" : "range";
    if (comparison.window.kind !== kind) {
      comparison = undefined;
      adjustments.push("已移除自定义对照，因为单月与连续期间不能混合比较。");
    }
  }
  const { comparison: _comparison, ...base } = time;
  return {
    time: { ...base, window, ...(comparison ? { comparison } : {}) },
    ...(adjustments.length ? { adjustment: adjustments.join(" ") } : {}),
  };
}

/** 对比只换对比，窗口与粒度不动。 */
export function setTimeComparison(
  time: TimeIntent,
  comparison?: TimeIntent["comparison"],
): TimeIntent {
  const { comparison: _comparison, ...base } = time;
  return { ...base, ...(comparison ? { comparison } : {}) };
}

/** 只有绝对表达式承载冻结，故只有它们从上一窗口继承终点。 */
function presetWindow(
  choice: WindowChoice,
  latest: string,
  fixedEndpoint?: string,
): TimeIntent["window"] {
  if (choice === "current_month") {
    return { kind: "current_month", ...(fixedEndpoint ? { month: fixedEndpoint } : {}) };
  }
  if (choice === "year_to_date") return { kind: "year_to_date", grain: "month" };
  if (choice === "trailing_months") return DEFAULT_TIME_WINDOW.trailing_months;
  if (choice === "trailing_years") return DEFAULT_TIME_WINDOW.trailing_years;
  const to = fixedEndpoint ?? latest;
  return {
    kind: "range",
    from: monthAt(monthIndex(to) - (DEFAULT_TIME_WINDOW.trailing_months.count - 1)),
    to,
    grain: "month",
  };
}

/** 期间窗口的序列粒度；单月窗口是一个时点，没有粒度。 */
export function seriesGrainOf(window: TimeIntent["window"]): SeriesGrain | undefined {
  return window.kind === "current_month" ? undefined : window.grain;
}

export function withSeriesGrain(time: TimeIntent, grain: SeriesGrain): TimeIntent {
  if (time.window.kind === "current_month") return time;
  return { ...time, window: { ...time.window, grain } };
}

function coordinateRanges(time: TimeIntent, latest: string) {
  const expanded = expandTimeCompare(expandTimeWindow(compileTimeIntent(time), latest), latest);
  const primary = expanded.range ?? {
    from: expanded.cutoff ?? latest,
    to: expanded.cutoff ?? latest,
  };
  const comparisons = (expanded.compare ?? []).flatMap((coordinate) => {
    if ("range" in coordinate) return [coordinate.range];
    if ("cutoff" in coordinate) return [{ from: coordinate.cutoff, to: coordinate.cutoff }];
    return [];
  });
  return { primary, comparisons };
}

const rangeLabel = ({ from, to }: { from: string; to: string }) => monthRangeLabel(from, to);

export function summarizeResolvedTime(time: TimeIntent, latest: string): string {
  const parsed = parseTimeIntent(time);
  const { primary, comparisons } = coordinateRanges(parsed, latest);
  const grain = seriesGrainOf(parsed.window);
  const displayText =
    grain === undefined ? "一个结果" : grain === "month" ? "每月一个结果" : "每年一个结果";
  const comparison = comparisons.length ? ` · 对比 ${comparisons.map(rangeLabel).join("、")}` : "";
  const rolling = !fixedWindow(parsed);
  return `主期 ${rangeLabel(primary)} · ${displayText}${comparison} · ${rolling ? "随数据更新" : "固定时间"}`;
}

/** 落草稿前的唯一校验闸。 */
export function timeChangeIssue(
  time: TimeIntent,
  latest: string,
  capabilities: TimeCapabilities = {},
): string | undefined {
  try {
    const parsed = parseTimeIntent(time);
    resolveTimeOutputGrain(compileTimeIntent(parsed), latest);
    const grain = seriesGrainOf(parsed.window);
    return grain === undefined ? undefined : seriesGrainIssues(parsed, capabilities, latest)[grain];
  } catch (error) {
    return error instanceof Error ? error.message : "时间组合无效";
  }
}

/**
 * 期间浮层：相对窗口的 N 摊成行，不在浮层里再套 Select；
 * 需要具体月份的档把选择交给月份弹层。
 */
export function WindowPopup({
  time,
  latest,
  onChange,
  onPick,
}: {
  time: TimeIntent;
  latest: string;
  onChange: ApplyTimeChange;
  onPick: (kind: PickerKind) => void;
}) {
  const window = time.window;
  const month = window.kind === "current_month" ? window.month : undefined;
  const changeWindow = (next: TimeIntent["window"]) => {
    const normalized = adjustTimeWindow(time, next);
    return onChange(normalized.time, normalized.adjustment);
  };
  const endpoint =
    window.kind === "range"
      ? window.to
      : window.kind === "current_month"
        ? window.month
        : undefined;
  const trailing = (unit: "month" | "year", count: number) =>
    window.kind === "trailing" && window.unit === unit && window.count === count;
  /** 这一档落到实处的起止月：两种回看口径的差别在这里。 */
  const detail = (candidate: TimeIntent["window"]) => {
    const { from, to } = primaryTimeRange({ window: candidate }, latest);
    return `${from} – ${to}`;
  };
  const row = (
    key: string,
    label: string,
    selected: boolean,
    onSelect: () => void,
    candidate?: TimeIntent["window"],
  ) => (
    <PopoverListRow
      key={key}
      detail={candidate ? detail(candidate) : undefined}
      onClick={onSelect}
      selected={selected}
      trailing={popoverListCheck(selected)}
    >
      {label}
    </PopoverListRow>
  );
  const monthCounts = withCurrent(
    MONTH_CHOICES,
    window.kind === "trailing" && window.unit === "month" ? window.count : 0,
  ).filter((count) => count > 0);
  const yearCounts = withCurrent(
    YEAR_CHOICES,
    window.kind === "trailing" && window.unit === "year" ? window.count : 0,
  ).filter((count) => count > 0);
  return (
    <PopoverListPanel>
      <PopupSection>
        {row("current_month", "单个月份", window.kind === "current_month", () =>
          changeWindow(presetWindow("current_month", latest, endpoint)),
        )}
      </PopupSection>
      <PopupSection label="按月滚动">
        {monthCounts.map((count) => {
          const candidate = { kind: "trailing", count, unit: "month", grain: "month" } as const;
          return row(
            `m${count}`,
            `最近 ${count} 个月`,
            trailing("month", count),
            () => changeWindow(candidate),
            candidate,
          );
        })}
      </PopupSection>
      <PopupSection label="按日历年">
        {row(
          "year_to_date",
          "今年至今",
          window.kind === "year_to_date",
          () => changeWindow(presetWindow("year_to_date", latest, endpoint)),
          { kind: "year_to_date", grain: "month" },
        )}
        {yearCounts.map((count) => {
          const candidate = { kind: "trailing", count, unit: "year", grain: "year" } as const;
          return row(
            `y${count}`,
            `最近 ${count} 年`,
            trailing("year", count),
            () => changeWindow(candidate),
            candidate,
          );
        })}
      </PopupSection>
      {/* 被校验闸拦下的窗口不开选择弹层：为一个落不下的窗口挑月份是空跑一趟 */}
      <PopupSection>
        {row(
          "range",
          "自定义范围",
          window.kind === "range",
          () => {
            if (window.kind !== "range" && !changeWindow(presetWindow("range", latest, endpoint))) {
              return;
            }
            onPick("window_range");
          },
          window.kind === "range" ? window : undefined,
        )}
      </PopupSection>
      {/* 单月窗口的观察月是窗口自身的表达；相对窗口没有可选端点，恒随数据滚动。 */}
      {window.kind === "current_month" ? (
        <PopupSection label="观察月份">
          <PopoverListRow
            onClick={() => onChange(withFixedMonth(time))}
            selected={!month}
            trailing={popoverListCheck(!month)}
          >
            跟随最新数据
          </PopoverListRow>
          <PopoverListRow
            onClick={() => {
              if (!month && !onChange(withFixedMonth(time, latest))) return;
              onPick("window_month");
            }}
            selected={!!month}
            trailing={popoverListCheck(!!month)}
          >
            {month ? monthLabel(month) : "固定到某个月"}
          </PopoverListRow>
        </PopupSection>
      ) : null}
    </PopoverListPanel>
  );
}

const GRAIN_CHOICES: { value: SeriesGrain; label: string }[] = [
  { value: "month", label: "按月" },
  { value: "year", label: "按年" },
];

/**
 * 每档对落值闸 `timeChangeIssue` 预跑一遍，点击前就灰；
 * toast 只留给这张表也算不出的情形。
 */
function grainChoiceIssues(
  time: TimeIntent,
  latest: string,
  capabilities: TimeCapabilities,
): Partial<Record<SeriesGrain, string>> {
  const issues = seriesGrainIssues(time, capabilities, latest);
  for (const { value } of GRAIN_CHOICES) {
    if (issues[value]) continue;
    const issue = timeChangeIssue(withSeriesGrain(time, value), latest, capabilities);
    if (issue) issues[value] = issue;
  }
  return issues;
}

/**
 * 序列粒度分段，只在期间窗口出现：一击直达，恒有一档亮。
 * 禁用钮不派发指针事件，Tooltip 挂在外层 span 上。
 */
function GrainSegments({
  time,
  latest,
  capabilities,
  onChange,
}: {
  time: TimeIntent;
  latest: string;
  capabilities: TimeCapabilities;
  onChange: ApplyTimeChange;
}) {
  const active = seriesGrainOf(time.window);
  if (!active) return null;
  const issues = grainChoiceIssues(time, latest, capabilities);
  return (
    <ToggleGroup
      aria-label="序列粒度"
      columns={2}
      onValueChange={(value) => {
        // 单选组里再点亮着的档会给出空值：粒度不可撤回，视为没有动作。
        const choice = value[0] as SeriesGrain | undefined;
        if (choice && choice !== active) onChange(withSeriesGrain(time, choice));
      }}
      value={[active]}
    >
      {GRAIN_CHOICES.map((choice) => {
        const reason = issues[choice.value];
        const item = (
          <ToggleGroupItem className="w-full px-2" disabled={!!reason} value={choice.value}>
            {choice.label}
          </ToggleGroupItem>
        );
        if (!reason) return <div key={choice.value}>{item}</div>;
        return (
          <Tooltip disableHoverablePopup key={choice.value}>
            <TooltipTrigger render={<div className="flex" />}>{item}</TooltipTrigger>
            <TooltipPopup>{reason}</TooltipPopup>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}

export function defaultCustomComparisonWindow(
  time: TimeIntent,
  latest: string,
): CustomComparisonWindow {
  const range = primaryTimeRange(time, latest);
  if (time.window.kind === "current_month") {
    return {
      kind: "current_month" as const,
      month: monthAt(monthIndex(range.to) - 12),
    };
  }
  return {
    kind: "range" as const,
    from: monthAt(monthIndex(range.from) - 12),
    to: monthAt(monthIndex(range.to) - 12),
  };
}

export function ComparisonPopup({
  time,
  latest,
  capabilities,
  onChange,
  onPick,
}: {
  time: TimeIntent;
  latest: string;
  capabilities: TimeCapabilities;
  onChange: ApplyTimeChange;
  onPick: (kind: PickerKind) => void;
}) {
  const choice = comparisonChoice(time);
  const custom = time.comparison?.kind === "custom" ? time.comparison.window : undefined;
  const setComparison = (comparison?: TimeIntent["comparison"]) =>
    onChange(setTimeComparison(time, comparison));
  const row = (
    value: ComparisonChoice,
    label: string,
    candidate: TimeIntent["comparison"] | undefined,
    onSelect: () => void,
  ) => {
    const selected = choice === value;
    const reason = selected
      ? undefined
      : timeChangeIssue(setTimeComparison(time, candidate), latest, capabilities);
    const item = (
      <PopoverListRow
        onClick={onSelect}
        selected={selected}
        trailing={popoverListCheck(selected)}
        unavailable={!!reason}
      >
        {label}
      </PopoverListRow>
    );
    if (!reason) return <div key={value}>{item}</div>;
    return (
      <Tooltip disableHoverablePopup key={value}>
        <TooltipTrigger render={<div />}>{item}</TooltipTrigger>
        <TooltipPopup side="left">{reason}</TooltipPopup>
      </Tooltip>
    );
  };
  const customCandidate: TimeIntent["comparison"] = custom
    ? { kind: "custom", window: custom }
    : { kind: "custom", window: defaultCustomComparisonWindow(time, latest) };
  return (
    <PopoverListPanel>
      {row("none", "不比较", undefined, () => setComparison())}
      {time.window.kind !== "year_to_date"
        ? row(
            "previous_period",
            previousPeriodLabel(time.window),
            { kind: "previous_period" },
            () => setComparison({ kind: "previous_period" }),
          )
        : null}
      {row("previous_year", previousYearLabel(time.window), { kind: "previous_year" }, () =>
        setComparison({ kind: "previous_year" }),
      )}
      <PopupSection>
        {row(
          "custom",
          custom ? customComparisonSummary(custom) : "自定义对照",
          customCandidate,
          () => {
            const applied = custom !== undefined || setComparison(customCandidate);
            if (applied) onPick("comparison");
          },
        )}
      </PopupSection>
    </PopoverListPanel>
  );
}

/** 已选对照期间在行上直接读出。 */
function customComparisonSummary(window: CustomComparisonWindow): string {
  return window.kind === "current_month"
    ? monthLabel(window.month)
    : monthRangeLabel(window.from, window.to);
}

/** 哪一处在等月份选择：三处各自的默认值与落值口径不同，不能共用一个开关。 */
type PickerKind = "window_range" | "window_month" | "comparison";

/** 月份弹层：期间、观察月与对照期间共用这一处出口，落值仍走同一道校验闸。 */
function TimeMonthPickers({
  kind,
  onClose,
  time,
  latest,
  onChange,
}: {
  kind?: PickerKind;
  onClose: () => void;
  time: TimeIntent;
  latest: string;
  onChange: ApplyTimeChange;
}) {
  const window = time.window;
  const custom = time.comparison?.kind === "custom" ? time.comparison.window : undefined;
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  const applyComparison = (next: CustomComparisonWindow) =>
    onChange(setTimeComparison(time, { kind: "custom", window: next }));
  const fallback: MonthRange = { from: latest, to: latest };

  if (kind === "window_range") {
    return (
      <MonthRangePickerDialog
        current={latest}
        fromLabel="开始月份"
        label="自定义范围"
        onOpenChange={close}
        onValueChange={(range) => {
          const grain = seriesGrainOf(window) ?? "month";
          const normalized = adjustTimeWindow(time, { kind: "range", ...range, grain });
          onChange(normalized.time, normalized.adjustment);
        }}
        open
        toLabel="结束月份"
        value={window.kind === "range" ? { from: window.from, to: window.to } : fallback}
      />
    );
  }
  if (kind === "window_month") {
    return (
      <MonthPickerDialog
        current={latest}
        label="观察月份"
        onOpenChange={close}
        onValueChange={(month) => onChange(withFixedMonth(time, month))}
        open
        value={(window.kind === "current_month" ? window.month : undefined) ?? latest}
      />
    );
  }
  if (kind === "comparison" && custom?.kind === "current_month") {
    return (
      <MonthPickerDialog
        current={latest}
        label="对照月份"
        onOpenChange={close}
        onValueChange={(month) => applyComparison({ kind: "current_month", month })}
        open
        value={custom.month}
      />
    );
  }
  if (kind === "comparison" && custom?.kind === "range") {
    return (
      <MonthRangePickerDialog
        current={latest}
        fromLabel="对照开始月份"
        label="对照期间"
        onOpenChange={close}
        onValueChange={(range) => applyComparison({ kind: "range", ...range })}
        open
        toLabel="对照结束月份"
        value={{ from: custom.from, to: custom.to }}
      />
    );
  }
  return null;
}

/**
 * 工作台底栏与看板时间覆盖同用这一条；每次落值都过 `timeChangeIssue`，
 * 联动调整与拒绝都以 toast 回执。
 */
export function TimeBar({
  time,
  onChange,
  dataAsOf,
  capabilities = {},
}: {
  time: TimeIntent;
  onChange: (time: TimeIntent) => void;
  dataAsOf: string;
  capabilities?: TimeCapabilities;
}) {
  const [picker, setPicker] = useState<PickerKind>();
  const timeIntent = parseTimeIntent(time);
  if (!validMonth(dataAsOf)) {
    return (
      <p className="text-pa-danger-fg text-xs" role="alert">
        数据最新月份暂不可用，无法编辑时间范围。
      </p>
    );
  }
  const latest = dataAsOf;
  const applyChange: ApplyTimeChange = (next, message) => {
    const issue = timeChangeIssue(next, latest, capabilities);
    if (issue) {
      toastManager.add({ type: "info", title: `未应用本次修改：${issue}` });
      return false;
    }
    if (message) toastManager.add({ type: "info", title: message });
    onChange(next);
    return true;
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="time-bar">
      <Popover>
        <Tooltip disableHoverablePopup>
          <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
            <PopoverTrigger
              render={<Button aria-label="观察时间" className="min-w-0" variant="subtle" />}
            >
              <CalendarIcon aria-hidden="true" className="size-3.5" />
              <span className="truncate">{windowSummary(timeIntent)}</span>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipPopup>
            {summarizeResolvedTime(timeIntent, latest)} · 数据截至 {monthLabel(latest)}
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup width="list">
          <WindowPopup
            latest={latest}
            onChange={applyChange}
            onPick={setPicker}
            time={timeIntent}
          />
        </PopoverPopup>
      </Popover>

      <GrainSegments
        capabilities={capabilities}
        latest={latest}
        onChange={applyChange}
        time={timeIntent}
      />

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label={timeIntent.comparison ? "时间对比" : "添加对比"}
              className="min-w-0"
              variant="subtle"
            />
          }
        >
          <GitCompareArrowsIcon aria-hidden="true" className="size-3.5" />
          <span className="truncate">{comparisonSummary(timeIntent)}</span>
        </PopoverTrigger>
        <PopoverPopup width="list">
          <ComparisonPopup
            capabilities={capabilities}
            latest={latest}
            onChange={applyChange}
            onPick={setPicker}
            time={timeIntent}
          />
        </PopoverPopup>
      </Popover>

      <TimeMonthPickers
        kind={picker}
        latest={latest}
        onChange={applyChange}
        onClose={() => setPicker(undefined)}
        time={timeIntent}
      />
    </div>
  );
}
