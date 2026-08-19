import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDownWideNarrowIcon,
  ArrowUpDownIcon,
  ArrowUpNarrowWideIcon,
  ChevronsUpDownIcon,
  LayersIcon,
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
import {
  isSemanticDerivedView,
  semanticAnalysisSink,
  type SemanticPercentOfTotalCalculation,
  type SemanticQueryView,
} from "@semantic-analysis";
import { makeTitleOf } from "@shape";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  INSPECTOR_MEMBER_INSET_CLASS,
  INSPECTOR_SECTION_CLASS,
  InspectorMemberRow,
  InspectorSection,
  InspectorSettingTitle,
} from "@/components/ui/inspector";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  selectTriggerIconClassName,
  selectTriggerVariants,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  isAnalysisRunnable,
  removeSemanticQueryMember,
  replaceSemanticQueryDimension,
  setSemanticQueryView,
  type AnalysisEditState,
} from "./analysis_draft";
import { FilterEditor } from "./filter_editor";
import { MemberPopover, type PickableMember } from "./member_picker";

/**
 * 成员行自带左缩（与题名同起点），故内容盒的横内缩清零，否则同一道内缩量两遍。
 * 行与题行贴合无空档：中间留一道缝会让节题读着松脱。
 */
const MEMBER_CONTENT_CLASS = "px-0 pt-0 md:px-0";

/**
 * 分组各行**共用一张网格**，不是各排各的行盒：维度选择器吃剩余宽（`1fr`），范围触发件
 * 与移除钮按内容定宽（`auto`）——而 `auto` 是**整列一起量**的，于是每行两枚触发件的分界
 * 恒落在同一条竖线上。各行自排时这条线会随本行标签长短漂（`前 15` 与 `全部` 差 4px），
 * 一列药丸读着就是歪的。
 *
 * 行间的缝走 `gap-y`，不写在行上：行已经不是一个盒子了。
 */
const BREAKDOWN_CONTENT_CLASS = cn(
  INSPECTOR_MEMBER_INSET_CLASS,
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-y-1.5 px-0 pl-2 md:px-0 md:pl-2",
);

/**
 * 题行右端的添加入口：全栏同一枚幽灵 `+`，位置不随内容多少上下漂。
 *
 * **写成返回元素的函数，不是组件**：它多半要交给 `PopoverTrigger render={...}`，
 * 开合的处理器与 ref 是从外面合并进这枚元素的。包成组件后那些 props 落在组件上，
 * 不透传就成了一枚点不开的按钮——套一层反而多一处能悄悄断掉的地方。
 */
const addButton = (label: string) => (
  <Button aria-label={label} className="text-pa-muted" size="icon-sm" variant="subtle">
    <PlusIcon />
  </Button>
);

/**
 * 成员行末的动作钮：幽灵图标常显。**图标认不出它作用在哪一层**——同一枚减号在筛选题行删的是
 * 整条筛选、在这里删的是一个成员，故一律配 Tooltip 把宾语讲明。
 */
function RowAction({
  label,
  tip,
  icon,
  onClick,
}: {
  /** 无障碍名，带成员名（读屏在一列同形的钮里靠它区分）。 */
  label: string;
  /** 可见说明，只说这枚钮做什么，不重复成员名——名字就在同一行左边。 */
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

/** 成员浮层里那条「构成占比」的身份：不是目录成员，只是加进查询的另一种指标。 */
export const PERCENT_OF_TOTAL_PICK_ID = "calculation:percent_of_total";

/**
 * 构成占比在成员浮层里的那一行：与目录指标同一份列表、同一套不可选理由——它是由已选指标
 * 算出来的**另一个指标**，不是另一类东西，故没有第二个添加入口。
 * 前置条件不满足时仍列出、只是灰，理由讲的是「先去做什么」。
 */
export function percentOfTotalPick({
  measures,
  dimensions,
  chosen,
}: {
  measures: CatalogMemberPayload[];
  dimensions: CatalogMemberPayload[];
  chosen: boolean;
}): PickableMember {
  const reason = chosen
    ? undefined
    : !measures.length
      ? "先添加一个可以算占比的指标（例如人数）"
      : !dimensions.length
        ? "先添加一个分组"
        : undefined;
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
  const [title, setTitle] = useState(calculation.title);
  useEffect(() => setTitle(calculation.title), [calculation.title]);
  const dimensionTitle = titleOf(calculation.category_dimension);
  const measureTitle = titleOf(calculation.measure);
  const conclusion = `按${dimensionTitle}`;
  const commit = (next: Partial<SemanticPercentOfTotalCalculation>) => {
    const merged = { ...calculation, ...next };
    onChange({ ...merged, id: calculationId(merged.measure, merged.category_dimension) });
  };
  return (
    <div className="flex items-center gap-0.5" data-slot="calculation-row">
      <div
        className={cn(INSPECTOR_MEMBER_INSET_CLASS, "flex min-h-8 min-w-0 grow items-center px-2")}
      >
        <span
          className="min-w-0 truncate text-sm leading-5 text-pa-muted"
          title={calculation.title}
        >
          {calculation.title}
        </span>
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <button
              aria-label={`${calculation.title}怎么算：${measureTitle}按${dimensionTitle}的占比`}
              className={cn(
                selectTriggerVariants({ size: "sm" }),
                "mr-0.5 w-auto min-w-0 max-w-[60%] text-pa-muted",
              )}
              type="button"
            />
          }
        >
          <PercentIcon className="size-4 shrink-0 text-pa-faint" />
          <span className="truncate">{conclusion}</span>
          <ChevronsUpDownIcon className={selectTriggerIconClassName} />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-[264px] p-1.5" data-slot="calculation-settings">
          <InspectorSettingTitle>算哪个指标的占比</InspectorSettingTitle>
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
          <InspectorSettingTitle>按哪个分组算</InspectorSettingTitle>
          <div className="px-2 pb-2">
            <Select
              onValueChange={(value) => {
                if (!value) return;
                const member = dimensions.find((candidate) => candidate.id === value);
                if (!member) return;
                // 名字还是默认那句时跟着维度走；用户改过名就不动它。
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
          <div className="-mx-1.5 my-3">
            <Separator />
          </div>
          <InspectorSettingTitle>名称</InspectorSettingTitle>
          <div className="px-2 pb-0.5">
            <Input
              aria-label={`${calculation.title}的名称`}
              maxLength={30}
              onBlur={() => {
                const trimmed = title.trim();
                if (!trimmed) {
                  setTitle(calculation.title);
                  return;
                }
                if (trimmed !== calculation.title) commit({ title: trimmed });
              }}
              onChange={(event) => setTitle(event.target.value)}
              size="sm"
              value={title}
            />
          </div>
        </PopoverPopup>
      </Popover>
      <RowAction
        icon={<MinusIcon />}
        label={`移除 ${calculation.title}`}
        onClick={onRemove}
        tip="移除这个占比"
      />
    </div>
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
  blockedDimensions,
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
  blockedDimensions: string[];
  titleOf: (member: string) => string;
  onChange: (sort: GroupSort) => void;
  onReplace: (next: string) => void;
  onRemove: () => void;
}) {
  const active = sort?.dimension === member ? sort : undefined;
  const by = active?.by ?? measures[0] ?? "name";
  const byName = by === "name";
  const direction = active?.direction ?? (byName ? "asc" : "desc");
  const [maxItems, setMaxItems] = useState(active?.max_items?.toString() ?? "");

  useEffect(() => {
    setMaxItems(active?.max_items?.toString() ?? "");
  }, [active?.max_items]);

  const commit = (next: Partial<GroupSort>) => {
    onChange({
      dimension: member,
      by,
      direction,
      ...(active?.max_items ? { max_items: active.max_items } : {}),
      ...next,
    });
  };
  const directionLabel = byName
    ? direction === "asc"
      ? "A 到 Z"
      : "Z 到 A"
    : direction === "desc"
      ? "从高到低"
      : "从低到高";
  // 触发件印的是**这一句设置的结论**，不是控件名：限了项数就说取哪一端的几项，
  // 只排序没限项就说按什么排，什么都没声明才是「全部」。
  const rangeLabel = !active
    ? "全部"
    : active.max_items
      ? byName
        ? `${direction === "asc" ? "A→Z" : "Z→A"} (${active.max_items})`
        : `${direction === "desc" ? "前" : "后"} ${active.max_items}`
      : byName
        ? "按名称"
        : "按数值";
  // 一枚图标同时表达依据与方向：名称升序与数值降序都是「从宽到窄」那一支。
  const descending = byName ? direction === "asc" : direction === "desc";
  const RangeIcon = !active
    ? ArrowUpDownIcon
    : descending
      ? ArrowDownWideNarrowIcon
      : ArrowUpNarrowWideIcon;

  return (
    // 一起定，包成行就只剩本行内部可协商，宽度随本行标签长短漂。
    <>
      <div className="mr-2.5 min-w-0" data-slot="breakdown-field">
        <MemberPopover
          blockedDimensions={blockedDimensions}
          members={dimensionMembers}
          onPick={(picked) => onReplace(picked.canonical_name)}
          selected={selectedDimensions}
          selectedDimensions={selectedDimensions}
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
            <button
              aria-label={`${label}分组范围：${rangeLabel}`}
              // 写死 100% 会让右外边距溢出格外，与移除钮之间那道缝就没了。
              className={cn(
                selectTriggerVariants({ size: "sm" }),
                "mr-0.5 w-auto min-w-0 text-pa-muted",
              )}
              type="button"
            />
          }
        >
          <RangeIcon className="size-4 shrink-0 text-pa-faint" />
          <span className="truncate">{rangeLabel}</span>
          <ChevronsUpDownIcon className={selectTriggerIconClassName} />
        </PopoverTrigger>

        <PopoverPopup align="end" className="w-[248px] p-1.5" data-slot="breakdown-range">
          <InspectorSettingTitle>排序依据</InspectorSettingTitle>
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
          <div className="-mx-1.5 my-3">
            <Separator />
          </div>
          <InspectorSettingTitle blocked={measures.length ? undefined : NO_MEASURE_REASON}>
            最大项数
          </InspectorSettingTitle>
          <div className="px-2 pb-0.5">
            <Input
              aria-label={`${label}最大项数`}
              disabled={!measures.length}
              inputMode="numeric"
              onBlur={() => {
                if (!maxItems) return;
                const count = Number(maxItems);
                if (!Number.isInteger(count) || count < 1) {
                  setMaxItems("");
                  if (active) commit({ max_items: undefined });
                } else if (count > 20) {
                  setMaxItems("20");
                  commit({ max_items: 20 });
                }
              }}
              onChange={(event) => {
                const value = event.target.value.replace(/[^\d]/g, "");
                setMaxItems(value);
                if (!value) {
                  if (active) commit({ max_items: undefined });
                  return;
                }
                const count = Number(value);
                if (Number.isInteger(count) && count >= 1 && count <= 20) {
                  commit({ max_items: count });
                }
              }}
              placeholder="全部"
              size="sm"
              type="text"
              value={maxItems}
            />
          </div>
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
  /** 空白起点尚无结果：字段标题与最新数据月份都直接使用目录。 */
  replay: ReplayPayload | null;
  catalog: CatalogPayload | null;
  onChange: (draft: AnalysisEditState) => void;

  onRunPreview: () => void;
  previewing: boolean;
  /** 图型条住在栏顶、查询步之前。 */
  leading?: ReactNode;
  /** 其他能力分区，例如图表呈现设置，按同一滚动面板继续渲染。 */
  children?: ReactNode;
}) {
  // 被编辑的视图取自草稿规格的收敛点，而非上一次结果的载荷——空白起点没有结果可反查，
  // 且草稿才是编辑对象的真相（结果只是它上一次运行的产物）。
  const resultTitleOf = replay ? makeTitleOf(replay.payload.view) : (member: string) => member;
  const hasDerivedView = draft.analysis.views.some(isSemanticDerivedView);
  const sinkId = semanticAnalysisSink(draft.analysis.views);
  const selected = draft.analysis.views.find((view) => view.id === sinkId);
  const queryView =
    !hasDerivedView && selected && !isSemanticDerivedView(selected) ? selected : null;

  if (!queryView || !catalog) {
    return (
      <div
        className="flex h-full min-h-0 flex-col"
        data-slot="report-editor-inspector"
        data-testid="report-query-rail"
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {leading}
          <section className={INSPECTOR_SECTION_CLASS}>
            <p className="px-2 text-sm/4.5 text-pa-muted">
              {queryView ? "正在载入可用字段…" : "该分析仅支持调整呈现。"}
            </p>
          </section>
          {children}
        </div>
      </div>
    );
  }

  const intent = queryView;
  const measures = intent.measures ?? [];
  const dimensions = intent.dimensions ?? [];
  const calculations = intent.calculations ?? [];
  const filters = intent.filters ?? [];
  const catalogById = new Map(
    [...catalog.measures, ...catalog.dimensions].map((item) => [item.id, item]),
  );
  const titleOf = (member: string) => catalogById.get(member)?.title ?? resultTitleOf(member);
  // 成员可以删到零：空查询是合法的中间态（正如空白新建的起点），
  // 只是不可执行——出口由栏底「运行预览」与保存按钮的禁用把住，不靠禁止删除来兜。
  const runnable = isAnalysisRunnable(draft);
  const hasIncompleteFilter = filters.some((filter) => filter.values.length === 0);

  // validate-on-commit：编辑照常落草稿，字段组合可执行性由运行预览时的服务端规划裁定；
  // 选路只在服务端，草稿里的语义规格自始至终不含任何物理 view。
  const updateIntent = (next: SemanticQueryView) => {
    onChange(setSemanticQueryView(draft, next.id, next, catalog));
  };

  const incompatibleDimensions = catalog.measures
    .filter((member) => measures.includes(member.id))
    .flatMap((member) => member.incompatible_dimensions ?? []);
  const calculationMeasures = catalog.measures.filter(
    (member) =>
      measures.includes(member.id) && member.report_calculations?.includes("percent_of_total"),
  );
  const calculationDimensions = catalog.dimensions.filter(
    (member) =>
      dimensions.includes(member.id) &&
      member.dimension_kind !== "individual" &&
      member.dimension_kind !== "overlapping",
  );

  const steps: React.ReactNode[] = [];

  steps.push(
    <InspectorSection
      actions={
        <MemberPopover
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
          selectedDimensions={dimensions}
          trigger={addButton("添加筛选条件")}
        />
      }
      icon={<ListFilterIcon />}
      key="filter"
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
    </InspectorSection>,
  );

  const calculation = calculations[0];
  const calculationPick = percentOfTotalPick({
    measures: calculationMeasures,
    dimensions: calculationDimensions,
    chosen: Boolean(calculation),
  });
  steps.push(
    <InspectorSection
      actions={
        <MemberPopover
          extras={{ label: "用已选指标再算", items: [calculationPick] }}
          members={catalog.measures}
          metricDomains={catalog.metric_domains}
          onPick={(member) => {
            if (member.id === PERCENT_OF_TOTAL_PICK_ID) {
              const [measure] = calculationMeasures;
              const [dimension] = calculationDimensions;
              if (!measure || !dimension) return;
              updateIntent({
                ...intent,
                calculations: [defaultPercentOfTotal(measure, dimension)],
                summary: undefined,
              });
              return;
            }
            updateIntent({ ...intent, measures: [...measures, member.canonical_name] });
          }}
          selected={[...measures, ...(calculation ? [PERCENT_OF_TOTAL_PICK_ID] : [])]}
          selectedDimensions={dimensions}
          trigger={addButton("选择指标")}
        />
      }
      contentClassName={MEMBER_CONTENT_CLASS}
      icon={<SigmaIcon />}
      key="measures"
      title="指标"
    >
      {measures.length || calculation ? (
        <>
          {measures.map((member) => (
            <InspectorMemberRow
              actions={
                <RowAction
                  icon={<MinusIcon />}
                  label={`移除 ${titleOf(member)}`}
                  onClick={() => updateIntent(removeSemanticQueryMember(intent, member, "measure"))}
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
              dimensions={calculationDimensions}
              key={calculation.id}
              measures={calculationMeasures}
              onChange={(next) => updateIntent({ ...intent, calculations: [next] })}
              onRemove={() => updateIntent({ ...intent, calculations: undefined })}
              titleOf={titleOf}
            />
          ) : null}
        </>
      ) : undefined}
    </InspectorSection>,
  );

  steps.push(
    <InspectorSection
      actions={
        <MemberPopover
          blockedDimensions={incompatibleDimensions}
          members={catalog.dimensions}
          onPick={(member) =>
            updateIntent({ ...intent, dimensions: [...dimensions, member.canonical_name] })
          }
          selected={dimensions}
          selectedDimensions={dimensions}
          trigger={addButton("选择分组维度")}
        />
      }
      contentClassName={BREAKDOWN_CONTENT_CLASS}
      icon={<LayersIcon />}
      key="dimensions"
      title="分组"
    >
      {dimensions.length
        ? dimensions.map((member) => (
            <BreakdownField
              blockedDimensions={incompatibleDimensions}
              dimensionMembers={catalog.dimensions}
              key={member}
              label={titleOf(member)}
              measures={measures}
              member={member}
              onChange={(groupSort) => updateIntent({ ...intent, group_sort: groupSort })}
              onRemove={() => updateIntent(removeSemanticQueryMember(intent, member, "dimension"))}
              onReplace={(next) =>
                updateIntent(replaceSemanticQueryDimension(intent, member, next))
              }
              selectedDimensions={dimensions}
              sort={intent.group_sort}
              titleOf={titleOf}
            />
          ))
        : undefined}
    </InspectorSection>,
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-slot="report-editor-inspector"
      data-testid="report-query-rail"
    >
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {leading}
        {steps}
        {children}
      </div>

      <div className="shrink-0 border-t border-pa-line bg-pa-bg px-3 py-3 md:px-2.5">
        <Button
          className="w-full"
          disabled={!runnable}
          loading={previewing}
          onClick={onRunPreview}
          variant="filled"
        >
          运行预览
        </Button>
        {!runnable && (
          <Hint className="mt-2 text-center">
            {hasIncompleteFilter ? "请先为筛选选择至少一个值" : "至少选择一个指标或分组维度"}
          </Hint>
        )}
      </div>
    </div>
  );
}
