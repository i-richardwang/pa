/**
 * 控制台清单页行文法：
 * - ListFacets：控制条左侧的分面片，切的是「看哪一批」
 * - DaysRangeChips：控制条右侧的时间窗，筛的是「看多久之内」
 * - ResourceName：行内名字格，整块即链接
 * - RowMenu：行尾 `…`
 * - useTableSort + SortableHead：客户端整表排序
 */
import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ListSegment, ListSegmentGroup } from "../layout/layout_chrome";
import { navigateTo } from "../router";

/**
 * 控制条上两类档位只有一条分界：分面改变看的是哪批东西，是页面的一个落点，
 * 走 hash、可书签、可前进后退；筛选只收窄同一批东西的范围，留在页内状态。
 * 两者同用分面片这一种控件，区别只在值落在哪。
 */
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

/** 日志类清单的时间窗：单选组，恒有一档选中。 */
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

/**
 * 清单行的名字格：**不带前缀图标**。本仓的资源没有自选图标这回事，
 * 摆上去的只能是按类型派生的那一枚——看板行摆的是同一枚（不带信息），
 * 报告行摆的是右边「图型」列已经写过的那件事。行里的信息各占一格，图标不是第二个格子。
 */
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
