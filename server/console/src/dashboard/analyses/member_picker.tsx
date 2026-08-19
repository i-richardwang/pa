import { useMemo, useState, type ReactNode } from "react";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicMetricDomain as MetricDomainPayload,
} from "@contracts/catalog_contract";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteSearch,
  AutocompleteTrigger,
  useAutocompleteFilter,
} from "@/components/ui/autocomplete";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type PickableMember = CatalogMemberPayload & {
  canonical_name: string;
  incompatible: boolean;
  incompatible_reason?: string;
  /** 图标位的记号；不给就按度量 / 维度出实心 / 空心菱形。非目录条目（构成占比）用它自报身份。 */
  icon?: ReactNode;
};

export type MemberGroup = { label: string; items: PickableMember[] };

const UNGROUPED_LABEL = "其他";

/** 实心菱形：度量行。 */
export function DiamondFilled({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-pa-faint", className)}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.68478 8.91919C3.1771 8.41151 3.1771 7.5884 3.68478 7.08072L7.08072 3.68478C7.5884 3.1771 8.41151 3.1771 8.91919 3.68478L12.3151 7.08072C12.8228 7.5884 12.8228 8.41151 12.3151 8.91919L8.91919 12.3151C8.41151 12.8228 7.5884 12.8228 7.08072 12.3151L3.68478 8.91919Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 空心菱形：维度行，与度量的实心菱形成对。 */
export function DiamondOutline({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-pa-faint", className)}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M7.99995 4.60402L4.60402 7.99995L7.99995 11.3959L11.3959 7.99995L7.99995 4.60402ZM3.68478 7.08072C3.1771 7.5884 3.1771 8.41151 3.68478 8.91919L7.08072 12.3151C7.5884 12.8228 8.41151 12.8228 8.91919 12.3151L12.3151 8.91919C12.8228 8.41151 12.8228 7.5884 12.3151 7.08072L8.91919 3.68478C8.41151 3.1771 7.5884 3.1771 7.08072 3.68478L3.68478 7.08072Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function pickableMembers(
  members: CatalogMemberPayload[],
  selectedDimensions: string[],
  blockedDimensions: string[] = [],
): PickableMember[] {
  const selected = new Set(selectedDimensions);
  const blocked = new Set(blockedDimensions);
  return members.map((member) => {
    const incompatible = Boolean(
      (member.kind === "dimension" && blocked.has(member.id)) ||
        member.incompatible_dimensions?.some((dimension) => selected.has(dimension)),
    );
    return {
      ...member,
      canonical_name: member.id,
      incompatible,
      ...(incompatible ? { incompatible_reason: "与当前分组不兼容" } : {}),
    };
  });
}

/**
 * 指标 id → 指标域标题。从属关系只由域那一头说（目录契约），一个指标出现在多个域时取先出现的域；
 * 组序即目录里域的次序，与指标字典页同一套导航次序。
 */
export function metricDomainTitles(domains: readonly MetricDomainPayload[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const domain of domains) {
    for (const id of domain.measure_ids) if (!titles.has(id)) titles.set(id, domain.title);
  }
  return titles;
}

export function groupMembers(
  members: PickableMember[],
  measureGroups: ReadonlyMap<string, string> = new Map(),
): MemberGroup[] {
  const groups: MemberGroup[] = [];
  const byLabel = new Map<string, PickableMember[]>();
  const push = (label: string, member: PickableMember) => {
    const existing = byLabel.get(label);
    if (existing) {
      existing.push(member);
      return;
    }
    const items = [member];
    byLabel.set(label, items);
    groups.push({ label, items });
  };
  const ungrouped: PickableMember[] = [];
  const measureOrder = [...new Set(measureGroups.values())];
  for (const member of members) {
    const title =
      member.kind === "measure" ? measureGroups.get(member.id) : member.dimension_group?.title;
    if (title) push(title, member);
    else ungrouped.push(member);
  }
  for (const member of ungrouped) push(UNGROUPED_LABEL, member);
  // 维度组序取成员首次出现（属性组无全局次序）；指标域有目录次序，按它排，兜底桶恒末位。
  const rank = (label: string) => {
    const index = measureOrder.indexOf(label);
    if (label === UNGROUPED_LABEL) return Number.MAX_SAFE_INTEGER;
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER - 1;
  };
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.label) - rank(b.group.label) || a.index - b.index)
    .map(({ group }) => group);
}

/** 一行成员。不可选的原因进可及名，鼠标另给 Tooltip。 */
function MemberItem({
  member,
  chosen,
  onPick,
}: {
  member: PickableMember;
  chosen: boolean;
  onPick: (member: PickableMember) => void;
}) {
  const state = member.incompatible
    ? (member.incompatible_reason ?? "当前不可用")
    : chosen
      ? "已在当前查询中"
      : "";
  const detail = member.description.trim();
  const item = (
    <AutocompleteItem
      // 不可选的行仍要能悬停：理由在 Tooltip 里，指针穿过去就读不到了。
      className={state ? "data-disabled:pointer-events-auto" : undefined}
      disabled={Boolean(state)}
      onClick={() => onPick(member)}
      value={member}
    >
      {member.icon ?? (member.kind === "measure" ? <DiamondFilled /> : <DiamondOutline />)}
      <span className="min-w-0 flex-1 truncate">{member.title}</span>
      {state ? <span className="sr-only">（{state}）</span> : null}
    </AutocompleteItem>
  );
  if (!state && !detail) return item;
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipPopup align="start" className="max-w-64" side="left">
        <div className="flex flex-col gap-0.5 py-0.5 text-left">
          {state && <p className="font-medium">{state}</p>}
          {detail && <p className={state ? "opacity-75" : undefined}>{detail}</p>}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function MemberPopover({
  trigger,
  members,
  selected,
  emptyLabel = "没有可用字段",
  selectedDimensions,
  blockedDimensions = [],
  extras,
  metricDomains,
  onPick,
}: {
  trigger: React.ReactElement;
  members: CatalogMemberPayload[];
  selected?: string[];
  emptyLabel?: string;
  selectedDimensions: string[];
  blockedDimensions?: string[];
  /**
   * 排在目录成员之后的一节非目录条目（例如由已选指标算出来的构成占比）。它们与目录成员
   * 走同一份行、同一套搜索与不可选理由——加进查询的东西只有一个入口、一种列表语法。
   */
  extras?: MemberGroup;
  /** 指标域清单（目录契约）：指标行按它分节；不给就不分节。 */
  metricDomains?: readonly MetricDomainPayload[];
  onPick: (member: PickableMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { contains } = useAutocompleteFilter({ sensitivity: "base" });
  const groups = useMemo(() => {
    const grouped = groupMembers(
      pickableMembers(members, selectedDimensions, blockedDimensions),
      metricDomainTitles(metricDomains ?? []),
    );
    return extras?.items.length ? [...grouped, extras] : grouped;
  }, [members, selectedDimensions, blockedDimensions, extras, metricDomains]);
  const chosen = new Set(selected ?? []);

  return (
    // 英文成员名也参与命中——它是与 Agent 应答对账的锚点，用户会照着它搜。
    <Autocomplete
      filter={(member, input) =>
        contains((member as PickableMember).title, input) ||
        contains((member as PickableMember).id, input)
      }
      items={groups}
      itemToStringValue={(member: unknown) => (member as PickableMember).title}
      onOpenChange={setOpen}
      onOpenChangeComplete={() => setQuery("")}
      onValueChange={(next, details) => {
        if (details.reason !== "item-press") setQuery(next);
      }}
      open={open}
      value={query}
    >
      <AutocompleteTrigger render={trigger} />
      <AutocompletePopup className="w-[299px] min-w-[240px] max-w-[480px]">
        <AutocompleteSearch aria-label="搜索字段" placeholder="搜索指标或维度" />
        {/* Empty 的根必须常挂着，读屏靠它播报结果条数的变化；变的只是它的孩子。 */}
        <AutocompleteEmpty>{emptyLabel}</AutocompleteEmpty>
        <AutocompleteList>
          {(group: MemberGroup) => (
            <AutocompleteGroup items={group.items} key={group.label}>
              <AutocompleteGroupLabel>{group.label}</AutocompleteGroupLabel>
              <AutocompleteCollection>
                {(member: PickableMember) => (
                  <MemberItem
                    chosen={chosen.has(member.id)}
                    key={member.id}
                    member={member}
                    onPick={(picked) => {
                      onPick(picked);
                      setOpen(false);
                    }}
                  />
                )}
              </AutocompleteCollection>
            </AutocompleteGroup>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
