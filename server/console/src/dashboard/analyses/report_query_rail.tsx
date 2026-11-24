/**
 * 选择类控件改动后立即写入草稿；文本框在失焦或回车时写入，因此文本框不受控，以外部值作 `key` 重新挂载。
 */
import type { ReactNode } from "react";
import {
  ArrowDownWideNarrowIcon,
  ArrowUpDownIcon,
  ArrowUpNarrowWideIcon,
  TagIcon,
  ListFilterIcon,
  MinusIcon,
  PlusIcon,
  PercentIcon,
  SigmaIcon,
} from "lucide-react";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicCatalogDocument as CatalogPayload,
} from "@contracts/catalog_contract";
import type { ReplayPayload } from "@contracts/replay_contract";
import { LoadingMark } from "pa-result-view";
import type {
  AnalysisDefinition,
  SemanticPercentOfTotalCalculation,
  SemanticQueryView,
} from "@semantic-analysis";
import { COMPOSITION_COLUMN_LIMITS } from "@semantic-analysis";
import type { TimeIntent } from "@time";
import { makeTitleOf } from "@shape";
import { queryCandidateFeasibilityIssue, queryFeasibilityIssueMessage } from "@query-feasibility";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { PopupSection, PopupTitle } from "@/components/ui/surface";
import { Input } from "@/components/ui/input";
import {
  INSPECTOR_ROW_INDENT_CLASS,
  INSPECTOR_SECTION_CLASS,
  InspectorBody,
  InspectorRow,
  InspectorSection,
} from "@/components/ui/inspector";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  analysisReadiness,
  removeSemanticQueryMember,
  replaceSemanticQueryDimension,
  semanticEditableQuery,
  setSemanticQueryView,
  type AnalysisEditState,
} from "./analysis_draft";
import { TimeBar } from "./time_editor";
import { FilterEditor } from "./filter_editor";
import { MemberPopover, type PickableMember } from "./member_picker";

const MEMBER_CONTENT_CLASS = "px-0 pt-0 md:px-0";

/** CSS `auto` 列按整列计算宽度：分组各行共用一张网格，各行的触发按钮才能纵向对齐。 */
const BREAKDOWN_CONTENT_CLASS = cn(
  INSPECTOR_ROW_INDENT_CLASS,
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-y-1.5 px-0 pl-2 md:px-0 md:pl-2",
);

const MAX_ITEMS_LIMIT = 20;

/** 返回元素而非组件：`PopoverTrigger render={...}` 会把事件处理器和 ref 合并到这个元素上。 */
const addButton = (label: string) => (
  <Button aria-label={label} className="text-pa-muted" size="icon-sm" variant="subtle">
    <PlusIcon />
  </Button>
);

function RowAction({
  label,
  tip,
  icon,
  onClick,
}: {
  /** 无障碍名，包含成员名，读屏靠它区分同一列里外观相同的按钮。 */
  label: string;
  /** 可见提示，只说明按钮作用，不含成员名。 */
  tip: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="text-pa-muted"
            onClick={onClick}
            size="icon-sm"
            variant="subtle"
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup>{tip}</TooltipPopup>
    </Tooltip>
  );
}

const commitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.currentTarget.blur();
};

function calculationId(measure: string, dimension: string): string {
  const token = `${measure}_${dimension}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `calculation:${token}_share`.slice(0, 120);
}

function calculationTitle(dimensionTitle: string): string {
  const stem = dimensionTitle.replace(/分类$/, "");
  return `${stem}结构`;
}

/** 成员浮层中「占比」选项的 id，不对应目录成员。 */
const PERCENT_OF_TOTAL_PICK_ID = "calculation:percent_of_total";

export function percentOfTotalPick({
  measures,
  dimensions,
  chosen,
  incompatibleReason,
}: {
  measures: CatalogMemberPayload[];
  dimensions: CatalogMemberPayload[];
  chosen: boolean;
  incompatibleReason?: string;
}): PickableMember {
  const reason = chosen
    ? undefined
    : !measures.length
      ? "先添加一个可以算占比的指标（例如人数）"
      : !dimensions.length
        ? "先添加一个分组"
        : incompatibleReason;
  return {
    id: PERCENT_OF_TOTAL_PICK_ID,
    canonical_name: PERCENT_OF_TOTAL_PICK_ID,
    kind: "measure",
    title: "占比",
    description: "把已选的指标按某个分组算成百分比，各组加起来是 100%",
    icon: <PercentIcon aria-hidden="true" className="size-4 shrink-0 text-pa-faint" />,
    incompatible: Boolean(reason),
    ...(reason ? { incompatible_reason: reason } : {}),
  };
}

export function defaultPercentOfTotal(
  measure: CatalogMemberPayload,
  dimension: CatalogMemberPayload,
): SemanticPercentOfTotalCalculation {
  return {
    id: calculationId(measure.id, dimension.id),
    title: calculationTitle(dimension.title),
    kind: "percent_of_total",
    measure: measure.id,
    category_dimension: dimension.id,
  };
}

function CalculationRow({
  calculation,
  measures,
  dimensions,
  titleOf,
  onChange,
  onRemove,
}: {
  calculation: SemanticPercentOfTotalCalculation;
  measures: CatalogMemberPayload[];
  dimensions: CatalogMemberPayload[];
  titleOf: (member: string) => string;
  onChange: (next: SemanticPercentOfTotalCalculation) => void;
  onRemove: () => void;
}) {
  const dimensionTitle = titleOf(calculation.category_dimension);
  const measureTitle = titleOf(calculation.measure);
  const conclusion = `按${dimensionTitle}`;
  const commit = (next: Partial<SemanticPercentOfTotalCalculation>) => {
    const merged = { ...calculation, ...next };
    onChange({ ...merged, id: calculationId(merged.measure, merged.category_dimension) });
  };
  return (
    <InspectorRow
      actions={
        <RowAction
          icon={<MinusIcon />}
          label={`移除 ${calculation.title}`}
          onClick={onRemove}
          tip="移除这个占比"
        />
      }
      indent
      label={calculation.title}
    >
      <Popover>
        <PopoverTrigger
          render={
            <SelectButton
              aria-label={`${calculation.title}怎么算：${measureTitle}按${dimensionTitle}的占比`}
              className="w-auto min-w-0 text-pa-muted"
              icon={<PercentIcon />}
              size="sm"
            >
              {conclusion}
            </SelectButton>
          }
        />
        <PopoverPopup
          align="end"
          className="p-1.5"
          data-slot="calculation-settings"
          width="settings"
        >
          <PopupTitle>算哪个指标的占比</PopupTitle>
          <div className="px-2 pb-2">
            <Select
              onValueChange={(value) => value && commit({ measure: value })}
              value={calculation.measure}
            >
              <SelectTrigger aria-label={`${calculation.title}算哪个指标的占比`} size="sm">
                <SelectValue>{measureTitle}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {measures.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <PopupTitle>按哪个分组算</PopupTitle>
          <div className="px-2 pb-2">
            <Select
              onValueChange={(value) => {
                if (!value) return;
                const member = dimensions.find((candidate) => candidate.id === value);
                if (!member) return;
                // 名称仍是默认值时随维度更新；用户改过名称则保留。
                const isDefaultTitle = calculation.title === calculationTitle(dimensionTitle);
                commit({
                  category_dimension: value,
                  ...(isDefaultTitle ? { title: calculationTitle(member.title) } : {}),
                });
              }}
              value={calculation.category_dimension}
            >
              <SelectTrigger aria-label={`${calculation.title}按哪个分组算`} size="sm">
                <SelectValue>{dimensionTitle}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {dimensions.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Hint className="px-2 pb-1">
            {`每个${dimensionTitle}的${measureTitle}占全部${measureTitle}的百分比，各组加起来是 100%。`}
          </Hint>
          <PopupSection label="名称">
            <div className="px-2 pb-0.5">
              <Input
                aria-label={`${calculation.title}的名称`}
                defaultValue={calculation.title}
                key={calculation.title}
                maxLength={30}
                onBlur={(event) => {
                  const trimmed = event.currentTarget.value.trim();
                  if (!trimmed) {
                    event.currentTarget.value = calculation.title;
                    return;
                  }
                  if (trimmed !== calculation.title) commit({ title: trimmed });
                }}
                onKeyDown={commitOnEnter}
                size="sm"
              />
            </div>
          </PopupSection>
        </PopoverPopup>
      </Popover>
    </InspectorRow>
  );
}

type GroupSort = NonNullable<SemanticQueryView["group_sort"]>;

const NO_MEASURE_REASON = "先选一个指标，才能按数值取前 / 后 N 个分组";

function BreakdownField({
  member,
  label,
  measures,
  sort,
  dimensionMembers,
  selectedDimensions,
  candidateIssue,
  rangeIssue,
  titleOf,
  onChange,
  onReplace,
  onRemove,
}: {
  member: string;
  label: string;
  measures: string[];
  sort: GroupSort | undefined;
  dimensionMembers: CatalogMemberPayload[];
  selectedDimensions: string[];
  candidateIssue: (member: CatalogMemberPayload) => string | undefined;
  rangeIssue: (sort: GroupSort) => string | undefined;
  titleOf: (member: string) => string;
  onChange: (sort: GroupSort) => void;
  onReplace: (next: string) => void;
  onRemove: () => void;
}) {
  const active = sort?.dimension === member ? sort : undefined;
  const by = active?.by ?? measures[0] ?? "name";
  const byName = by === "name";
  const direction = active?.direction ?? (byName ? "asc" : "desc");

  const commit = (next: Partial<GroupSort>) => {
    const resolved = {
      dimension: member,
      by,
      direction,
      ...(active?.max_items ? { max_items: active.max_items } : {}),
      ...next,
    };
    if (!rangeIssue(resolved)) onChange(resolved);
  };
  const maxItemsIssue = active?.max_items
    ? undefined
    : rangeIssue({ dimension: member, by, direction, max_items: 1 });
  const directionLabel = byName
    ? direction === "asc"
      ? "A 到 Z"
      : "Z 到 A"
    : direction === "desc"
      ? "从高到低"
      : "从低到高";
  const rangeLabel = !active
    ? "全部"
    : active.max_items
      ? byName
        ? `${direction === "asc" ? "A→Z" : "Z→A"} (${active.max_items})`
        : `${direction === "desc" ? "前" : "后"} ${active.max_items}`
      : byName
        ? "按名称"
        : "按数值";
  // 同一个图标同时表示依据和方向：名称升序与数值降序都用「从宽到窄」图标。
  const descending = byName ? direction === "asc" : direction === "desc";
  const RangeIcon = !active
    ? ArrowUpDownIcon
    : descending
      ? ArrowDownWideNarrowIcon
      : ArrowUpNarrowWideIcon;

  return (
    <>
      <div className="mr-2.5 min-w-0" data-slot="breakdown-field">
        <MemberPopover
          candidateIssue={candidateIssue}
          members={dimensionMembers}
          onPick={(picked) => onReplace(picked.canonical_name)}
          selected={selectedDimensions}
          trigger={
            <SelectButton
              aria-label={`分组维度：${label}`}
              className="min-w-0 text-pa-muted"
              size="sm"
            >
              {label}
            </SelectButton>
          }
        />
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <SelectButton
              aria-label={`${label}分组范围：${rangeLabel}`}
              className="mr-0.5 w-auto min-w-0 text-pa-muted"
              icon={<RangeIcon />}
              size="sm"
            >
              {rangeLabel}
            </SelectButton>
          }
        />

        <PopoverPopup align="end" className="p-1.5" data-slot="breakdown-range" width="settings">
          <PopupTitle>排序依据</PopupTitle>
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <ToggleGroup
              bordered
              className="h-8 min-w-0 flex-1"
              columns={2}
              onValueChange={(next) => {
                const picked = next[0];
                if (!picked || picked === (byName ? "name" : "value")) return;
                const nextName = picked === "name";
                commit({
                  by: nextName ? "name" : (measures[0] ?? "name"),
                  direction: nextName ? "asc" : "desc",
                });
              }}
              value={[byName ? "name" : "value"]}
            >
              <ToggleGroupItem className="h-full" disabled={!measures.length} value="value">
                数值
              </ToggleGroupItem>
              <ToggleGroupItem className="h-full" value="name">
                名称
              </ToggleGroupItem>
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`${label}排序方向：${directionLabel}`}
                    onClick={() => commit({ direction: direction === "desc" ? "asc" : "desc" })}
                    size="icon-sm"
                    variant="default"
                  />
                }
              >
                <RangeIcon />
              </TooltipTrigger>
              <TooltipPopup>{`${directionLabel}（点击切换）`}</TooltipPopup>
            </Tooltip>
          </div>
          {!byName && measures.length > 1 ? (
            <div className="px-2 pb-2">
              <Select
                onValueChange={(value) => {
                  if (value) commit({ by: value });
                }}
                value={by}
              >
                <SelectTrigger aria-label={`${label}排序指标`} size="sm">
                  <SelectValue>{titleOf(by)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {measures.map((measure) => (
                    <SelectItem key={measure} value={measure}>
                      {titleOf(measure)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          <PopupSection
            blocked={measures.length ? maxItemsIssue : NO_MEASURE_REASON}
            label="最大项数"
          >
            <div className="px-2 pb-0.5">
              <Input
                aria-label={`${label}最大项数`}
                defaultValue={active?.max_items?.toString() ?? ""}
                disabled={!measures.length || Boolean(maxItemsIssue)}
                inputMode="numeric"
                key={active?.max_items ?? "all"}
                onBlur={(event) => {
                  const count = Number(event.currentTarget.value.replace(/[^\d]/g, ""));
                  const next =
                    Number.isInteger(count) && count >= 1
                      ? Math.min(count, MAX_ITEMS_LIMIT)
                      : undefined;
                  event.currentTarget.value = next?.toString() ?? "";
                  if (next !== active?.max_items && (next || active)) {
                    commit({ max_items: next });
                  }
                }}
                onKeyDown={commitOnEnter}
                placeholder="全部"
                size="sm"
                type="text"
              />
            </div>
          </PopupSection>
        </PopoverPopup>
      </Popover>
      <RowAction
        icon={<MinusIcon />}
        label={`移除 ${label}`}
        onClick={onRemove}
        tip="移除该分组维度"
      />
    </>
  );
}

type Composition = Extract<AnalysisDefinition, { composition: unknown }>["composition"];

function columnTimeFromWindow(
  window: TimeIntent["window"],
): Composition["columns"][number]["time"] {
  if (window.kind === "observation") {
    return window.selection.kind === "trend"
      ? { window: { kind: "current_month" } }
      : { window: { kind: "observation", selection: window.selection } };
  }
  if (window.kind === "current_month") return { window };
  const { grain: _grain, ...period } = window;
  return { window: period };
}

function compositionDraft(draft: AnalysisEditState, composition: Composition): AnalysisEditState {
  return {
    ...draft,
    analysis: { title: draft.analysis.title, composition },
    view: { type: "table" },
    view_preferences: draft.view.type === "table" ? draft.view_preferences : {},
    previewed_analysis: null,
    previewed_view: null,
    previewed_view_preferences: null,
  };
}

const ALL_COLUMN_ENTITIES = "*";

function CompositionQueryRail({
  catalog,
  composition,
  draft,
  onChange,
  onRunPreview,
  previewing,
  leading,
  children,
}: {
  catalog: CatalogPayload;
  composition: Composition;
  draft: AnalysisEditState;
  onChange: (draft: AnalysisEditState) => void;
  onRunPreview: () => void;
  previewing: boolean;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  const groupChoices = catalog.dimensions.filter((dimension) => dimension.entity_label);
  const group = groupChoices.find(({ id }) => id === composition.group_by);
  const memberOf = (id: string) => catalog.measures.find((measure) => measure.id === id);
  const supportsGroup = (id: string) =>
    memberOf(id)?.query_capabilities.dimension_ids.includes(composition.group_by);
  const columns = composition.columns;
  const baseline = columns.find(({ id }) => id === composition.baseline);
  const filters = composition.filters ?? [];
  const runIssue = analysisReadiness(draft, catalog).issues[0];
  const change = (next: Partial<Composition>) =>
    onChange(compositionDraft(draft, { ...composition, ...next }));
  const columnTitle = (column: Composition["columns"][number]) =>
    column.title ?? memberOf(column.measure)?.title ?? column.measure;
  const setColumn = (id: string, update: Partial<Composition["columns"][number]>) =>
    change({
      columns: columns.map((column) => (column.id === id ? { ...column, ...update } : column)),
    });
  const addColumn = (measure: string) => {
    const used = new Set(columns.map(({ id }) => id));
    let number = columns.length + 1;
    while (used.has(`column_${number}`)) number++;
    change({
      columns: [
        ...columns,
        {
          id: `column_${number}`,
          measure,
          time: { window: { kind: "current_month" } },
        },
      ],
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="report-query-rail">
      <InspectorBody>
        {leading}
        <InspectorSection icon={<TagIcon />} title="组合表行">
          <InspectorRow label="实体维度">
            <MemberPopover
              members={groupChoices}
              selected={[composition.group_by]}
              onPick={(member) => change({ group_by: member.id, baseline: undefined })}
              trigger={
                <Button aria-label="选择实体维度" variant="subtle">
                  {group?.title ?? "选择实体维度"}
                </Button>
              }
            />
          </InspectorRow>
          <Select
            value={composition.baseline ?? ALL_COLUMN_ENTITIES}
            onValueChange={(id) => {
              if (id !== null) change({ baseline: id === ALL_COLUMN_ENTITIES ? undefined : id });
            }}
          >
            <InspectorRow label="行基准">
              <SelectTrigger aria-label="选择行基准" size="sm">
                <SelectValue>{baseline ? columnTitle(baseline) : "各列实体并集"}</SelectValue>
              </SelectTrigger>
            </InspectorRow>
            <SelectPopup>
              <SelectItem value={ALL_COLUMN_ENTITIES}>各列实体并集</SelectItem>
              {columns.map((column, index) =>
                supportsGroup(column.measure) ? (
                  <SelectItem key={column.id} value={column.id}>
                    {`第 ${index + 1} 列 · ${columnTitle(column)}`}
                  </SelectItem>
                ) : null,
              )}
            </SelectPopup>
          </Select>
        </InspectorSection>
        <InspectorSection
          icon={<ListFilterIcon />}
          title="共享筛选"
          actions={
            <MemberPopover
              members={catalog.dimensions}
              selected={filters.map(({ member }) => member)}
              onPick={(member) => {
                if (!filters.some((filter) => filter.member === member.id)) {
                  change({
                    filters: [...filters, { member: member.id, relation: "one_of", values: [] }],
                  });
                }
              }}
              trigger={addButton("添加组合表筛选")}
            />
          }
        >
          {filters.length > 0 && (
            <FilterEditor
              catalogDimensions={catalog.dimensions}
              filters={filters}
              onChange={(next) => change({ filters: next.length ? next : undefined })}
            />
          )}
        </InspectorSection>
        <InspectorSection
          icon={<SigmaIcon />}
          title="指标列"
          actions={
            columns.length < COMPOSITION_COLUMN_LIMITS.max && (
              <MemberPopover
                members={catalog.measures}
                metricDomains={catalog.metric_domains}
                onPick={(member) => addColumn(member.id)}
                trigger={addButton("添加指标列")}
              />
            )
          }
        >
          {columns.map((column, index) => {
            const measure = memberOf(column.measure);
            const title = columnTitle(column);
            return (
              <div key={column.id}>
                <InspectorRow
                  label={`第 ${index + 1} 列`}
                  blocked={supportsGroup(column.measure) ? undefined : "此指标不支持所选实体粒度"}
                  actions={
                    <RowAction
                      label={`移除第 ${index + 1} 列 ${title}`}
                      tip="移除此列"
                      icon={<MinusIcon />}
                      onClick={() =>
                        change({
                          columns: columns.filter(({ id }) => id !== column.id),
                          baseline:
                            composition.baseline === column.id ? undefined : composition.baseline,
                        })
                      }
                    />
                  }
                >
                  <MemberPopover
                    members={catalog.measures}
                    metricDomains={catalog.metric_domains}
                    selected={[column.measure]}
                    onPick={(member) => {
                      const supportsObservation = memberOf(member.id)?.time.constraints
                        ?.observation;
                      setColumn(column.id, {
                        measure: member.id,
                        title: undefined,
                        ...(column.time.window.kind === "observation" && !supportsObservation
                          ? { time: { window: { kind: "current_month" } } }
                          : {}),
                      });
                    }}
                    trigger={
                      <Button
                        aria-label={`选择第 ${index + 1} 列指标`}
                        className="max-w-36 truncate"
                        variant="subtle"
                      >
                        {title}
                      </Button>
                    }
                  />
                </InspectorRow>
                <InspectorRow label="观察期间" indent>
                  <TimeBar
                    capabilities={measure?.time.constraints}
                    dataAsOf={measure?.data_as_of}
                    singleColumn
                    time={column.time}
                    onChange={(time) => setColumn(column.id, { time })}
                  />
                </InspectorRow>
              </div>
            );
          })}
        </InspectorSection>
        {children}
      </InspectorBody>
      <PreviewAction
        issue={runIssue?.message}
        onRunPreview={onRunPreview}
        previewing={previewing}
      />
    </div>
  );
}

function PreviewAction({
  issue,
  onRunPreview,
  previewing,
}: {
  issue?: string;
  onRunPreview: () => void;
  previewing: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-pa-line bg-pa-bg px-3 py-3 md:px-2.5">
      <Button
        className="w-full"
        disabled={Boolean(issue)}
        loading={previewing}
        onClick={onRunPreview}
        variant="filled"
      >
        运行预览
      </Button>
      {issue ? <Hint className="mt-2 text-center">{issue}</Hint> : null}
    </div>
  );
}

export function ReportQueryRail({
  draft,
  replay,
  catalog,
  onChange,
  onRunPreview,
  previewing,
  leading,
  children,
}: {
  draft: AnalysisEditState;
  /** 新建分析尚未运行时为 null，字段标题从目录取。 */
  replay: ReplayPayload | null;
  catalog: CatalogPayload | null;
  onChange: (draft: AnalysisEditState) => void;

  onRunPreview: () => void;
  previewing: boolean;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  const resultTitleOf = replay ? makeTitleOf(replay.payload.view) : (member: string) => member;
  const queryView = semanticEditableQuery(draft.analysis);

  if (catalog && "composition" in draft.analysis) {
    return (
      <CompositionQueryRail
        catalog={catalog}
        composition={draft.analysis.composition}
        draft={draft}
        leading={leading}
        onChange={onChange}
        onRunPreview={onRunPreview}
        previewing={previewing}
      >
        {children}
      </CompositionQueryRail>
    );
  }
  if (!queryView || !catalog) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-slot="report-query-rail">
        <InspectorBody>
          {leading}
          <section className={INSPECTOR_SECTION_CLASS}>
            {queryView ? (
              <LoadingMark className="py-6" />
            ) : (
              <p className="px-2 text-sm/4.5 text-pa-muted">该分析只能调整显示方式。</p>
            )}
          </section>
          {children}
        </InspectorBody>
      </div>
    );
  }

  const intent = queryView;
  const entityDimensions = catalog.dimensions.filter(({ entity_label }) => entity_label);
  const defaultGroup =
    entityDimensions.find(({ id }) => intent.dimensions?.includes(id)) ?? entityDimensions[0];
  function startComposition() {
    if (!defaultGroup) return;
    const time = columnTimeFromWindow(intent.time.window);
    onChange(
      compositionDraft(draft, {
        group_by: defaultGroup.id,
        filters: intent.filters,
        columns: (intent.measures ?? [])
          .slice(0, COMPOSITION_COLUMN_LIMITS.max)
          .map((measure, i) => ({ id: `column_${i + 1}`, measure, time })),
      }),
    );
  }
  const measures = intent.measures ?? [];
  const dimensions = intent.dimensions ?? [];
  const calculations = intent.calculations ?? [];
  const filters = intent.filters ?? [];
  const catalogById = new Map(
    [...catalog.measures, ...catalog.dimensions].map((item) => [item.id, item]),
  );
  const titleOf = (member: string) => catalogById.get(member)?.title ?? resultTitleOf(member);
  const readiness = analysisReadiness(draft, catalog);
  const runIssue = readiness.issues[0];
  const resolvedTime = readiness.time?.status === "resolved" ? readiness.time.selection : undefined;
  const candidateIssueOf = (candidate: SemanticQueryView) => {
    const issue = queryCandidateFeasibilityIssue(catalog, intent, candidate, resolvedTime);
    return issue ? queryFeasibilityIssueMessage(issue) : undefined;
  };
  const updateIntent = (next: SemanticQueryView) => {
    onChange(setSemanticQueryView(draft, next, catalog));
  };

  const calculationMeasures = catalog.measures.filter(
    (member) =>
      measures.includes(member.id) && member.report_calculations?.includes("percent_of_total"),
  );
  const calculationDimensions = catalog.dimensions.filter(
    (member) => dimensions.includes(member.id) && member.dimension_kind !== "overlapping",
  );
  const calculation = calculations[0];
  const calculationIssue = (measure: CatalogMemberPayload, dimension: CatalogMemberPayload) =>
    candidateIssueOf({
      ...intent,
      calculations: [defaultPercentOfTotal(measure, dimension)],
      summary: undefined,
    });
  const calculationCandidates = calculationMeasures.flatMap((measure) =>
    calculationDimensions.map((dimension) => ({
      measure,
      dimension,
      issue: calculationIssue(measure, dimension),
    })),
  );
  const calculationPairs = calculationCandidates.filter(({ issue }) => !issue);
  const currentCalculationMeasure = calculation
    ? catalog.measures.find((measure) => measure.id === calculation.measure)
    : undefined;
  const currentCalculationDimension = calculation
    ? catalog.dimensions.find((dimension) => dimension.id === calculation.category_dimension)
    : undefined;
  const selectableCalculationMeasures = currentCalculationDimension
    ? calculationMeasures.filter(
        (measure) => !calculationIssue(measure, currentCalculationDimension),
      )
    : [];
  const selectableCalculationDimensions = currentCalculationMeasure
    ? calculationDimensions.filter(
        (dimension) => !calculationIssue(currentCalculationMeasure, dimension),
      )
    : [];
  const calculationPick = percentOfTotalPick({
    measures: calculationMeasures,
    dimensions: calculationDimensions,
    chosen: Boolean(calculation),
    incompatibleReason:
      calculationPairs.length > 0
        ? undefined
        : calculationCandidates.find(({ issue }) => issue)?.issue,
  });

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="report-query-rail">
      <InspectorBody>
        {leading}
        {defaultGroup && (
          <InspectorRow label="分析方式">
            <Button onClick={startComposition} variant="subtle">
              改为跨期组合表
            </Button>
          </InspectorRow>
        )}
        <InspectorSection
          actions={
            <MemberPopover
              candidateIssue={(member) =>
                candidateIssueOf({
                  ...intent,
                  filters: [...filters, { member: member.id, relation: "one_of", values: [] }],
                })
              }
              members={catalog.dimensions}
              onPick={(member) =>
                updateIntent({
                  ...intent,
                  filters: [
                    ...filters,
                    { member: member.canonical_name, relation: "one_of", values: [] },
                  ],
                })
              }
              selected={filters.map((filter) => filter.member)}
              trigger={addButton("添加筛选条件")}
            />
          }
          contentClassName={MEMBER_CONTENT_CLASS}
          icon={<ListFilterIcon />}
          title="筛选"
        >
          {filters.length ? (
            <FilterEditor
              catalogDimensions={catalog.dimensions}
              filters={filters}
              onChange={(next) =>
                updateIntent({
                  ...intent,
                  filters: next.length ? next : undefined,
                })
              }
            />
          ) : undefined}
        </InspectorSection>

        <InspectorSection
          actions={
            <MemberPopover
              candidateIssue={(member) =>
                candidateIssueOf({ ...intent, measures: [...measures, member.id] })
              }
              extras={{ label: "基于已选指标计算", items: [calculationPick] }}
              members={catalog.measures}
              metricDomains={catalog.metric_domains}
              onPick={(member) => {
                if (member.id === PERCENT_OF_TOTAL_PICK_ID) {
                  const pair = calculationPairs[0];
                  if (!pair) return;
                  updateIntent({
                    ...intent,
                    calculations: [defaultPercentOfTotal(pair.measure, pair.dimension)],
                    summary: undefined,
                  });
                  return;
                }
                updateIntent({ ...intent, measures: [...measures, member.canonical_name] });
              }}
              selected={[...measures, ...(calculation ? [PERCENT_OF_TOTAL_PICK_ID] : [])]}
              trigger={addButton("选择指标")}
            />
          }
          contentClassName={MEMBER_CONTENT_CLASS}
          icon={<SigmaIcon />}
          title="指标"
        >
          {measures.length || calculation ? (
            <>
              {measures.map((member) => (
                <InspectorRow
                  indent
                  actions={
                    <RowAction
                      icon={<MinusIcon />}
                      label={`移除 ${titleOf(member)}`}
                      onClick={() =>
                        updateIntent(removeSemanticQueryMember(intent, member, "measure"))
                      }
                      tip="移除该指标"
                    />
                  }
                  key={member}
                  label={titleOf(member)}
                />
              ))}
              {calculation ? (
                <CalculationRow
                  calculation={calculation}
                  dimensions={selectableCalculationDimensions}
                  key={calculation.id}
                  measures={selectableCalculationMeasures}
                  onChange={(next) => updateIntent({ ...intent, calculations: [next] })}
                  onRemove={() => updateIntent({ ...intent, calculations: undefined })}
                  titleOf={titleOf}
                />
              ) : null}
            </>
          ) : undefined}
        </InspectorSection>

        <InspectorSection
          actions={
            <MemberPopover
              candidateIssue={(member) =>
                candidateIssueOf({ ...intent, dimensions: [...dimensions, member.id] })
              }
              members={catalog.dimensions}
              onPick={(member) =>
                updateIntent({ ...intent, dimensions: [...dimensions, member.canonical_name] })
              }
              selected={dimensions}
              trigger={addButton("选择分组维度")}
            />
          }
          contentClassName={BREAKDOWN_CONTENT_CLASS}
          icon={<TagIcon />}
          title="分组"
        >
          {dimensions.length
            ? dimensions.map((member) => (
                <BreakdownField
                  candidateIssue={(candidate) =>
                    candidateIssueOf(replaceSemanticQueryDimension(intent, member, candidate.id))
                  }
                  dimensionMembers={catalog.dimensions}
                  key={member}
                  label={titleOf(member)}
                  measures={measures}
                  member={member}
                  onChange={(groupSort) => updateIntent({ ...intent, group_sort: groupSort })}
                  onRemove={() =>
                    updateIntent(removeSemanticQueryMember(intent, member, "dimension"))
                  }
                  onReplace={(next) =>
                    updateIntent(replaceSemanticQueryDimension(intent, member, next))
                  }
                  rangeIssue={(groupSort) => candidateIssueOf({ ...intent, group_sort: groupSort })}
                  selectedDimensions={dimensions}
                  sort={intent.group_sort}
                  titleOf={titleOf}
                />
              ))
            : undefined}
        </InspectorSection>
        {children}
      </InspectorBody>

      <PreviewAction
        issue={runIssue?.message}
        onRunPreview={onRunPreview}
        previewing={previewing}
      />
    </div>
  );
}
