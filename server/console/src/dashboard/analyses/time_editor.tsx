import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MonthPickerDialog, MonthRangePickerDialog } from "@/components/ui/month-picker";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { popoverListCheck, PopoverListPanel, PopoverListRow } from "@/components/ui/popover-list";
import { PopupSection } from "@/components/ui/surface";
import { toastManager } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  metricTimeSelectionIssue,
  OBSERVATION_SELECTION_INPUT,
  isYearMonth,
  parseTimeIntent,
  primaryTimeRange,
  resolveTimeIntentSelection,
  shiftYearMonth,
  timeSelectionIssueMessage,
  type SeriesGrain,
  type TimeCapabilities,
  type BusinessTime,
  type ColumnTime,
  type TimeIntent,
  COLUMN_TIME_INPUT,
  type TimeSelectionIssue,
} from "@time";
import { CalendarIcon, GitCompareArrowsIcon } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { monthLabel, monthRangeLabel, windowSummary } from "@format";
import { DEFAULT_TIME_WINDOW } from "./analysis_draft";
import { useDimensionValues } from "../dashboard_queries";

type ComparisonChoice = "none" | "previous_period" | "previous_year" | "custom";
type ApplyTimeChange = (time: BusinessTime, adjustment?: string) => boolean;
type CustomComparisonWindow = Extract<
  NonNullable<BusinessTime["comparison"]>,
  { kind: "custom" }
>["window"];

const MONTH_CHOICES = [12, 24] as const;
const YEAR_CHOICES = [2, 3, 5] as const;
const validMonth = (value: string | undefined): value is string => isYearMonth(value);

function shiftedMonth(value: string, delta: number): string {
  const shifted = shiftYearMonth(value, delta);
  if (!shifted) throw new Error(`月份「${value}」无效，请使用 YYYY-MM`);
  return shifted;
}

export const withCurrent = (choices: readonly number[], current: number): number[] =>
  choices.includes(current) ? [...choices] : [current, ...choices];

function comparisonChoice(time: BusinessTime): ComparisonChoice {
  return time.comparison?.kind ?? "none";
}

export function previousPeriodLabel(window: BusinessTime["window"]): string {
  return window.kind === "current_month" ? "上月" : "上一期";
}

export function previousYearLabel(window: BusinessTime["window"]): string {
  return window.kind === "current_month" ? "去年同月" : "去年同期";
}

function comparisonSummary(time: BusinessTime): string {
  const comparison = time.comparison;
  if (!comparison) return "添加对比";
  if (comparison.kind === "previous_period") {
    return `与${previousPeriodLabel(time.window)}比较`;
  }
  if (comparison.kind === "previous_year") return `与${previousYearLabel(time.window)}比较`;
  return "自定义对比";
}

/** 指定月份的单月与自定义范围是固定时间，其余窗口随数据更新。 */
function fixedWindow(time: BusinessTime): boolean {
  return (
    time.window.kind === "range" ||
    (time.window.kind === "current_month" && time.window.month !== undefined)
  );
}

function withFixedMonth(time: BusinessTime, month?: string): BusinessTime {
  if (time.window.kind !== "current_month") return time;
  return { ...time, window: { kind: "current_month", ...(month ? { month } : {}) } };
}

export function adjustTimeWindow(
  time: BusinessTime,
  window: BusinessTime["window"],
): { time: BusinessTime; adjustment?: string } {
  if (window.kind === "observation") return { time: { window } };
  let comparison = time.comparison;
  const adjustments: string[] = [];
  if (comparison?.kind === "previous_period" && window.kind === "year_to_date") {
    comparison = { kind: "previous_year" };
    adjustments.push("已将对比改为“去年同期”：今年至今的上一期会跨年，不能用于比较。");
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

export function setTimeComparison(
  time: BusinessTime,
  comparison?: BusinessTime["comparison"],
): BusinessTime {
  const { comparison: _comparison, ...base } = time;
  return { ...base, ...(comparison ? { comparison } : {}) };
}

export function seriesGrainOf(window: BusinessTime["window"]): SeriesGrain | undefined {
  return "grain" in window ? window.grain : undefined;
}

export function withSeriesGrain(time: BusinessTime, grain: SeriesGrain): BusinessTime {
  if (!("grain" in time.window)) return time;
  return { ...time, window: { ...time.window, grain } };
}

const rangeLabel = ({ from, to }: { from: string; to: string }) => monthRangeLabel(from, to);

export function summarizeResolvedTime(
  time: BusinessTime,
  latest: string,
  mode: "query" | "column" = "query",
): string {
  if (time.window.kind === "observation") return windowSummary(time);
  const result = resolveTimeIntentSelection(time, latest, mode);
  if (result.status === "invalid") return timeSelectionIssueMessage(result.issue);
  const ranges = result.selection.coordinates.map((coordinate) =>
    coordinate.kind === "cutoff"
      ? { from: coordinate.cutoff, to: coordinate.cutoff }
      : { from: coordinate.from, to: coordinate.to },
  );
  const [primary, ...comparisons] = ranges;
  const grain = seriesGrainOf(time.window);
  const displayText =
    grain === undefined ? "一个结果" : grain === "month" ? "每月一个结果" : "每年一个结果";
  const comparison = comparisons.length ? ` · 对比 ${comparisons.map(rangeLabel).join("、")}` : "";
  const rolling = !fixedWindow(time);
  return `观察期 ${rangeLabel(primary)} · ${displayText}${comparison} · ${rolling ? "随数据更新" : "固定时间"}`;
}

export function timeChangeIssue(
  time: BusinessTime,
  latest: string,
  capabilities: TimeCapabilities = {},
  mode: "query" | "column" = "query",
): TimeSelectionIssue | undefined {
  const result = resolveTimeIntentSelection(time, latest, mode);
  if (result.status === "invalid") return result.issue;
  return metricTimeSelectionIssue([{ capabilities }], result.selection);
}

function OccurrenceChoices({
  dimension,
  value,
  onSelect,
}: {
  dimension: string;
  value: string;
  onSelect: (value: string) => void;
}) {
  const [search, setSearch] = useState(value.trim());
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timeout);
  }, [value]);
  const options = useDimensionValues(dimension, search);
  return (
    <div className="max-h-32 overflow-y-auto">
      {options.data?.values.map((id) => (
        <PopoverListRow key={id} selected={id === value} onClick={() => onSelect(id)}>
          {id}
        </PopoverListRow>
      ))}
      {options.isError && (
        <p className="text-xs text-pa-muted">期次列表加载失败，可直接输入编码。</p>
      )}
    </div>
  );
}

function ObservationWindowEditor({
  time,
  latest,
  dimension,
  singleColumn,
  onChange,
}: {
  time: BusinessTime;
  latest: string;
  dimension: string;
  singleColumn?: boolean;
  onChange: ApplyTimeChange;
}) {
  const current = time.window.kind === "observation" ? time.window.selection : undefined;
  const [kind, setKind] = useState(current?.kind ?? "as_of");
  const [first, setFirst] = useState(
    current?.kind === "occurrence"
      ? current.id
      : current?.kind === "as_of"
        ? current.date
        : (current?.from ?? `${latest}-01`),
  );
  const [last, setLast] = useState(current?.kind === "trend" ? current.to : `${latest}-01`);
  const selection = OBSERVATION_SELECTION_INPUT.safeParse(
    kind === "occurrence"
      ? { kind, id: first }
      : kind === "as_of"
        ? { kind, date: first }
        : { kind, from: first, to: last },
  );
  const changeKind = (kind: "occurrence" | "as_of" | "trend") => {
    setKind(kind);
    setFirst(kind === "occurrence" ? "" : `${latest}-01`);
  };
  return (
    <PopupSection label="调研期次">
      <ToggleGroup
        columns={singleColumn ? 2 : 3}
        value={[kind]}
        onValueChange={(values) => {
          const value = values[0];
          if (value === "occurrence" || value === "as_of" || value === "trend") changeKind(value);
        }}
      >
        <ToggleGroupItem value="occurrence">指定期次</ToggleGroupItem>
        <ToggleGroupItem value="as_of">截至日期</ToggleGroupItem>
        {!singleColumn && <ToggleGroupItem value="trend">期次趋势</ToggleGroupItem>}
      </ToggleGroup>
      <Input
        aria-label={
          kind === "occurrence" ? "期次编码" : kind === "as_of" ? "截止日期" : "观测开始日期"
        }
        onChange={(event) => setFirst(event.currentTarget.value)}
        placeholder={kind === "occurrence" ? "期次编码" : undefined}
        size="sm"
        type={kind === "occurrence" ? "text" : "date"}
        value={first}
      />
      {kind === "occurrence" && (
        <OccurrenceChoices dimension={dimension} value={first} onSelect={setFirst} />
      )}
      {kind === "trend" && (
        <Input
          aria-label="观测结束日期"
          onChange={(event) => setLast(event.currentTarget.value)}
          size="sm"
          type="date"
          value={last}
        />
      )}
      <Button
        disabled={!selection.success || (kind === "trend" && first > last)}
        onClick={() => {
          if (selection.success)
            onChange({ window: { kind: "observation", selection: selection.data } });
        }}
        size="compact"
        variant="filled"
      >
        应用期次
      </Button>
    </PopupSection>
  );
}

export function WindowPopup({
  time,
  latest,
  capabilities = {},
  onChange,
  onPick,
  singleColumn,
}: {
  time: BusinessTime;
  latest: string;
  capabilities?: TimeCapabilities;
  onChange: ApplyTimeChange;
  onPick: (kind: PickerKind) => void;
  singleColumn?: boolean;
}) {
  const window = time.window;
  const month = window.kind === "current_month" ? window.month : undefined;
  const changeWindow = (next: BusinessTime["window"]) => {
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
  const detail = (candidate: BusinessTime["window"]) => {
    const { from, to } = primaryTimeRange({ window: candidate }, latest);
    return `${from} – ${to}`;
  };
  const row = (
    key: string,
    label: string,
    selected: boolean,
    onSelect: () => void,
    candidate?: BusinessTime["window"],
  ) => {
    const issue = candidate
      ? timeChangeIssue(
          adjustTimeWindow(time, candidate).time,
          latest,
          capabilities,
          singleColumn ? "column" : "query",
        )
      : undefined;
    const reason = issue ? timeSelectionIssueMessage(issue) : undefined;
    const item = (
      <PopoverListRow
        detail={candidate ? detail(candidate) : undefined}
        onClick={onSelect}
        selected={selected}
        trailing={popoverListCheck(selected)}
        unavailable={Boolean(reason)}
      >
        {label}
        {reason ? <span className="sr-only">（{reason}）</span> : null}
      </PopoverListRow>
    );
    if (!reason) return <Fragment key={key}>{item}</Fragment>;
    return (
      <Tooltip disableHoverablePopup key={key}>
        <TooltipTrigger render={<div />}>{item}</TooltipTrigger>
        <TooltipPopup>{reason}</TooltipPopup>
      </Tooltip>
    );
  };
  const seriesGrain = (grain: SeriesGrain) => (singleColumn ? {} : { grain });
  const yearToDate = { kind: "year_to_date", ...seriesGrain("month") } as const;
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
      {capabilities.observation && (
        <ObservationWindowEditor
          key={windowSummary(time)}
          dimension={capabilities.observation}
          latest={latest}
          onChange={onChange}
          singleColumn={singleColumn}
          time={time}
        />
      )}
      <PopupSection>
        {row("current_month", "单个月份", window.kind === "current_month", () =>
          changeWindow({ kind: "current_month", month: endpoint }),
        )}
      </PopupSection>
      <PopupSection label="按月滚动">
        {monthCounts.map((count) => {
          const candidate = {
            kind: "trailing",
            count,
            unit: "month",
            ...seriesGrain("month"),
          } as const;
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
          () => changeWindow(yearToDate),
          yearToDate,
        )}
        {yearCounts.map((count) => {
          const grain = capabilities.grain === "month" ? "month" : "year";
          const candidate = {
            kind: "trailing",
            count,
            unit: "year",
            ...seriesGrain(grain),
          } as const;
          return row(
            `y${count}`,
            `最近 ${count} 年${!singleColumn && grain === "month" ? "（按月）" : ""}`,
            trailing("year", count),
            () => changeWindow(candidate),
            candidate,
          );
        })}
      </PopupSection>
      <PopupSection>
        {row(
          "range",
          "自定义范围",
          window.kind === "range",
          () => onPick("window_range"),
          window.kind === "range" ? window : undefined,
        )}
      </PopupSection>
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
            onClick={() => onPick("window_month")}
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

function grainChoiceIssues(
  time: BusinessTime,
  latest: string,
  capabilities: TimeCapabilities,
): Partial<Record<SeriesGrain, string>> {
  const issues: Partial<Record<SeriesGrain, string>> = {};
  for (const { value } of GRAIN_CHOICES) {
    const issue = timeChangeIssue(withSeriesGrain(time, value), latest, capabilities);
    if (issue) issues[value] = timeSelectionIssueMessage(issue);
  }
  return issues;
}

/** 禁用的按钮不派发指针事件，Tooltip 挂在外层元素上。 */
function GrainSegments({
  time,
  latest,
  capabilities,
  onChange,
}: {
  time: BusinessTime;
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
        // 单选组再次点击已选项会返回空值；粒度不能取消，忽略这次操作。
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
  time: BusinessTime,
  latest: string,
): CustomComparisonWindow {
  const range = primaryTimeRange(time, latest);
  if (time.window.kind === "current_month") {
    return {
      kind: "current_month" as const,
      month: shiftedMonth(range.to, -12),
    };
  }
  return {
    kind: "range" as const,
    from: shiftedMonth(range.from, -12),
    to: shiftedMonth(range.to, -12),
  };
}

export function ComparisonPopup({
  time,
  latest,
  capabilities,
  onChange,
  onPick,
}: {
  time: BusinessTime;
  latest: string;
  capabilities: TimeCapabilities;
  onChange: ApplyTimeChange;
  onPick: (kind: PickerKind) => void;
}) {
  const choice = comparisonChoice(time);
  const custom = time.comparison?.kind === "custom" ? time.comparison.window : undefined;
  const setComparison = (comparison?: BusinessTime["comparison"]) =>
    onChange(setTimeComparison(time, comparison));
  const row = (
    value: ComparisonChoice,
    label: string,
    candidate: BusinessTime["comparison"] | undefined,
    onSelect: () => void,
  ) => {
    const selected = choice === value;
    const issue = selected
      ? undefined
      : timeChangeIssue(setTimeComparison(time, candidate), latest, capabilities);
    const reason = issue ? timeSelectionIssueMessage(issue) : undefined;
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
  const customCandidate: BusinessTime["comparison"] = custom
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

function customComparisonSummary(window: CustomComparisonWindow): string {
  return window.kind === "current_month"
    ? monthLabel(window.month)
    : monthRangeLabel(window.from, window.to);
}

type PickerKind = "window_range" | "window_month" | "comparison";

function TimeMonthPickers({
  singleColumn,
  kind,
  onClose,
  time,
  latest,
  onChange,
}: {
  singleColumn?: boolean;
  kind?: PickerKind;
  onClose: () => void;
  time: BusinessTime;
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

  if (kind === "window_range") {
    const to = window.kind === "current_month" ? (window.month ?? latest) : latest;
    const from = shiftedMonth(to, -(DEFAULT_TIME_WINDOW.trailing_months.count - 1));
    return (
      <MonthRangePickerDialog
        current={latest}
        fromLabel="开始月份"
        label="自定义范围"
        onOpenChange={close}
        onValueChange={(range) => {
          const output = singleColumn ? {} : { grain: seriesGrainOf(window) ?? "month" };
          const normalized = adjustTimeWindow(time, { kind: "range", ...range, ...output });
          onChange(normalized.time, normalized.adjustment);
        }}
        open
        toLabel="结束月份"
        value={window.kind === "range" ? window : { from, to }}
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

type TimeBarProps = {
  dataAsOf?: string;
  capabilities?: TimeCapabilities;
} & (
  | { singleColumn: true; time: ColumnTime; onChange: (time: ColumnTime) => void }
  | { singleColumn?: false; time: TimeIntent; onChange: (time: TimeIntent) => void }
);

export function TimeBar(props: TimeBarProps) {
  const { time: timeIntent, singleColumn, dataAsOf, capabilities = {} } = props;
  const mode = singleColumn ? "column" : "query";
  const [picker, setPicker] = useState<PickerKind>();
  const [windowOpen, setWindowOpen] = useState(false);
  if (!validMonth(dataAsOf)) {
    return (
      <p className="text-pa-danger-fg text-xs" role="alert">
        数据最新月份暂不可用，无法编辑时间范围。
      </p>
    );
  }
  const latest = dataAsOf;
  const applyChange: ApplyTimeChange = (next, message) => {
    const issue = timeChangeIssue(next, latest, capabilities, mode);
    if (issue) {
      toastManager.add({
        type: "info",
        title: `未应用本次修改：${timeSelectionIssueMessage(issue)}`,
      });
      return false;
    }
    if (message) toastManager.add({ type: "info", title: message });
    if (props.singleColumn) props.onChange(COLUMN_TIME_INPUT.parse(next));
    else props.onChange(parseTimeIntent(next));
    return true;
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="time-bar">
      <Popover open={windowOpen} onOpenChange={setWindowOpen}>
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
            {summarizeResolvedTime(timeIntent, latest, mode)} · 数据截至 {monthLabel(latest)}
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup width="list">
          <WindowPopup
            capabilities={capabilities}
            latest={latest}
            onChange={(next, message) => {
              const applied = applyChange(next, message);
              if (applied && next.window.kind === "observation") setWindowOpen(false);
              return applied;
            }}
            onPick={setPicker}
            singleColumn={singleColumn}
            time={timeIntent}
          />
        </PopoverPopup>
      </Popover>

      {!singleColumn && (
        <GrainSegments
          capabilities={capabilities}
          latest={latest}
          onChange={applyChange}
          time={timeIntent}
        />
      )}

      {!singleColumn && timeIntent.window.kind !== "observation" && (
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
      )}

      <TimeMonthPickers
        singleColumn={singleColumn}
        kind={picker}
        latest={latest}
        onChange={applyChange}
        onClose={() => setPicker(undefined)}
        time={timeIntent}
      />
    </div>
  );
}
