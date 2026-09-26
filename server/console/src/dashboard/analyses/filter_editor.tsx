import { useEffect, useState } from "react";
import { ChevronRightIcon, MinusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  isSearchableCatalogDimension,
  type PublicCatalogMember as CatalogMemberPayload,
} from "@contracts/catalog_contract";
import type { SemanticQueryView } from "@semantic-analysis";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { INSPECTOR_ROW_INDENT_CLASS, InspectorRow } from "@/components/ui/inspector";
import { NotebookCellItem } from "@/components/ui/notebook";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDimensionValues } from "../dashboard_queries";

type Filter = NonNullable<SemanticQueryView["filters"]>[number];

/** 取值可以有多个，关系文案写「是其中之一」，避免被理解成单值比较。 */
const RELATION_LABELS: Record<Filter["relation"], string> = {
  one_of: "是其中之一",
  none_of: "不是其中之一",
};

const VALUES_CLASS = cn(INSPECTOR_ROW_INDENT_CLASS, "px-2");

/** 已有取值的条件默认收起：收起的是编辑控件，已选取值仍然显示。 */
function FilterRow({
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
  const [open, setOpen] = useState(values.length === 0);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const searchable = isSearchableCatalogDimension(member);
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
    <div data-slot="filter-row">
      <Select
        items={RELATION_LABELS}
        onValueChange={(relation) => {
          if (relation === "one_of" || relation === "none_of") onChange({ ...filter, relation });
        }}
        value={filter.relation}
      >
        <InspectorRow
          actions={
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`移除 ${title} 筛选`}
                    className="text-pa-muted"
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
          }
          icon={
            <ChevronRightIcon
              aria-hidden="true"
              className={cn("transition-transform duration-200", open && "rotate-90")}
            />
          }
          label={
            <button
              aria-expanded={open}
              className="pa-focus max-w-full cursor-pointer truncate rounded-sm text-left"
              onClick={() => setOpen(!open)}
              type="button"
            >
              {title}
            </button>
          }
        >
          <SelectTrigger
            aria-label={`${title} 取值关系`}
            className="w-auto justify-end"
            size="sm"
            variant="ghost"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {(Object.keys(RELATION_LABELS) as Filter["relation"][]).map((relation) => (
              <SelectItem key={relation} value={relation}>
                {RELATION_LABELS[relation]}
              </SelectItem>
            ))}
          </SelectPopup>
        </InspectorRow>
      </Select>
      {open ? (
        <div className={cn(VALUES_CLASS, "flex flex-col gap-1.5 pb-1.5")}>
          {values.length ? (
            <div className="flex flex-wrap items-center gap-1.5">{values.map(chipOf)}</div>
          ) : null}
          <InputGroup className="text-sm">
            <InputGroupInput
              aria-label={`${title} 取值`}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                // 回车加入输入的原文：候选列表以外的取值和不可检索维度的取值只能这样加入。
                if (event.key === "Enter") {
                  event.preventDefault();
                  add(typed);
                }
              }}
              placeholder="搜索或输入取值"
              size="sm"
              type="search"
              value={typed}
            />
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
          {/* max-h-42 是整数行的高度，避免最后一行只显示一半。 */}
          <div className="-mx-2 max-h-42 overflow-y-auto">
            {candidates.map((value) => (
              <InspectorRow key={value} label={value} onClick={() => add(value)} />
            ))}
            {candidates.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-pa-muted">
                {searchable ? "没有更多取值" : "键入取值后回车加入"}
              </p>
            ) : null}
          </div>
        </div>
      ) : values.length ? (
        <div className={cn(VALUES_CLASS, "flex flex-wrap items-center gap-1.5 pb-1.5")}>
          {values.map(chipOf)}
        </div>
      ) : null}
    </div>
  );
}

/** 按语义 dimension id 查目录成员，用于取中文标题。 */
function filterMeta(catalogDimensions: CatalogMemberPayload[]) {
  return (reference: string) => catalogDimensions.find((item) => item.id === reference);
}

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
    <>
      {filters.map((filter, index) => {
        const member = catalogFor(filter.member);
        return (
          <FilterRow
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
    </>
  );
}
