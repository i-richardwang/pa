/**
 * 呈现设置分区。组件只负责图表能力，不决定编辑器面板的宽度、标题和底部动作。
 * 它嵌在统一的右侧 inspector 里，分两段（`section`）落在查询步前后——故自己不包容器，
 * 分区必须与查询步是同一层兄弟，「末节不画底线」才认得出整栏真正的最后一节。
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
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import { SERIES_COLORS } from "@charts";
import {
  type ChartSpecContext,
  normalizeTableLayout,
  type TableAxis,
  tableLayoutGrain,
} from "@chart-spec";
import { memberShortName } from "@member";
import { isSemanticDerivedView, type SemanticViewIntent } from "@semantic-analysis";
import type { SeriesPreferences, TableShadingPreferences } from "@view-preferences";
import { makeTitleOf, sensibleForms, type SensibleForm, tableShadingDefaults } from "@shape";
import { compileTimeIntent } from "@time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartTypeOption, ChartTypePicker } from "@/components/ui/chart-type-option";
import { ColorPill } from "@/components/ui/color-pill";
import {
  INSPECTOR_ROW_INDENT_CLASS,
  INSPECTOR_SECTION_CLASS,
  InspectorFieldGroup,
  InspectorFieldRow,
  InspectorRow,
  InspectorSection,
} from "@/components/ui/inspector";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { PopupSection } from "@/components/ui/surface";
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
  defaultSemanticViewIntent,
  semanticSummaryEnabled,
  semanticViewContext,
  setSemanticViewIntent,
  setSemanticSummary,
  setViewPreferences,
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

const SETTING_CONTENT_CLASS = cn(INSPECTOR_ROW_INDENT_CLASS, "px-0 md:px-0");

export function ChartSettingsPanel({
  draft,
  replay,
  onChange,
  catalog,
  section,
}: {
  draft: AnalysisEditState;
  replay: ReplayPayload;
  onChange: (draft: AnalysisEditState) => void;
  catalog: CatalogPayload;
  /** 图型条在栏顶（`type`），其余设置在查询步之后（`options`）。 */
  section: "type" | "options";
}) {
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const fieldId = useId();
  const showType = section === "type";
  const showOptions = section === "options";

  const resultView = replay.payload.view;
  const resultTitleOf = makeTitleOf(resultView);
  const semanticView = draft.analysis.views.find((view) => view.id === resultView.id) ?? null;
  const context = semanticView ? semanticViewContext(semanticView, catalog) : null;
  const titleOf = (member: string) =>
    [...catalog.measures, ...catalog.dimensions].find((item) => item.id === member)?.title ??
    resultTitleOf(member);
  const chart = draft.view;
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
  // 表格布局与服务端同一条规则：行列归属出自 normalizeTableLayout，面板只排版、只写回列轴声明。
  const tableSpec: ChartSpecContext = {
    measures,
    dimensions,
    ...(context?.time ? { time: compileTimeIntent(context.time) } : {}),
  };
  const tableGrain = tableLayoutGrain(tableSpec);
  const temporal = tableGrain !== "total";
  const tableLayout =
    chart.type === "table"
      ? normalizeTableLayout(chart.columns, tableSpec)
      : { rows: [] as TableAxis[], columns: [] as TableAxis[] };
  /** 列轴声明里的轴名：指标 / 时间 / 维度成员 id。 */
  const tableAxisName = (axis: TableAxis): string =>
    axis.kind === "field"
      ? (dimensions.find((member) => memberShortName(member) === axis.column) ?? axis.column)
      : axis.kind;
  const tableAxisLabel = (axis: string) =>
    axis === "time"
      ? tableGrain === "year"
        ? "年份"
        : "时间"
      : axis === "metrics"
        ? "指标"
        : titleOf(axis);
  const tableLayoutAxisLabel = (axis: TableAxis) =>
    axis.kind === "time"
      ? axis.level === "year"
        ? "年份"
        : axis.level === "month"
          ? "月份"
          : tableAxisLabel("time")
      : tableAxisLabel(tableAxisName(axis));
  const tableColumns = tableLayout.columns.map(tableAxisName);
  const tableAxisCandidates = [
    ...(measures.length ? ["metrics"] : []),
    ...(temporal ? ["time"] : []),
    ...(!summaryEnabled ? dimensions : []),
  ];
  const tableColumnSummary = tableLayout.columns.map(tableLayoutAxisLabel).join(" · ") || "选择";
  const tableRowSummary = tableLayout.rows.map(tableLayoutAxisLabel).join(" · ") || "无";
  const remainingTableAxes = tableAxisCandidates.filter((axis) => !tableColumns.includes(axis));
  const y = chart.type === "table" || chart.type === "kpi" ? [] : (chart.series ?? measures);
  const annotations =
    chart.type === "table" || chart.type === "kpi" ? [] : (chart.annotations ?? []);
  const series = draft.view_preferences.series ?? {};
  // 「显示」的三项各有各的前提；三项全不成立时**整节不出现**，不留一个空节题。
  // 节题是对内容的承诺，底下什么都没有时它就成了一道假分隔线。
  const canSplitSeries = (chart.type === "line" || chart.type === "bar") && dimensions.length > 1;

  // 饼图同理（扇区归属取值）。此时指标行只留「上不上轴」。
  const canStyleSeries = (chart.type === "line" || chart.type === "bar") && !chart.group_by;
  const valueLabelItems: Record<string, string> = {
    none: "不显示",
    main: "仅主指标",
    all: "全部",
  };
  const splitSeriesItems: Record<string, string> = {
    none: "不拆分",
    ...Object.fromEntries(dimensions.map((member) => [member, titleOf(member)])),
  };
  const canStack = chart.type === "bar" && Boolean(chart.group_by);
  const canValueLabels = chart.type === "line" || chart.type === "bar";
  const showDisplaySection = canSplitSeries || canStack || canSummarize || canValueLabels;

  const update = (next: SemanticViewIntent) =>
    onChange(setSemanticViewIntent(draft, next, catalog));
  const updateStyle = (next: AnalysisEditState["view_preferences"]) =>
    onChange(setViewPreferences(draft, next));

  const tableShading = chart.type === "table" ? draft.view_preferences.table_shading : undefined;
  const shadingStyle = !tableShading ? "none" : tableShading.values === false ? "colors" : "values";
  const setTableColumns = (columns: string[]) => {
    update({
      type: "table",
      ...(columns?.length ? { columns } : {}),
    });
  };
  const setTableShading = (table_shading: TableShadingPreferences | null) =>
    updateStyle({
      ...draft.view_preferences,
      table_shading: table_shading ?? undefined,
    });
  const setShading = (patch: Partial<TableShadingPreferences>) =>
    setTableShading({ palette: SERIES_COLORS[0], ...tableShading, ...patch });

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

  function setSeriesPreferences(member: string, patch: Partial<SeriesPreferences>) {
    if (chart.type !== "line" && chart.type !== "bar") return;
    updateStyle({
      ...draft.view_preferences,
      series: { ...series, [member]: { ...(series[member] ?? {}), ...patch } },
    });
  }

  return (
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
                        onClick={() => update(defaultSemanticViewIntent(draft, form, catalog))}
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
                    <PopoverPopup align="end" className="p-1.5" width="settings">
                      <Hint className="px-2 py-1.5">
                        从外到内决定交叉表列层次；未列入的维度留在行轴。
                      </Hint>
                      <div className="space-y-0.5">
                        {tableColumns.map((axis, index) => (
                          <InspectorRow
                            actions={
                              <>
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
                              </>
                            }
                            key={axis}
                            label={tableAxisLabel(axis)}
                          />
                        ))}
                      </div>
                      {remainingTableAxes.length > 0 ? (
                        <PopupSection label="加入列轴">
                          {remainingTableAxes.map((axis) => (
                            <InspectorRow
                              key={axis}
                              label={tableAxisLabel(axis)}
                              onClick={() => addTableColumn(axis)}
                            />
                          ))}
                        </PopupSection>
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
                    if (value === "none") setTableShading(null);
                    else if (value === "values" || value === "colors") {
                      setShading({ values: value === "values" ? undefined : false });
                    }
                  }}
                  value={shadingStyle}
                >
                  <InspectorRow label={<SelectLabel>着色</SelectLabel>}>
                    <SelectTrigger className={GHOST_SELECT_TRIGGER} size="sm" variant="ghost">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="none">不着色</SelectItem>
                      <SelectItem value="values">数值与颜色</SelectItem>
                      <SelectItem value="colors">仅颜色</SelectItem>
                    </SelectPopup>
                  </InspectorRow>
                </Select>
                {tableShading ? (
                  <InspectorRow label="配色">
                    <TableShadingSettings
                      defaults={tableShadingDefaults(resultView)}
                      onChange={setShading}
                      shading={tableShading}
                    />
                  </InspectorRow>
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
                    // 没显式选色时亮的是编译器给这条系列的那一色：色怎么分是编译期的事，
                    // 面板不另算一份色序
                    const intent = series[member] ?? {};
                    const color =
                      intent.color ??
                      replay.presentation.chart?.model.legend.find(
                        (item) => item.name === titleOf(member),
                      )?.color;
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
                                    onClick={() => setSeriesPreferences(member, { color: option })}
                                    selected={option === color}
                                  />
                                ))}
                              </div>
                            </div>
                            <Select
                              items={AXIS_ITEMS}
                              onValueChange={(value) => {
                                if (typeof value === "string" && value) {
                                  setSeriesPreferences(member, { axis: value });
                                }
                              }}
                              value={intent.axis ?? "left"}
                            >
                              <InspectorRow label={<SelectLabel>坐标轴</SelectLabel>}>
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
                              </InspectorRow>
                            </Select>
                            <Select
                              items={SERIES_FORM_ITEMS}
                              onValueChange={(value) => {
                                if (typeof value === "string" && value) {
                                  setSeriesPreferences(member, { mark: value });
                                }
                              }}
                              value={intent.mark ?? (chart.type === "line" ? "line" : "bar")}
                            >
                              <InspectorRow label={<SelectLabel>形态</SelectLabel>}>
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
                              </InspectorRow>
                            </Select>
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
                    <InspectorRow key={member} label={titleOf(member)}>
                      <Badge>自动</Badge>
                    </InspectorRow>
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
                        });
                      }}
                      value={chart.group_by ?? "none"}
                    >
                      <InspectorRow label={<SelectLabel>拆分系列</SelectLabel>}>
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
                      </InspectorRow>
                    </Select>
                  )}

                  {canStack ? (
                    <SwitchField
                      checked={chart.stack === true}
                      label="堆叠显示"
                      onCheckedChange={(checked) => update({ ...chart, stack: checked })}
                    />
                  ) : null}

                  {canValueLabels ? (
                    <Select
                      items={valueLabelItems}
                      onValueChange={(value) => {
                        if (chart.type !== "line" && chart.type !== "bar") return;
                        updateStyle({
                          ...draft.view_preferences,
                          value_labels: value === "main" || value === "all" ? value : undefined,
                        });
                      }}
                      value={
                        (chart.type === "line" || chart.type === "bar"
                          ? draft.view_preferences.value_labels
                          : undefined) ?? "none"
                      }
                    >
                      <InspectorRow label={<SelectLabel>显示数值</SelectLabel>}>
                        <SelectTrigger className={GHOST_SELECT_TRIGGER} size="sm" variant="ghost">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="none">不显示</SelectItem>
                          {/* 拆分系列没有「主指标」，这一档不出现（契约同判） */}
                          {chart.group_by ? null : <SelectItem value="main">仅主指标</SelectItem>}
                          <SelectItem value="all">全部</SelectItem>
                        </SelectPopup>
                      </InspectorRow>
                    </Select>
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
}
