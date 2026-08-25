/** 成员名恒经 makeTitleOf 翻成中文标题后才上屏。 */
import { useId, useState } from "react";
import {
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
import { splitCandidates } from "@channels";
import { memberShortName } from "@member";
import { isSemanticDerivedView, type SemanticViewIntent } from "@semantic-analysis";
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
  semanticSummaryEnabled,
  semanticViewContext,
  setSemanticViewIntent,
  setSemanticSummary,
  setViewPreferences,
  type AnalysisEditState,
} from "./analysis_draft";
import { PRESENTATION_TYPE_LABELS } from "./presentation_labels";
import { TableShadingSettings } from "./table_shading_settings";

/** 图型全集即标签表的键：形态名只在标签表登记一次。 */
type Form = keyof typeof PRESENTATION_TYPE_LABELS;

const FORM_ICONS: Record<Form, React.ReactNode> = {
  table: <TableIcon />,
  kpi: <HashIcon />,
  line: <ChartLineIcon />,
  bar: <ChartColumnIcon />,
  pie: <ChartPieIcon />,
};

/** 图型排序按读图优先级：走势、比较、读数、明细，再到构成。 */
const FORM_ORDER: readonly Form[] = ["line", "bar", "kpi", "table", "pie"];

/** 不可选时说清卡在哪一关；事实出自 formAvailability，这里只写给人看的话。 */
function unavailableText(availability: FormAvailability, label: string): string {
  if (availability.state !== "channels_unmet") return `当前结果的形态不支持${label}`;
  return availability.measures === 0
    ? `${label}至少需要一个指标`
    : `${label}的通道装不下当前结果的 ${availability.dimensions} 个维度`;
}

const AXIS_ITEMS = { left: "左轴", right: "右轴" };
const SERIES_FORM_ITEMS = { line: "折线", bar: "柱形" };
const SHADING_STYLE_ITEMS = { none: "不着色", values: "数值与颜色", colors: "仅颜色" };

const GHOST_SELECT_TRIGGER = "w-auto justify-end";

const SUMMARY_TOOLTIP = "总体保留当前筛选与时间粒度，并由数据模型去掉业务分组后重新计算。";

const ROWS_CONTENT_CLASS = "px-0 md:px-0";

/** `items` 同时是闭合态取值表与下拉面的行，每个标签只写一次。 */
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

export function ChartOptionsPanel({ draft, replay, onChange, catalog }: PanelProps) {
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const fieldId = useId();

  const resultView = replay.payload.view;
  const resultTitleOf = makeTitleOf(resultView);
  const semanticView = draft.analysis.views.find((view) => view.id === resultView.id) ?? null;
  const context = semanticView ? semanticViewContext(semanticView, catalog) : null;
  const titleOf = (member: string) =>
    [...catalog.measures, ...catalog.dimensions].find((item) => item.id === member)?.title ??
    resultTitleOf(member);
  const chart = draft.view;
  const measures = context?.measures ?? [];
  const dimensions = context?.dimensions ?? [];
  const canSummarize = measures.length > 0 && dimensions.length > 0;
  const summaryEnabled = semanticSummaryEnabled(draft);
  // 构成占比自带各类合计，模型层不许再叠总体。
  const summaryBlocked =
    semanticView && !isSemanticDerivedView(semanticView) && semanticView.calculations?.length
      ? "已有构成占比，各类合计就是总体"
      : undefined;
  // 表格布局与服务端同一条规则：轴的归属出自 resolveTableLayout，面板只排版、只写回列轴声明。
  const tableSpec: ChartSpecContext = { measures, dimensions };
  const resultShape = analyzeResultShape(resultView);
  const temporal = resultShape.temporal;
  const tableLayout =
    chart.type === "table"
      ? resolveTableLayout(
          resultView,
          resultShape.detected,
          normalizeTableColumns(chart.columns, tableSpec),
        )
      : { rows: [] as TableAxis[], columns: [] as TableAxis[] };
  /** 列轴声明里的轴名：指标 / 时间 / 维度成员 id。 */
  const tableAxisName = (axis: TableAxis): string =>
    axis.kind === "field"
      ? (dimensions.find((member) => memberShortName(member) === axis.column) ?? axis.column)
      : axis.kind;
  /** 轴名即表头名：层级出自解析后的布局，与渲染出的表头同一套说法。 */
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
    ...(temporal ? ["time"] : []),
    ...(!summaryEnabled ? dimensions : []),
  ];
  const tableColumnSummary = tableLayout.columns.map(tableLayoutAxisLabel).join(" · ") || "选择";
  const tableRowSummary = tableLayout.rows.map(tableLayoutAxisLabel).join(" · ") || "无";
  const remainingTableAxes = tableAxisCandidates.filter((axis) => !tableColumns.includes(axis));
  const y = chart.type === "table" || chart.type === "kpi" ? [] : (chart.series ?? measures);
  const annotations = chart.type === "bar" ? (chart.annotations ?? []) : [];
  // 拆分与堆叠只属于声明了这两个通道的图型；收窄一次，后面的读写都用它。
  const splittable = chart.type === "line" || chart.type === "bar" ? chart : null;
  const stackable = chart.type === "bar" ? chart : null;
  const groupBy = splittable?.group_by;
  const series = draft.view_preferences.series ?? {};
  // 「显示」的各项各有各的前提；全不成立时**整节不出现**，不留一个空节题。
  // 拆分通道的取值不是偏好而是装箱的结果：余数维度必须上通道，所以没有「不拆分」；
  // 候选只有一个即无可选之事，不出选择器。
  const splitOptions = splittable ? splitCandidates(splittable.type, { dimensions, measures }) : [];
  const canSplitSeries = splitOptions.length > 1;
  // 饼图的扇区归属即取值，没有逐系列样式；此时指标行只留「上不上轴」。
  const canStyleSeries = splittable !== null && !groupBy;
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
    if (chart.type === "pie") return update({ ...chart, series: [member] });
    if (chart.type === "bar") {
      return update({
        ...chart,
        series: next,
        annotations: annotations.filter((item) => item !== member),
      });
    }
    update({ ...chart, series: next });
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
      blocked={summaryBlocked}
      checked={summaryEnabled}
      indent
      label="显示总体"
      tooltip={SUMMARY_TOOLTIP}
      onCheckedChange={(checked) => onChange(setSemanticSummary(draft, checked, catalog))}
    />
  ) : null;

  if (chart.type === "table") {
    return (
      <>
        <InspectorSection
          contentClassName={ROWS_CONTENT_CLASS}
          icon={<TableIcon />}
          title="表格布局"
        >
          {/* 列轴是 PA 的交叉表契约——有序多层轴，不是单维列；行轴是它的余数，只回显。 */}
          <InspectorRow indent label="行轴">
            {tableRowSummary}
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
                    {tableColumnSummary}
                  </SelectButton>
                }
              />
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
        {measures
          .filter((member) => !annotations.includes(member))
          .map((member) => {
            const checked = y.includes(member);
            // 色序出自编译期，面板不另算一份。
            const intent = series[member] ?? {};
            const color =
              intent.color ??
              replay.presentation.chart?.model.legend.find((item) => item.name === titleOf(member))
                ?.color;
            const styleable = canStyleSeries && checked;
            const open = styleable && expandedSeries === member;
            const controlId = `${fieldId}-y-${member}`;
            return (
              <div key={member}>
                <InspectorRow
                  actions={
                    styleable ? (
                      <Button
                        aria-label={open ? "收起系列设置" : "展开系列设置"}
                        className="text-pa-muted"
                        onClick={() => setExpandedSeries(open ? null : member)}
                        size="icon-sm"
                        variant="subtle"
                      >
                        {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                      </Button>
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
                      items={AXIS_ITEMS}
                      label="坐标轴"
                      onValueChange={(value) => setSeriesPreferences(member, { axis: value })}
                      value={intent.axis ?? "left"}
                    />
                    <SelectRow
                      items={SERIES_FORM_ITEMS}
                      label="形态"
                      onValueChange={(value) => setSeriesPreferences(member, { mark: value })}
                      value={intent.mark ?? (chart.type === "line" ? "line" : "bar")}
                    />
                  </>
                ) : null}
              </div>
            );
          })}
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
