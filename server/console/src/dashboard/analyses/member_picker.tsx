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

export type PickableMember = {
  id: string;
  kind: CatalogMemberPayload["kind"];
  title: string;
  description: string;
  dimension_group?: { id: string; title: string };
  canonical_name: string;
  incompatible: boolean;
  incompatible_reason?: string;
  /** 行首图标；不传时度量用实心菱形、维度用空心菱形。非目录条目（如构成占比）用它指定图标。 */
  icon?: ReactNode;
};

export type MemberGroup = { label: string; items: PickableMember[] };

const UNGROUPED_LABEL = "其他";

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
  candidateIssue?: (member: CatalogMemberPayload) => string | undefined,
): PickableMember[] {
  return members.map((member) => {
    const reason = candidateIssue?.(member);
    return {
      ...member,
      canonical_name: member.id,
      incompatible: Boolean(reason),
      ...(reason ? { incompatible_reason: reason } : {}),
    };
  });
}

/**
 * 指标 id → 指标域标题。归属以域的 measure_ids 为准，一个指标属于多个域时取先出现的域；
 * 分组顺序即目录中域的顺序，与指标页一致。
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
  // 维度组按成员首次出现排序（属性组没有全局顺序）；指标域按目录顺序；「其他」组排最后。
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

/** 不可选的原因写进可访问名称，鼠标悬停时另用 Tooltip 显示。 */
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
      // 不可选的行也要响应悬停，才能显示 Tooltip 里的原因。
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
  candidateIssue,
  extras,
  metricDomains,
  onPick,
}: {
  trigger: React.ReactElement;
  members: CatalogMemberPayload[];
  selected?: string[];
  emptyLabel?: string;
  candidateIssue?: (member: CatalogMemberPayload) => string | undefined;
  /** 非目录条目（如构成占比），与目录成员使用同样的行和不可选原因。 */
  extras?: MemberGroup;
  /** 指标域列表：指标按它分组；不传则不分组。 */
  metricDomains?: readonly MetricDomainPayload[];
  onPick: (member: PickableMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { contains } = useAutocompleteFilter({ sensitivity: "base" });
  const groups = useMemo(() => {
    const grouped = groupMembers(
      pickableMembers(members, candidateIssue),
      metricDomainTitles(metricDomains ?? []),
    );
    return extras?.items.length ? [...grouped, extras] : grouped;
  }, [members, candidateIssue, extras, metricDomains]);
  const chosen = new Set(selected ?? []);

  return (
    // 搜索也匹配成员 id，用户会照 Agent 回复里的 id 搜索。
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
      <AutocompletePopup width="picker">
        <AutocompleteSearch aria-label="搜索字段" placeholder="搜索指标或维度" />
        {/* AutocompleteEmpty 须始终挂载，读屏依靠它播报结果数量的变化。 */}
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
