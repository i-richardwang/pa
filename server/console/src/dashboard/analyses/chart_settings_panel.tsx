/** 成员 id 经目录或 makeTitleOf 转成中文标题后再显示。 */
import { useId, useState } from "react";
import {
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ChartColumnIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  FlagIcon,
  HashIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import { SERIES_COLORS } from "@charts";
import { type ChartSpecContext, normalizeTableColumns, type TableAxis } from "@chart-spec";
import { chartChannels, splitCandidates } from "@channels";
import { memberShortName } from "@member";
import { semanticResultView, type SemanticViewIntent } from "@semantic-analysis";
import type { SeriesPreferences, TableShadingPreferences } from "@view-preferences";
import {
  analyzeResultShape,
  type FormAvailability,
  formAvailability,
  makeTitleOf,
  resolveTableLayout,
  tableShadingDefaults,
} from "@shape";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartTypeOption, ChartTypePicker } from "@/components/ui/chart-type-option";
import { ColorPill } from "@/components/ui/color-pill";
import { INSPECTOR_SECTION_CLASS, InspectorRow, InspectorSection } from "@/components/ui/inspector";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { PopupSection } from "@/components/ui/surface";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectLabel,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  defaultSemanticViewIntent,
  isPreviewCurrent,
  semanticSummaryEnabled,
  semanticViewContext,
  setSemanticViewIntent,
  setSemanticSummary,
  setViewPreferences,
  type AnalysisEditState,
} from "./analysis_draft";
import { PRESENTATION_TYPE_LABELS } from "./presentation_labels";
import { TableShadingSettings } from "./table_shading_settings";

type Form = keyof typeof PRESENTATION_TYPE_LABELS;

const FORM_ICONS: Record<Form, React.ReactNode> = {
  table: <TableIcon />,
  kpi: <HashIcon />,
  line: <ChartLineIcon />,
  bar: <ChartColumnIcon />,
  pie: <ChartPieIcon />,
};

/** 图型按读图优先级排序：走势、比较、读数、明细、构成。 */
const FORM_ORDER: readonly Form[] = ["line", "bar", "kpi", "table", "pie"];

function unavailableText(availability: FormAvailability, label: string): string {
  if (availability.state !== "channels_unmet") return `当前结果无法用${label}显示`;
  return availability.measures === 0
    ? `${label}至少需要一个指标`
    : `${label}无法同时展示当前结果的 ${availability.dimensions} 个维度`;
}

const SERIES_FORM_ITEMS = { line: "折线", bar: "柱形" };
const SHADING_STYLE_ITEMS = { none: "不着色", values: "数值与颜色", colors: "仅颜色" };

const GHOST_SELECT_TRIGGER = "w-auto justify-end";

const SUMMARY_TOOLTIP = "总体沿用当前的筛选和时间粒度，去掉分组后重新计算。";

const ROWS_CONTENT_CLASS = "px-0 md:px-0";

/** `items` 同时供 SelectValue 显示已选标签和渲染下拉选项。 */
function SelectRow<K extends string>({
  label,
  items,
  value,
  onValueChange,
}: {
  label: string;
  items: Record<K, string>;
  value: K;
  onValueChange: (value: K) => void;
}) {
  const keys = Object.keys(items) as K[];
  return (
    <Select
      items={items}
      onValueChange={(next) => {
        if (typeof next === "string" && next) onValueChange(next as K);
      }}
      value={value}
    >
      <InspectorRow indent label={<SelectLabel>{label}</SelectLabel>}>
        <SelectTrigger className={GHOST_SELECT_TRIGGER} size="sm" variant="ghost">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {keys.map((key) => (
            <SelectItem key={key} value={key}>
              {items[key]}
            </SelectItem>
          ))}
        </SelectPopup>
      </InspectorRow>
    </Select>
  );
}

type PanelProps = {
  draft: AnalysisEditState;
  replay: ReplayPayload;
  onChange: (draft: AnalysisEditState) => void;
  catalog: CatalogPayload;
};

export function ChartTypeBar({ draft, replay, onChange, catalog }: PanelProps) {
  const resultView = replay.payload.view;
  return (
    <section className={INSPECTOR_SECTION_CLASS}>
      <ChartTypePicker>
        {FORM_ORDER.map((form) => {
          const availability = formAvailability(resultView, form);
          const allowed = availability.state === "available";
          const label = PRESENTATION_TYPE_LABELS[form];
          return (
            <Tooltip disableHoverablePopup key={form}>
              <TooltipTrigger render={<span className="inline-flex flex-1" />}>
                <ChartTypeOption
                  className="w-full"
                  disabled={!allowed}
                  icon={FORM_ICONS[form]}
                  label={label}
                  onClick={() =>
                    onChange(
                      setSemanticViewIntent(
                        draft,
                        defaultSemanticViewIntent(draft, form, catalog, resultView),
                        catalog,
                      ),
                    )
                  }
                  selected={draft.view.type === form}
                />
              </TooltipTrigger>
              <TooltipPopup>{allowed ? label : unavailableText(availability, label)}</TooltipPopup>
            </Tooltip>
          );
        })}
      </ChartTypePicker>
    </section>
  );
}

function TableOptionsPanel({ draft, replay, onChange, catalog }: PanelProps) {
  if (draft.view.type !== "table") return null;

  const resultView = replay.payload.view;
  const context = semanticViewContext(semanticResultView(draft.analysis), catalog);
  const measures = context?.measures ?? [];
  const dimensions = context?.dimensions ?? [];
  const resultTitleOf = makeTitleOf(resultView);
  const titleOf = (member: string) =>
    [...catalog.measures, ...catalog.dimensions].find((item) => item.id === member)?.title ??
    resultTitleOf(member);
  const summaryEnabled = semanticSummaryEnabled(draft);
  const tableSpec: ChartSpecContext = { measures, dimensions };
  const resultShape = analyzeResultShape(resultView);
  const tableLayout = resolveTableLayout(
    resultView,
    resultShape.detected,
    normalizeTableColumns(draft.view.columns, tableSpec),
  );
  const tableAxisName = (axis: TableAxis): string =>
    axis.kind === "field"
      ? (dimensions.find((member) => memberShortName(member) === axis.column) ?? axis.column)
      : axis.kind;
  const tableLayoutAxisLabel = (axis: TableAxis): string => {
    if (axis.kind === "metrics") return "指标";
    if (axis.kind === "field") return titleOf(tableAxisName(axis));
    return axis.level === "year" ? "年份" : axis.level === "month" ? "月份" : "时间";
  };
  const resolvedTimeAxis = [...tableLayout.rows, ...tableLayout.columns].find(
    (axis) => axis.kind === "time",
  );
  const tableAxisLabel = (name: string) =>
    name === "metrics"
      ? "指标"
      : name === "time"
        ? (resolvedTimeAxis && tableLayoutAxisLabel(resolvedTimeAxis)) || "时间"
        : titleOf(name);
  const tableColumns = tableLayout.columns.map(tableAxisName);
  const tableAxisCandidates = [
    ...(measures.length ? ["metrics"] : []),
    ...(resultShape.temporal ? ["time"] : []),
    ...(!summaryEnabled ? dimensions : []),
  ];
  const remainingTableAxes = tableAxisCandidates.filter((axis) => !tableColumns.includes(axis));
  const tableShading = draft.view_preferences.table_shading;
  const shadingStyle = !tableShading ? "none" : tableShading.values === false ? "colors" : "values";
  const update = (columns: string[]) =>
    onChange(
      setSemanticViewIntent(
        draft,
        { type: "table", ...(columns.length ? { columns } : {}) },
        catalog,
      ),
    );
  const setTableShading = (table_shading: TableShadingPreferences | null) =>
    onChange(
      setViewPreferences(draft, {
        ...draft.view_preferences,
        table_shading: table_shading ?? undefined,
      }),
    );
  const setShading = (patch: Partial<TableShadingPreferences>) =>
    setTableShading({ palette: SERIES_COLORS[0], ...tableShading, ...patch });
  const moveColumn = (axis: string, delta: -1 | 1) => {
    const index = tableColumns.indexOf(axis);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= tableColumns.length) return;
    const next = [...tableColumns];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    update(next);
  };
  const removeColumn = (axis: string) => {
    if (axis !== "metrics") update(tableColumns.filter((item) => item !== axis));
  };
  const addColumn = (axis: string) => {
    if (tableColumns.includes(axis)) return;
    const metricsIndex = tableColumns.indexOf("metrics");
    if (metricsIndex < 0) return update([...tableColumns, axis]);
    const next = [...tableColumns];
    next.splice(axis === "time" ? metricsIndex + 1 : metricsIndex, 0, axis);
    update(next);
  };
  const summarySwitch =
    measures.length && dimensions.length ? (
      <SwitchField
        checked={summaryEnabled}
        indent
        label="显示总体"
        tooltip={SUMMARY_TOOLTIP}
        onCheckedChange={(checked) => onChange(setSemanticSummary(draft, checked, catalog))}
      />
    ) : null;

  return (
    <>
      <InspectorSection contentClassName={ROWS_CONTENT_CLASS} icon={<TableIcon />} title="表格布局">
        <InspectorRow indent label="行轴">
          {tableLayout.rows.map(tableLayoutAxisLabel).join(" · ") || "无"}
        </InspectorRow>
        <InspectorRow indent label="列轴">
          <Popover>
            <PopoverTrigger
              render={
                <SelectButton
                  aria-label="列轴"
                  className={GHOST_SELECT_TRIGGER}
                  size="sm"
                  variant="ghost"
                >
                  {tableLayout.columns.map(tableLayoutAxisLabel).join(" · ") || "选择"}
                </SelectButton>
              }
            />
            <PopoverPopup align="end" className="p-1.5" width="settings">
              <Hint className="px-2 py-1.5">从外到内决定交叉表列层次；未列入的维度留在行轴。</Hint>
              <div className="space-y-0.5">
                {tableColumns.map((axis, index) => (
                  <InspectorRow
                    actions={
                      <>
                        <Button
                          aria-label={`上移${tableAxisLabel(axis)}`}
                          className="text-pa-muted"
                          disabled={index === 0}
                          onClick={() => moveColumn(axis, -1)}
                          size="icon-xs"
                          variant="subtle"
                        >
                          <ChevronUpIcon />
                        </Button>
                        <Button
                          aria-label={`下移${tableAxisLabel(axis)}`}
                          className="text-pa-muted"
                          disabled={index === tableColumns.length - 1}
                          onClick={() => moveColumn(axis, 1)}
                          size="icon-xs"
                          variant="subtle"
                        >
                          <ChevronDownIcon />
                        </Button>
                        {axis === "metrics" ? (
                          <span aria-hidden="true" className="size-6 shrink-0" />
                        ) : (
                          <Button
                            aria-label={`将${tableAxisLabel(axis)}移到行轴`}
                            className="text-pa-muted"
                            onClick={() => removeColumn(axis)}
                            size="icon-xs"
                            variant="subtle"
                          >
                            <XIcon />
                          </Button>
                        )}
                      </>
                    }
                    key={axis}
                    label={tableAxisLabel(axis)}
                  />
                ))}
              </div>
              {remainingTableAxes.length ? (
                <PopupSection label="加入列轴">
                  {remainingTableAxes.map((axis) => (
                    <InspectorRow
                      key={axis}
                      label={tableAxisLabel(axis)}
                      onClick={() => addColumn(axis)}
                    />
                  ))}
                </PopupSection>
              ) : summaryEnabled && dimensions.length ? (
                <Hint className="px-2 py-1.5">显示总体时，业务维度只能在行轴。</Hint>
              ) : null}
            </PopoverPopup>
          </Popover>
        </InspectorRow>
      </InspectorSection>
      <InspectorSection
        collapsible
        contentClassName={ROWS_CONTENT_CLASS}
        icon={<EyeIcon />}
        title="显示"
      >
        {summarySwitch}
        <SelectRow
          items={SHADING_STYLE_ITEMS}
          label="着色"
          onValueChange={(value) => {
            if (value === "none") setTableShading(null);
            else setShading({ values: value === "values" ? undefined : false });
          }}
          value={shadingStyle}
        />
        {tableShading ? (
          <InspectorRow indent label="配色">
            <TableShadingSettings
              defaults={tableShadingDefaults(resultView)}
              onChange={setShading}
              shading={tableShading}
            />
          </InspectorRow>
        ) : null}
      </InspectorSection>
    </>
  );
}

export function ChartOptionsPanel({ draft, replay, onChange, catalog }: PanelProps) {
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const fieldId = useId();

  const resultView = replay.payload.view;
  const resultTitleOf = makeTitleOf(resultView);
  const context = semanticViewContext(semanticResultView(draft.analysis), catalog);
  const titleOf = (member: string) =>
    [...catalog.measures, ...catalog.dimensions].find((item) => item.id === member)?.title ??
    resultTitleOf(member);
  const chart = draft.view;
  if (chart.type === "table") {
    return (
      <TableOptionsPanel catalog={catalog} draft={draft} onChange={onChange} replay={replay} />
    );
  }
  const measures = context?.measures ?? [];
  const dimensions = context?.dimensions ?? [];
  const canSummarize = measures.length > 0 && dimensions.length > 0;
  const summaryEnabled = semanticSummaryEnabled(draft);
  const secondarySeries =
    chart.type === "line" || chart.type === "bar" ? (chart.secondary_series ?? []) : [];
  const y =
    chart.type === "kpi"
      ? []
      : (chart.series ?? measures.filter((member) => !secondarySeries.includes(member)));
  const annotations = chart.type === "bar" ? (chart.annotations ?? []) : [];
  const splittable = chart.type === "line" || chart.type === "bar" ? chart : null;
  const stackable = chart.type === "bar" ? chart : null;
  const groupBy = splittable?.group_by;
  const series = draft.view_preferences.series ?? {};
  // 剩余维度必须占用拆分通道，因此没有「不拆分」选项；只有一个候选时不显示选择器。
  const splitOptions = splittable ? splitCandidates(splittable.type, { dimensions, measures }) : [];
  const canSplitSeries = splitOptions.length > 1;
  // 拆分系列后系列由维度取值决定，不提供逐指标的样式设置。
  const canStyleSeries = splittable !== null && !groupBy;
  // 系列所在坐标轴以编译结果为准（未声明副轴时按量纲分侧）；预览落后于草稿时只读声明。
  const previewChart = "chart" in replay.presentation ? replay.presentation.chart : null;
  const legendOf = (member: string) =>
    previewChart?.model.legend.find((item) => item.name === titleOf(member));
  const previewCurrent = isPreviewCurrent(draft);
  const axisOf = (member: string): 0 | 1 =>
    secondarySeries.includes(member) ? 1 : previewCurrent ? (legendOf(member)?.axis ?? 0) : 0;
  const plotted = measures.filter(
    (member) =>
      !annotations.includes(member) && (y.includes(member) || secondarySeries.includes(member)),
  );
  const offAxis = measures.filter(
    (member) => !annotations.includes(member) && !plotted.includes(member),
  );
  const dual = plotted.some((member) => axisOf(member) === 1);
  const leftCount = plotted.filter((member) => axisOf(member) === 0).length;
  const secondaryPossible =
    splittable !== null && !groupBy && chartChannels(splittable.type).scales === 2;
  const seriesGroups: { axis: 0 | 1 | null; caption?: string; members: string[] }[] = dual
    ? [
        { axis: 0, caption: "左轴", members: plotted.filter((member) => axisOf(member) === 0) },
        { axis: 1, caption: "右轴", members: plotted.filter((member) => axisOf(member) === 1) },
        { axis: null, members: offAxis },
      ]
    : [{ axis: 0, members: [...plotted, ...offAxis] }];
  const valueLabelItems: Record<string, string> = groupBy
    ? { none: "不显示", all: "全部" }
    : { none: "不显示", main: "仅主指标", all: "全部" };
  const splitSeriesItems: Record<string, string> = Object.fromEntries(
    splitOptions.map((member) => [member, titleOf(member)]),
  );
  const canStack = Boolean(stackable?.group_by);
  const canValueLabels = chart.type === "line" || chart.type === "bar";
  const showDisplaySection = canSplitSeries || canStack || canSummarize || canValueLabels;

  const update = (next: SemanticViewIntent) =>
    onChange(setSemanticViewIntent(draft, next, catalog));
  const updateStyle = (next: AnalysisEditState["view_preferences"]) =>
    onChange(setViewPreferences(draft, next));

  /** 副轴为空时不写 secondary_series，分侧回到按量纲的默认规则。 */
  function setScales(nextY: string[], nextY2: string[]) {
    if (chart.type !== "line" && chart.type !== "bar") return;
    if (!nextY.length) return;
    const { secondary_series: _dropped, ...rest } = chart;
    const next = { ...rest, series: nextY, ...(nextY2.length ? { secondary_series: nextY2 } : {}) };
    update(
      next.type === "bar"
        ? {
            ...next,
            annotations: annotations.filter(
              (item) => !nextY.includes(item) && !nextY2.includes(item),
            ),
          }
        : next,
    );
  }

  function setY(member: string) {
    if (chart.type === "kpi") return;
    if (chart.type === "pie") return update({ ...chart, series: [member] });
    if (secondarySeries.includes(member)) {
      return setScales(
        y,
        secondarySeries.filter((item) => item !== member),
      );
    }
    const next = y.includes(member) ? y.filter((item) => item !== member) : [...y, member];
    setScales(next, secondarySeries);
  }

  /** 按当前实际分侧重写两侧：未声明副轴时右侧成员来自量纲默认分侧，移轴后一并写成显式声明。 */
  function moveAxis(member: string, axis: 0 | 1) {
    const side = (target: 0 | 1) =>
      plotted.filter((item) => item !== member && axisOf(item) === target);
    if (axis === 1) setScales(side(0), [...side(1), member]);
    else setScales([...side(0), member], side(1));
  }

  function setSeriesPreferences(member: string, patch: Partial<SeriesPreferences>) {
    if (chart.type !== "line" && chart.type !== "bar") return;
    updateStyle({
      ...draft.view_preferences,
      series: { ...series, [member]: { ...(series[member] ?? {}), ...patch } },
    });
  }

  const summarySwitch = canSummarize ? (
    <SwitchField
      checked={summaryEnabled}
      indent
      label="显示总体"
      tooltip={SUMMARY_TOOLTIP}
      onCheckedChange={(checked) => onChange(setSemanticSummary(draft, checked, catalog))}
    />
  ) : null;

  if (chart.type === "kpi") {
    return (
      <InspectorSection icon={<ChartLineIcon />} title="系列">
        <p className="px-2 text-sm/4.5 text-pa-muted">指标卡展示当前结果唯一一行中的全部指标。</p>
      </InspectorSection>
    );
  }

  return (
    <>
      <InspectorSection contentClassName={ROWS_CONTENT_CLASS} icon={<ChartLineIcon />} title="系列">
        {seriesGroups.map((group) => (
          <div key={group.axis ?? "off"}>
            {group.caption ? <Hint className="px-2 pt-1.5">{group.caption}</Hint> : null}
            {group.members.map((member) => {
              const checked = y.includes(member) || secondarySeries.includes(member);
              // 默认颜色取自编译结果的图例，面板不另行计算。
              const intent = series[member] ?? {};
              const color = intent.color ?? legendOf(member)?.color;
              const styleable = canStyleSeries && checked;
              const open = styleable && expandedSeries === member;
              const controlId = `${fieldId}-y-${member}`;
              const onSecondary = axisOf(member) === 1;
              const canMove = styleable && (onSecondary || (secondaryPossible && leftCount > 1));
              return (
                <div key={member}>
                  <InspectorRow
                    actions={
                      styleable ? (
                        <>
                          {canMove ? (
                            <Button
                              aria-label={onSecondary ? "移到左轴" : "移到右轴"}
                              className="text-pa-muted"
                              onClick={() => moveAxis(member, onSecondary ? 0 : 1)}
                              size="icon-sm"
                              variant="subtle"
                            >
                              {onSecondary ? <ArrowLeftToLineIcon /> : <ArrowRightToLineIcon />}
                            </Button>
                          ) : null}
                          <Button
                            aria-label={open ? "收起系列设置" : "展开系列设置"}
                            className="text-pa-muted"
                            onClick={() => setExpandedSeries(open ? null : member)}
                            size="icon-sm"
                            variant="subtle"
                          >
                            {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                          </Button>
                        </>
                      ) : undefined
                    }
                    icon={
                      <Checkbox
                        checked={checked}
                        id={controlId}
                        onCheckedChange={() => setY(member)}
                      />
                    }
                    label={
                      <label className="cursor-pointer" htmlFor={controlId}>
                        {titleOf(member)}
                      </label>
                    }
                  />
                  {open ? (
                    <>
                      <InspectorRow indent label="颜色">
                        <span className="flex flex-wrap justify-end gap-1">
                          {SERIES_COLORS.map((option) => (
                            <ColorPill
                              aria-label={`${titleOf(member)} 颜色 ${option}`}
                              color={option}
                              key={option}
                              onClick={() => setSeriesPreferences(member, { color: option })}
                              selected={option === color}
                            />
                          ))}
                        </span>
                      </InspectorRow>
                      <SelectRow
                        items={SERIES_FORM_ITEMS}
                        label="图形"
                        onValueChange={(value) => setSeriesPreferences(member, { mark: value })}
                        value={
                          intent.mark ??
                          (onSecondary ? "line" : dual ? "bar" : (splittable?.type ?? "bar"))
                        }
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </InspectorSection>

      {chart.type === "bar" && annotations.length > 0 ? (
        <InspectorSection
          contentClassName={ROWS_CONTENT_CLASS}
          icon={<FlagIcon />}
          title="辅助标注"
        >
          {annotations.map((member) => (
            <InspectorRow indent key={member} label={titleOf(member)}>
              <Badge>自动</Badge>
            </InspectorRow>
          ))}
        </InspectorSection>
      ) : null}

      {showDisplaySection ? (
        <InspectorSection
          collapsible
          contentClassName={ROWS_CONTENT_CLASS}
          defaultExpanded={!!groupBy || stackable?.stack === true || summaryEnabled}
          icon={<EyeIcon />}
          title="显示"
        >
          {splittable && canSplitSeries ? (
            <SelectRow
              items={splitSeriesItems}
              label="拆分系列"
              onValueChange={(value) => update({ ...splittable, group_by: value })}
              value={groupBy ?? splitOptions[0]}
            />
          ) : null}

          {stackable && canStack ? (
            <SwitchField
              checked={stackable.stack === true}
              indent
              label="堆叠显示"
              onCheckedChange={(checked) => update({ ...stackable, stack: checked })}
            />
          ) : null}

          {canValueLabels ? (
            <SelectRow
              items={valueLabelItems}
              label="显示数值"
              onValueChange={(value) =>
                updateStyle({
                  ...draft.view_preferences,
                  value_labels: value === "main" || value === "all" ? value : undefined,
                })
              }
              value={draft.view_preferences.value_labels ?? "none"}
            />
          ) : null}

          {summarySwitch}
        </InspectorSection>
      ) : null}
    </>
  );
}
