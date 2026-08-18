/**
 * 呈现设置分区。组件只负责图表能力，不决定编辑器面板的宽度、标题和底部动作。
 * `embedded` 用于把内容嵌入统一的右侧 inspector；保留独立渲染能力方便局部测试和复用。
 *
 * **成员名恒经 makeTitleOf 翻成中文标题后才上屏**——出现限定名即违规。
 */
import { useId, useState } from "react";
import {
  ChartColumnIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  EyeIcon,
  FlagIcon,
  HashIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import type { CatalogPayload, ReplayPayload } from "@contract";
import { SERIES_COLORS } from "@charts";
import {
  isSemanticDerivedView,
  type SemanticChart,
  type TableShadingDecl,
} from "@semantic-analysis";
import { makeTitleOf, sensibleForms, type SensibleForm, tableShadingDefaults } from "@shape";
import { compileTimeIntent, resolveTimeOutputGrain } from "@time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartTypeOption, ChartTypePicker } from "@/components/ui/chart-type-option";
import { ColorPill } from "@/components/ui/color-pill";
import {
  INSPECTOR_MEMBER_INSET_CLASS,
  INSPECTOR_SECTION_CLASS,
  InspectorFieldGroup,
  InspectorFieldRow,
  InspectorOptionRow,
  InspectorSection,
} from "@/components/ui/inspector";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { POPUP_GROUP_LABEL } from "@/components/ui/surface";
import {
  Select,
  SelectItem,
  SelectLabel,
  SelectPopup,
  selectTriggerIconClassName,
  selectTriggerVariants,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SwitchField } from "@/components/ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  defaultSemanticChart,
  semanticChart,
  semanticSummaryEnabled,
  semanticViewContext,
  setSemanticChart,
  setSemanticSummary,
  type AnalysisEditState,
} from "./analysis_draft";
import { TableShadingSettings } from "./table_shading_settings";

const FORM_META: Record<SensibleForm, { label: string; icon: React.ReactNode }> = {
  table: { label: "表格", icon: <TableIcon /> },
  kpi: { label: "指标卡", icon: <HashIcon /> },
  line: { label: "折线图", icon: <ChartLineIcon /> },
  bar: { label: "柱状图", icon: <ChartColumnIcon /> },
  pie: { label: "饼图", icon: <ChartPieIcon /> },
};

/** 图型排序按读图优先级：走势、比较、读数、明细，再到构成。 */
const FORM_ORDER: readonly SensibleForm[] = ["line", "bar", "kpi", "table", "pie"];

/**
 * 幽灵下拉的**闭合态取值表**。Base UI 的 `Select.Value` 只在 Root 拿到 `items` 时
 * 才知道一个值该显示成什么字；不给它，闭合态印的就是枚举值本身——「坐标轴 left」
 * 「形态 line」，甚至在「拆分系列」那行印出维度限定名，即成员名上屏违规。
 */
const AXIS_ITEMS = { left: "左轴", right: "右轴" };
const SERIES_FORM_ITEMS = { line: "折线", bar: "柱形" };
const SHADING_STYLE_ITEMS = { none: "不着色", values: "数值与颜色", colors: "仅颜色" };

const GHOST_SELECT_TRIGGER = "w-auto justify-end";

const SUMMARY_TOOLTIP = "总体保留当前筛选与时间粒度，并由数据模型去掉业务分组后重新计算。";

const SETTING_CONTENT_CLASS = cn(INSPECTOR_MEMBER_INSET_CLASS, "px-0 md:px-0");

function selectedChart(
  draft: AnalysisEditState,
  _replay: ReplayPayload,
  _catalog: CatalogPayload,
): SemanticChart {
  return semanticChart(draft);
}

export function ChartSettingsPanel({
  draft,
  replay,
  onChange,
  catalog,
  embedded = false,
  section = "all",
}: {
  draft: AnalysisEditState;
  replay: ReplayPayload;
  onChange: (draft: AnalysisEditState) => void;
  catalog: CatalogPayload;
  /** 作为统一 inspector 的内容区渲染时，不创建第二个滚动容器。 */
  embedded?: boolean;
  /**
   * 图型条在栏顶，其余设置在查询步之后。
   * `type` / `options` 拆开以便嵌入同一滚动上下文的不同位置。
   */
  section?: "all" | "type" | "options";
}) {
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const fieldId = useId();
  const showType = section === "all" || section === "type";
  const showOptions = section === "all" || section === "options";

  const resultView = replay.payload.view;
  const resultTitleOf = makeTitleOf(resultView);
  const semanticView = draft.spec.analysis.views.find((view) => view.id === resultView.id) ?? null;
  const context = semanticView ? semanticViewContext(semanticView, catalog) : null;
  const titleOf = (member: string) =>
    [...catalog.measures, ...catalog.dimensions].find((item) => item.id === member)?.title ??
    resultTitleOf(member);
  const chart = selectedChart(draft, replay, catalog);
  const forms = new Set(sensibleForms(resultView));
  const measures = context?.measures ?? [];
  const dimensions = context?.dimensions ?? [];
  const canSummarize = measures.length > 0 && dimensions.length > 0;
  const summaryEnabled = semanticSummaryEnabled(draft);
  // 构成占比自带各类合计（各类之和就是 100%），模型层不许再叠一行总体：这条闸在这里就灰给人看，
  // 不等点开关时才被拒。
  const summaryBlocked =
    semanticView && !isSemanticDerivedView(semanticView) && semanticView.calculations?.length
      ? "已有构成占比，各类合计就是总体"
      : undefined;
  const resolvedGrain = context?.time
    ? (resultView.time?.grain ??
      resolveTimeOutputGrain(compileTimeIntent(context.time), catalog.data_as_of, {
        grouped: dimensions.length > 0,
      }))
    : undefined;
  const temporal = resolvedGrain !== undefined && resolvedGrain !== "total";
  const defaultTableColumns = [
    ...(measures.length ? ["metrics"] : []),
    ...(temporal ? ["time"] : []),
  ];
  const tableColumns =
    chart.type === "table"
      ? chart.columns
        ? (() => {
            const columns = [...chart.columns];
            if (measures.length && !columns.includes("metrics")) {
              const timeIndex = columns.indexOf("time");
              columns.splice(timeIndex < 0 ? columns.length : timeIndex, 0, "metrics");
            }
            return columns;
          })()
        : defaultTableColumns
      : [];
  const tableAxisCandidates = [
    ...(measures.length ? ["metrics"] : []),
    ...(temporal ? ["time"] : []),
    ...(!summaryEnabled ? dimensions : []),
  ];
  const tableAxisLabel = (axis: string) =>
    axis === "time"
      ? resolvedGrain === "year"
        ? "年份"
        : "时间"
      : axis === "metrics"
        ? "指标"
        : titleOf(axis);
  const tableColumnSummary = tableColumns.map(tableAxisLabel).join(" · ") || "选择";
  const tableRowSummary =
    [
      ...dimensions.filter((member) => !tableColumns.includes(member)).map(titleOf),
      ...(temporal && !tableColumns.includes("time") ? ["时间"] : []),
    ].join(" · ") || "无";
  const remainingTableAxes = tableAxisCandidates.filter((axis) => !tableColumns.includes(axis));
  const y = chart.type === "table" || chart.type === "kpi" ? [] : (chart.series ?? measures);
  const annotations =
    chart.type === "table" || chart.type === "kpi" ? [] : (chart.annotations ?? []);
  const series = chart.display?.series ?? {};
  // 「显示」的三项各有各的前提；三项全不成立时**整节不出现**，不留一个空节题。
  // 节题是对内容的承诺，底下什么都没有时它就成了一道假分隔线。
  const canSplitSeries = (chart.type === "line" || chart.type === "bar") && dimensions.length > 1;

  // 饼图同理（扇区归属取值）。此时指标行只留「上不上轴」。
  const canStyleSeries = (chart.type === "line" || chart.type === "bar") && !chart.group_by;
  const splitSeriesItems: Record<string, string> = {
    none: "不拆分",
    ...Object.fromEntries(dimensions.map((member) => [member, titleOf(member)])),
  };
  const canStack = chart.type === "bar" && Boolean(chart.group_by);
  const showDisplaySection = canSplitSeries || canStack || canSummarize;

  const update = (next: SemanticChart) => onChange(setSemanticChart(draft, next, catalog));

  const tableShading = chart.type === "table" ? chart.shading : undefined;
  const shadingStyle = !tableShading ? "none" : tableShading.values === false ? "colors" : "values";
  const setTable = (patch: { columns?: string[]; shading?: TableShadingDecl | null }) => {
    const columns = patch.columns ?? (chart.type === "table" ? chart.columns : undefined);
    const shading = patch.shading === undefined ? tableShading : (patch.shading ?? undefined);
    update({
      type: "table",
      ...(columns?.length ? { columns } : {}),
      ...(shading ? { shading } : {}),
    });
  };
  const setTableColumns = (columns: string[]) => setTable({ columns });
  const setShading = (patch: Partial<TableShadingDecl>) =>
    setTable({ shading: { palette: SERIES_COLORS[0], ...tableShading, ...patch } });

  function moveTableColumn(axis: string, delta: -1 | 1) {
    const index = tableColumns.indexOf(axis);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= tableColumns.length) return;
    const next = [...tableColumns];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setTableColumns(next);
  }

  function removeTableColumn(axis: string) {
    if (axis === "metrics") return;
    setTableColumns(tableColumns.filter((item) => item !== axis));
  }

  function addTableColumn(axis: string) {
    if (tableColumns.includes(axis)) return;
    const metricsIndex = tableColumns.indexOf("metrics");
    if (metricsIndex >= 0) {
      const next = [...tableColumns];
      next.splice(axis === "time" ? metricsIndex + 1 : metricsIndex, 0, axis);
      setTableColumns(next);
      return;
    }
    setTableColumns([...tableColumns, axis]);
  }

  function setY(member: string) {
    if (chart.type === "table" || chart.type === "kpi") return;
    const next = y.includes(member) ? y.filter((item) => item !== member) : [...y, member];
    if (!next.length) return;
    update({
      ...chart,
      series: chart.type === "pie" ? [member] : next,
      annotations: annotations.filter((item) => item !== member),
    });
  }

  function setDisplay(member: string, patch: Record<string, unknown>) {
    if (chart.type !== "line" && chart.type !== "bar") return;
    update({
      ...chart,
      display: { series: { ...series, [member]: { ...(series[member] ?? {}), ...patch } } },
    });
  }

  // 嵌入 inspector 时**不包裹任何容器**：分区必须与查询步是同一层兄弟，
  // 「末节不画底线」才认得出整栏真正的最后一节。包一层的后果是每个包裹各自算一次「末节」，
  // 图型条明明后面还有内容却把底线抹掉了。
  const body = (
    <>
      {/* 图型条紧贴栏顶（在查询步之前），无「图表类型」节题。 */}
      {showType ? (
        <section className={INSPECTOR_SECTION_CLASS}>
          <div>
            <ChartTypePicker>
              {FORM_ORDER.map((form) => {
                const allowed = forms.has(form);
                const label = FORM_META[form].label;
                return (
                  <Tooltip disableHoverablePopup key={form}>
                    <TooltipTrigger render={<span className="inline-flex flex-1" />}>
                      <ChartTypeOption
                        className="w-full"
                        disabled={!allowed}
                        icon={FORM_META[form].icon}
                        label={label}
                        onClick={() => update(defaultSemanticChart(draft, form, catalog))}
                        selected={chart.type === form}
                      />
                    </TooltipTrigger>
                    <TooltipPopup>{allowed ? label : `${label}不适用于当前结果`}</TooltipPopup>
                  </Tooltip>
                );
              })}
            </ChartTypePicker>
          </div>
        </section>
      ) : null}

      {showOptions ? (
        chart.type === "table" ? (
          <>
            <InspectorSection contentClassName="px-0 md:px-0" icon={<TableIcon />} title="表格布局">
              {/*
              列轴是 PA 的交叉表契约——有序多层轴，不是单维列。
              摘要行打开浮层：排序、移出行轴、加入列轴。
            */}
              <InspectorFieldGroup>
                <InspectorFieldRow label="行轴">
                  {/*
                    行轴是列轴的余数，只回显不可点。字色取 pa-muted 与右侧可点的列轴值分开：
                    同一个盒子里两行长得一样、一行能点一行不能，是最省力的误导。
                  */}
                  <span className="min-w-0 flex-1 truncate px-1.5 text-right text-sm leading-5 text-pa-muted">
                    {tableRowSummary}
                  </span>
                </InspectorFieldRow>
                <InspectorFieldRow label="列轴">
                  <Popover>
                    {/* 它是自绘的取值触发件，形仍取选择器那一份，不在这里另配一套 */}
                    <PopoverTrigger
                      className={cn(
                        selectTriggerVariants({ size: "sm", variant: "ghost" }),
                        GHOST_SELECT_TRIGGER,
                        "w-full",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-right">
                        {tableColumnSummary}
                      </span>
                      <ChevronsUpDownIcon className={selectTriggerIconClassName} />
                    </PopoverTrigger>
                    <PopoverPopup align="end" className="w-64 p-1">
                      <Hint className="px-2 py-1.5">
                        从外到内决定交叉表列层次；未列入的维度留在行轴。
                      </Hint>
                      <div className="space-y-0.5">
                        {tableColumns.map((axis, index) => (
                          <div
                            className="flex min-h-8 items-center gap-0.5 rounded-md px-0.5 hover:bg-pa-surface"
                            key={axis}
                          >
                            <span className="min-w-0 flex-1 truncate px-1.5 text-sm leading-5 text-pa-ink">
                              {tableAxisLabel(axis)}
                            </span>
                            <Button
                              aria-label={`上移${tableAxisLabel(axis)}`}
                              className="text-pa-muted"
                              disabled={index === 0}
                              onClick={() => moveTableColumn(axis, -1)}
                              size="icon-xs"
                              variant="subtle"
                            >
                              <ChevronUpIcon />
                            </Button>
                            <Button
                              aria-label={`下移${tableAxisLabel(axis)}`}
                              className="text-pa-muted"
                              disabled={index === tableColumns.length - 1}
                              onClick={() => moveTableColumn(axis, 1)}
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
                                onClick={() => removeTableColumn(axis)}
                                size="icon-xs"
                                variant="subtle"
                              >
                                <XIcon />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      {remainingTableAxes.length > 0 ? (
                        <>
                          <div className="my-1 h-px bg-pa-line" />
                          <p className={POPUP_GROUP_LABEL}>加入列轴</p>
                          {remainingTableAxes.map((axis) => (
                            <button
                              className="flex min-h-8 w-full items-center rounded-md px-2 text-left text-sm leading-5 text-pa-ink hover:bg-pa-surface"
                              key={axis}
                              onClick={() => addTableColumn(axis)}
                              type="button"
                            >
                              {tableAxisLabel(axis)}
                            </button>
                          ))}
                        </>
                      ) : summaryEnabled && dimensions.length > 0 ? (
                        <Hint className="px-2 py-1.5">显示总体时，业务维度只能在行轴。</Hint>
                      ) : null}
                    </PopoverPopup>
                  </Popover>
                </InspectorFieldRow>
              </InspectorFieldGroup>
            </InspectorSection>
            <InspectorSection
              collapsible
              contentClassName={SETTING_CONTENT_CLASS}
              icon={<EyeIcon />}
              title="显示"
            >
              <div className="space-y-0.5">
                {canSummarize ? (
                  <SwitchField
                    blocked={summaryBlocked}
                    checked={summaryEnabled}
                    label="显示总体"
                    tooltip={SUMMARY_TOOLTIP}
                    onCheckedChange={(checked) =>
                      onChange(setSemanticSummary(draft, checked, catalog))
                    }
                  />
                ) : null}
                <Select
                  items={SHADING_STYLE_ITEMS}
                  onValueChange={(value) => {
                    if (value === "none") setTable({ shading: null });
                    else if (value === "values" || value === "colors") {
                      setShading({ values: value === "values" ? undefined : false });
                    }
                  }}
                  value={shadingStyle}
                >
                  <InspectorOptionRow label={<SelectLabel>着色</SelectLabel>}>
                    <SelectTrigger className={GHOST_SELECT_TRIGGER} size="sm" variant="ghost">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="none">不着色</SelectItem>
                      <SelectItem value="values">数值与颜色</SelectItem>
                      <SelectItem value="colors">仅颜色</SelectItem>
                    </SelectPopup>
                  </InspectorOptionRow>
                </Select>
                {tableShading ? (
                  <InspectorOptionRow label="配色">
                    <TableShadingSettings
                      defaults={tableShadingDefaults(resultView)}
                      onChange={setShading}
                      shading={tableShading}
                    />
                  </InspectorOptionRow>
                ) : null}
              </div>
            </InspectorSection>
          </>
        ) : chart.type === "kpi" ? (
          <InspectorSection icon={<ChartLineIcon />} title="系列">
            <p className="px-2 text-sm/4.5 text-pa-muted">
              指标卡展示当前结果唯一一行中的全部指标。
            </p>
          </InspectorSection>
        ) : (
          <>
            <InspectorSection contentClassName="px-0 md:px-0" icon={<ChartLineIcon />} title="系列">
              <div className="space-y-0.5 pl-3">
                {measures
                  .filter((member) => !annotations.includes(member))
                  .map((member) => {
                    const checked = y.includes(member);
                    // 色序取自它在 Y 轴上的位次，不是行位次——否则勾掉一个指标会让
                    // 它下面所有系列的颜色跟着挪一格。
                    const axisIndex = y.indexOf(member);
                    const intent = series[member] ?? {};
                    const color =
                      intent.color ?? SERIES_COLORS[Math.max(axisIndex, 0) % SERIES_COLORS.length];
                    const styleable = canStyleSeries && checked;
                    const open = styleable && expandedSeries === member;
                    return (
                      <div key={member}>
                        <div className="flex min-h-8 items-center gap-2">
                          <Checkbox
                            checked={checked}
                            id={`${fieldId}-y-${member}`}
                            onCheckedChange={() => setY(member)}
                          />
                          <label
                            className="min-w-0 flex-1 cursor-pointer truncate text-sm text-pa-ink"
                            htmlFor={`${fieldId}-y-${member}`}
                          >
                            {titleOf(member)}
                          </label>
                          {styleable ? (
                            <Button
                              aria-label={open ? "收起系列设置" : "展开系列设置"}
                              className="text-pa-muted"
                              onClick={() => setExpandedSeries(open ? null : member)}
                              size="icon-sm"
                              variant="subtle"
                            >
                              {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                            </Button>
                          ) : null}
                        </div>
                        {open && (
                          <div className="space-y-0.5 pb-1 pl-7">
                            <div>
                              <span className="flex min-h-8 items-center text-sm leading-4 text-pa-muted">
                                颜色
                              </span>
                              <div className="flex justify-between py-1">
                                {SERIES_COLORS.map((option) => (
                                  <ColorPill
                                    aria-label={`${titleOf(member)} 颜色 ${option}`}
                                    color={option}
                                    key={option}
                                    onClick={() => setDisplay(member, { color: option })}
                                    selected={option === color}
                                    size="sm"
                                  />
                                ))}
                              </div>
                            </div>
                            <Select
                              items={AXIS_ITEMS}
                              onValueChange={(value) => {
                                if (typeof value === "string" && value) {
                                  setDisplay(member, { yAxis: value });
                                }
                              }}
                              value={intent.yAxis ?? "left"}
                            >
                              <InspectorOptionRow label={<SelectLabel>坐标轴</SelectLabel>}>
                                <SelectTrigger
                                  className={GHOST_SELECT_TRIGGER}
                                  size="sm"
                                  variant="ghost"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectPopup>
                                  <SelectItem value="left">左轴</SelectItem>
                                  <SelectItem value="right">右轴</SelectItem>
                                </SelectPopup>
                              </InspectorOptionRow>
                            </Select>
                            <Select
                              items={SERIES_FORM_ITEMS}
                              onValueChange={(value) => {
                                if (typeof value === "string" && value) {
                                  setDisplay(member, { type: value });
                                }
                              }}
                              value={intent.type ?? chart.type}
                            >
                              <InspectorOptionRow label={<SelectLabel>形态</SelectLabel>}>
                                <SelectTrigger
                                  className={GHOST_SELECT_TRIGGER}
                                  size="sm"
                                  variant="ghost"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectPopup>
                                  <SelectItem value="line">折线</SelectItem>
                                  <SelectItem value="bar">柱形</SelectItem>
                                </SelectPopup>
                              </InspectorOptionRow>
                            </Select>
                            <SwitchField
                              checked={intent.label === true}
                              label="显示数值标签"
                              onCheckedChange={(checked) => setDisplay(member, { label: checked })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </InspectorSection>

            {chart.type === "bar" && annotations.length > 0 && (
              <InspectorSection
                contentClassName={SETTING_CONTENT_CLASS}
                icon={<FlagIcon />}
                title="辅助标注"
              >
                <div className="space-y-0.5">
                  {annotations.map((member) => (
                    <InspectorOptionRow key={member} label={titleOf(member)}>
                      <Badge>自动</Badge>
                    </InspectorOptionRow>
                  ))}
                </div>
              </InspectorSection>
            )}

            {/* 灰标签行直接堆叠，不各自再套一套重表单块。 */}
            {showDisplaySection ? (
              <InspectorSection
                collapsible
                contentClassName={SETTING_CONTENT_CLASS}
                defaultExpanded={!!chart.group_by || chart.stack === true || summaryEnabled}
                icon={<EyeIcon />}
                title="显示"
              >
                <div className="space-y-0.5">
                  {canSplitSeries && (
                    <Select
                      items={splitSeriesItems}
                      onValueChange={(value) => {
                        const raw = typeof value === "string" ? value : "";
                        const groupBy = !raw || raw === "none" ? undefined : raw;
                        update({
                          ...chart,
                          series: groupBy ? y.slice(0, 1) : y,
                          group_by: groupBy,
                          ...(groupBy ? { display: undefined } : {}),
                        });
                      }}
                      value={chart.group_by ?? "none"}
                    >
                      <InspectorOptionRow label={<SelectLabel>拆分系列</SelectLabel>}>
                        <SelectTrigger className={GHOST_SELECT_TRIGGER} size="sm" variant="ghost">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="none">不拆分</SelectItem>
                          {dimensions
                            .filter((member) => member !== chart.category)
                            .map((member) => (
                              <SelectItem key={member} value={member}>
                                {titleOf(member)}
                              </SelectItem>
                            ))}
                        </SelectPopup>
                      </InspectorOptionRow>
                    </Select>
                  )}

                  {canStack ? (
                    <SwitchField
                      checked={chart.stack === true}
                      label="堆叠显示"
                      onCheckedChange={(checked) => update({ ...chart, stack: checked })}
                    />
                  ) : null}

                  {canSummarize ? (
                    <SwitchField
                      blocked={summaryBlocked}
                      checked={summaryEnabled}
                      label="显示总体"
                      tooltip={SUMMARY_TOOLTIP}
                      onCheckedChange={(checked) =>
                        onChange(setSemanticSummary(draft, checked, catalog))
                      }
                    />
                  ) : null}
                </div>
              </InspectorSection>
            ) : null}
          </>
        )
      ) : null}
    </>
  );

  if (embedded) return body;
  return (
    <div
      className="flex flex-col"
      data-slot="chart-settings-sidebar"
      data-testid="chart-settings-sidebar"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-6">{body}</div>
    </div>
  );
}
