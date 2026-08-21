import { useEffect, useState } from "react";
import { ChevronRightIcon, MinusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  isSearchableCatalogDimension,
  type PublicCatalogMember as CatalogMemberPayload,
} from "@contracts/catalog_contract";
import type { SemanticQueryView } from "@semantic-analysis";
import { Button } from "@/components/ui/button";
import { InspectorRow } from "@/components/ui/inspector";
import { NotebookCellItem } from "@/components/ui/notebook";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDimensionValues } from "../dashboard_queries";

type Filter = NonNullable<SemanticQueryView["filters"]>[number];

/** 关系名写全「其中之一」：值是多枚，只写「是 / 不是」会读成单值比较。 */
const RELATION_LABELS: Record<Filter["relation"], string> = {
  one_of: "是其中之一",
  none_of: "不是其中之一",
};

function FilterCard({
  filter,
  title,
  member,
  memberId,
  onChange,
  onRemove,
}: {
  filter: Filter;
  title: string;
  member?: CatalogMemberPayload;
  memberId: string;
  onChange: (filter: Filter) => void;
  onRemove: () => void;
}) {
  const values = filter.values ?? [];
  // 刚加的条件还没有值，摆开等着挑；已经选好的收起——收起态照样把取值印在卡上，
  // 收的只是改的那套控件，读得到的东西一个没少。
  const [open, setOpen] = useState(values.length === 0);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const searchable = isSearchableCatalogDimension(member);
  // 收起时不取值：整栏的筛选卡各自发一轮维度取值请求，只为了填一张看不见的列表。
  const options = useDimensionValues(memberId, query, searchable && open).data?.values ?? [];
  const candidates = options.filter((value) => !values.includes(value));

  const add = (value: string) => {
    const next = value.trim();
    if (!next || values.includes(next)) return;
    onChange({ ...filter, values: [...values, next] });
    setTyped("");
  };

  const chipOf = (value: string) => (
    <NotebookCellItem
      className="cursor-default"
      key={value}
      render={<span />}
      right={
        <XIcon
          aria-label={`移除取值 ${value}`}
          className="size-3 shrink-0 cursor-pointer"
          onClick={() => onChange({ ...filter, values: values.filter((item) => item !== value) })}
        />
      }
    >
      {value}
    </NotebookCellItem>
  );

  return (
    <div
      className="group overflow-hidden rounded-lg border border-pa-line-subtle bg-pa-wash"
      data-slot="filter-card"
    >
      <div className="flex h-10 items-center gap-1 pr-1 pl-2.5">
        <button
          aria-expanded={open}
          className="pa-focus flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-pa-faint transition-transform duration-200",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate font-medium text-sm leading-5 text-pa-ink">
            {title}
          </span>
        </button>
        <Button
          className="shrink-0 text-pa-muted"
          onClick={() =>
            onChange({
              ...filter,
              relation: filter.relation === "one_of" ? "none_of" : "one_of",
            })
          }
          size="compact"
          variant="subtle"
        >
          {RELATION_LABELS[filter.relation]}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`移除 ${title} 筛选`}
                className="invisible shrink-0 text-pa-muted group-focus-within:visible group-hover:visible"
                onClick={onRemove}
                size="icon-sm"
                variant="subtle"
              />
            }
          >
            <MinusIcon />
          </TooltipTrigger>
          <TooltipPopup>移除整条筛选</TooltipPopup>
        </Tooltip>
      </div>
      {open ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-pa-line-subtle border-t px-2.5 py-1.5">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-pa-faint" />
            {values.map(chipOf)}
            {/* 基宽给到极小再 grow：留一个像样的最小宽度，值片一多就会把输入框挤到下一行，
                于是那一行只剩一条没有内容的空带。 */}
            <input
              aria-label={`${title} 取值`}
              className="h-7 w-1 min-w-0 grow border-0 bg-transparent text-sm text-pa-fg outline-none placeholder:text-pa-placeholder"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                // 回车收下键入的字面值：名录之外的取值（以及不可检索的维度）只能这样进来。
                if (event.key === "Enter") {
                  event.preventDefault();
                  add(typed);
                }
              }}
              placeholder={values.length ? "" : "搜索或输入取值"}
              value={typed}
            />
          </div>
          {/* 列表高度取整行数：切在半行上会让最后那行读成渲染坏了。 */}
          <div className="max-h-42 overflow-y-auto border-pa-line-subtle border-t p-1">
            {candidates.map((value) => (
              <InspectorRow key={value} label={value} onClick={() => add(value)} />
            ))}
            {candidates.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-pa-muted">
                {searchable ? "没有更多取值" : "键入取值后回车加入"}
              </p>
            ) : null}
          </div>
        </>
      ) : values.length ? (
        // 收起态的取值行左缩到与题名同起点（雪佛龙 14 + 间距 6 + 内缩 10）。
        <div className="flex flex-wrap items-center gap-1.5 pr-2.5 pb-2 pl-[30px]">
          {values.map(chipOf)}
        </div>
      ) : null}
    </div>
  );
}

/** 语义 dimension id → 目录成员（拿中文标题）；filters 只存语义 id，直接按 id 命中。 */
function filterMeta(catalogDimensions: CatalogMemberPayload[]) {
  return (reference: string) => catalogDimensions.find((item) => item.id === reference);
}

/** 「筛选」分区的内容：条件卡竖列。空列表时本件不渲染，由分区题行独自成节。 */
export function FilterEditor({
  filters,
  catalogDimensions,
  onChange,
}: {
  filters: Filter[];
  catalogDimensions: CatalogMemberPayload[];
  onChange: (filters: Filter[]) => void;
}) {
  const catalogFor = filterMeta(catalogDimensions);

  return (
    <div className="flex flex-col gap-2">
      {filters.map((filter, index) => {
        const member = catalogFor(filter.member);
        return (
          <FilterCard
            filter={filter}
            key={`${filter.member}-${index}`}
            member={member}
            memberId={filter.member}
            onChange={(next) => onChange(filters.map((item, at) => (at === index ? next : item)))}
            onRemove={() => onChange(filters.filter((_, at) => at !== index))}
            title={member?.title ?? filter.member}
          />
        );
      })}
    </div>
  );
}
