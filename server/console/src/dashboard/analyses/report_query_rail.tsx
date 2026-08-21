/**
 * 查询栏：筛选、指标、分组三节。栏内只有一条编辑规则——选择类控件（下拉、分段、行选）
 * 一改即落草稿；文本框在失焦或回车时落，落的是此刻框里的值，故文本框不受控、
 * 以外部值为 `key` 重挂。
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
import type { SemanticPercentOfTotalCalculation, SemanticQueryView } from "@semantic-analysis";
import { makeTitleOf } from "@shape";
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
  isAnalysisRunnable,
  removeSemanticQueryMember,
  replaceSemanticQueryDimension,
  semanticSinkQueryView,
  setSemanticQueryView,
  type AnalysisEditState,
} from "./analysis_draft";
import { FilterEditor } from "./filter_editor";
import { MemberPopover, type PickableMember } from "./member_picker";

/** 成员行自带记号槽宽的左缩，内容盒不加横内缩；行与题行贴合无空档。 */
const MEMBER_CONTENT_CLASS = "px-0 pt-0 md:px-0";

/**
 * 分组各行**共用一张网格**，不是各排各的行盒：维度选择器吃剩余宽（`1fr`），范围触发件
 * 与移除钮按内容定宽（`auto`）——而 `auto` 是**整列一起量**的，于是每行两枚触发件的分界
 * 恒落在同一条竖线上。行间的缝走 `gap-y`，不写在行上：行已经不是一个盒子了。
 */
const BREAKDOWN_CONTENT_CLASS = cn(
  INSPECTOR_ROW_INDENT_CLASS,
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-y-1.5 px-0 pl-2 md:px-0 md:pl-2",
);

/** 最大项数的上限：排名只看头部。 */
const MAX_ITEMS_LIMIT = 20;

/**
 * 题行右端的添加入口：全栏同一枚幽灵 `+`，位置不随内容多少上下漂。
 * 返回元素而非组件：它交给 `PopoverTrigger render={...}`，开合处理器与 ref 直接合并到这枚元素上。
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

/** 文本框的落值时机：失焦，或回车（回车即失焦，落值只走一条路）。 */
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

/** 成员浮层里那条「构成占比」的身份：不是目录成员，只是加进查询的另一种指标。 */
const PERCENT_OF_TOTAL_PICK_ID = "calculation:percent_of_total";

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
    // 维度与范围两格直接进父网格：列宽由整栏的网格统一定，各行对齐。
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
            <SelectButton
              aria-label={`${label}分组范围：${rangeLabel}`}
              // 宽随内容，右外边距留在格内，与移除钮之间保留缝隙。
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
          <PopupSection blocked={measures.length ? undefined : NO_MEASURE_REASON} label="最大项数">
            <div className="px-2 pb-0.5">
              <Input
                aria-label={`${label}最大项数`}
                defaultValue={active?.max_items?.toString() ?? ""}
                disabled={!measures.length}
                inputMode="numeric"
                key={active?.max_items ?? "all"}
                onBlur={(event) => {
                  // 空或非正整数即不限项；超过上限压到上限。框里回写落下的那个值。
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
  // 被编辑的视图取自草稿规格的收敛点：草稿是编辑对象的真相，结果只是它上一次运行的产物。
  const resultTitleOf = replay ? makeTitleOf(replay.payload.view) : (member: string) => member;
  const queryView = semanticSinkQueryView(draft.analysis);

  if (!queryView || !catalog) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-slot="report-query-rail">
        <InspectorBody>
          {leading}
          <section className={INSPECTOR_SECTION_CLASS}>
            {queryView ? (
              <LoadingMark className="py-6" />
            ) : (
              <p className="px-2 text-sm/4.5 text-pa-muted">该分析仅支持调整呈现。</p>
            )}
          </section>
          {children}
        </InspectorBody>
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
    (member) => dimensions.includes(member.id) && member.dimension_kind !== "overlapping",
  );
  const calculation = calculations[0];
  const calculationPick = percentOfTotalPick({
    measures: calculationMeasures,
    dimensions: calculationDimensions,
    chosen: Boolean(calculation),
  });

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="report-query-rail">
      <InspectorBody>
        {leading}
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
        </InspectorSection>

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
          icon={<TagIcon />}
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
                  onRemove={() =>
                    updateIntent(removeSemanticQueryMember(intent, member, "dimension"))
                  }
                  onReplace={(next) =>
                    updateIntent(replaceSemanticQueryDimension(intent, member, next))
                  }
                  selectedDimensions={dimensions}
                  sort={intent.group_sort}
                  titleOf={titleOf}
                />
              ))
            : undefined}
        </InspectorSection>
        {children}
      </InspectorBody>

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
