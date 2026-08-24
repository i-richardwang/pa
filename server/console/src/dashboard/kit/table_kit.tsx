import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ListSegment, ListSegmentGroup } from "../layout/layout_chrome";
import { navigateTo } from "../router";

export function ListFacets<T extends string>({
  label,
  value,
  options,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hash: string }>;
}): React.ReactElement {
  return (
    <ListSegmentGroup label={label}>
      {options.map((option) => (
        <ListSegment
          key={option.value}
          onClick={() => navigateTo(option.hash)}
          selected={option.value === value}
        >
          {option.label}
        </ListSegment>
      ))}
    </ListSegmentGroup>
  );
}

const DAYS_RANGES = [7, 30, 90] as const;

/** 恒有一档选中。 */
export function DaysRangeChips({
  days,
  onDays,
}: {
  days: number;
  onDays: (days: number) => void;
}): React.ReactElement {
  return (
    <ListSegmentGroup label="时间窗">
      {DAYS_RANGES.map((r) => (
        <ListSegment key={r} onClick={() => onDays(r)} selected={days === r}>
          近 {r} 天
        </ListSegment>
      ))}
    </ListSegmentGroup>
  );
}

export function ResourceName({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <a
      href={href}
      className="inline-flex min-w-0 max-w-full items-center text-sm font-normal text-pa-fg transition-colors duration-150"
    >
      <span className="truncate">{children}</span>
    </a>
  );
}

export function RowMenu({
  label = "更多操作",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={label}
            size="icon-sm"
            variant="subtle"
            className="rounded-xl text-pa-fg hover:bg-pa-surface hover:text-pa-fg data-pressed:bg-pa-surface md:rounded-md [&_svg]:mx-0 [&_svg]:size-4"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

/** accessors 必须是模块级常量（稳定引用），否则每帧重排。 */
export function useTableSort<T, K extends string>(
  rows: readonly T[] | undefined,
  accessors: Record<K, (row: T) => string | number | null | undefined>,
): { rows: T[]; sort: SortState<K>; toggle: (key: K) => void } {
  const [sort, setSort] = useState<SortState<K>>(null);
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    if (!sort) return list;
    const get = accessors[sort.key];
    const flip = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * flip;
      return String(va).localeCompare(String(vb), "zh-Hans-CN") * flip;
    });
  }, [rows, sort, accessors]);
  function toggle(key: K) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }
  return { rows: sorted, sort, toggle };
}

export function SortableHead<K extends string>({
  label,
  k,
  sort,
  onToggle,
  className,
}: {
  label: string;
  k: K;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  className?: string;
}): React.ReactElement {
  const active = sort?.key === k;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={cn("group/head p-0", className)}
    >
      <button
        type="button"
        onClick={() => onToggle(k)}
        className="flex h-8 w-full cursor-pointer items-center gap-1 p-2 text-left transition-colors duration-150"
      >
        {label}
        <span className={active ? "" : "invisible group-hover/head:visible"} aria-hidden="true">
          {active && sort.dir === "desc" ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronUpIcon className="size-3" />
          )}
        </span>
      </button>
    </TableHead>
  );
}
