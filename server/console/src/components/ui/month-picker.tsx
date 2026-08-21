"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type MonthRange = { from: string; to: string };

const parseMonth = (value: string | undefined) => {
  const match = value?.match(YEAR_MONTH);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : undefined;
};
const monthIndex = (value: string) => {
  const parsed = parseMonth(value);
  return parsed ? parsed.year * 12 + parsed.month - 1 : Number.NaN;
};
const formatMonth = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

function MonthCell({
  label,
  state,
  onSelect,
}: {
  label: string;
  state: {
    selected: boolean;
    inRange: boolean;
    bandStart: boolean;
    bandEnd: boolean;
    current: boolean;
  };
  onSelect: () => void;
}): React.ReactElement {
  const { selected, inRange, bandStart, bandEnd, current } = state;
  return (
    <div
      className={cn(
        "flex justify-center",
        inRange && "bg-pa-highlight-bg",
        bandStart && "bg-linear-to-r from-transparent from-50% to-pa-highlight-bg to-50%",
        bandEnd && "bg-linear-to-l from-transparent from-50% to-pa-highlight-bg to-50%",
      )}
    >
      <button
        aria-pressed={selected}
        className={cn(
          "pa-focus h-10 w-full cursor-pointer rounded-full border-2 border-transparent text-base transition-colors duration-150",
          "text-pa-muted hover:bg-pa-surface",
          (inRange || bandStart || bandEnd || current) && "text-pa-highlight",
          selected && "border-pa-highlight-bg bg-pa-highlight-bg text-pa-highlight",
        )}
        onClick={onSelect}
        type="button"
      >
        {label}
      </button>
    </div>
  );
}

function MonthGrid({
  year,
  onYearChange,
  cellState,
  onSelect,
}: {
  year: number;
  onYearChange: (year: number) => void;
  cellState: (month: number) => React.ComponentProps<typeof MonthCell>["state"];
  onSelect: (month: number) => void;
}): React.ReactElement {
  const arrow =
    "pa-focus grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-pa-fg hover:bg-pa-surface [&_svg]:size-4";
  return (
    <div className="w-[280px]">
      <div className="flex h-11 items-center justify-between">
        <button
          aria-label="上一年"
          className={arrow}
          onClick={() => onYearChange(year - 1)}
          type="button"
        >
          <ChevronLeftIcon />
        </button>
        <span aria-live="polite" className="font-semibold text-lg text-pa-fg" role="status">
          {year}年
        </span>
        <button
          aria-label="下一年"
          className={arrow}
          onClick={() => onYearChange(year + 1)}
          type="button"
        >
          <ChevronRightIcon />
        </button>
      </div>
      <div className="grid grid-cols-3">
        {MONTH_LABELS.map((label, index) => (
          <MonthCell
            key={label}
            label={label}
            onSelect={() => onSelect(index + 1)}
            state={cellState(index + 1)}
          />
        ))}
      </div>
    </div>
  );
}

function MonthInput({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (next: string) => {
    setDraft(next);
    if (YEAR_MONTH.test(next)) onValueChange(next);
  };
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        aria-invalid={draft.length > 0 && !YEAR_MONTH.test(draft) ? true : undefined}
        inputMode="numeric"
        onBlur={() => setDraft(value)}
        onChange={(event) => commit(event.target.value)}
        placeholder="2026-08"
        value={draft}
      />
    </Field>
  );
}

function PickerDialog({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup aria-label={label} className="max-w-[640px] p-4" showCloseButton={false}>
        {children}
      </DialogPopup>
    </Dialog>
  );
}

export function MonthPickerDialog({
  open,
  onOpenChange,
  label,
  value,
  onValueChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 弹层的无障碍名，同时作字段名。 */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  current?: string;
}): React.ReactElement {
  const selected = parseMonth(value);
  const [year, setYear] = useState(selected?.year ?? new Date().getFullYear());
  useEffect(() => {
    if (open && selected) setYear(selected.year);
  }, [open, selected?.year]);
  const currentMonth = parseMonth(current);
  return (
    <PickerDialog label={label} onOpenChange={onOpenChange} open={open}>
      <div className="mb-8">
        <MonthInput label={label} onValueChange={onValueChange} value={value} />
      </div>
      <div className="flex justify-center">
        <MonthGrid
          cellState={(month) => ({
            selected: selected?.year === year && selected.month === month,
            inRange: false,
            bandStart: false,
            bandEnd: false,
            current: currentMonth?.year === year && currentMonth.month === month,
          })}
          onSelect={(month) => {
            onValueChange(formatMonth(year, month));
            onOpenChange(false);
          }}
          onYearChange={setYear}
          year={year}
        />
      </div>
    </PickerDialog>
  );
}

export function MonthRangePickerDialog({
  open,
  onOpenChange,
  label,
  fromLabel,
  toLabel,
  value,
  onValueChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  fromLabel: string;
  toLabel: string;
  value: MonthRange;
  onValueChange: (value: MonthRange) => void;
  current?: string;
}): React.ReactElement {
  const [anchor, setAnchor] = useState<string>();
  const [year, setYear] = useState(parseMonth(value.to)?.year ?? new Date().getFullYear());
  useEffect(() => {
    if (!open) return;
    setAnchor(undefined);
    setYear(parseMonth(value.to)?.year ?? new Date().getFullYear());
  }, [open]);

  const from = anchor ?? value.from;
  const to = anchor ? undefined : value.to;
  const fromIndex = monthIndex(from);
  const toIndex = to ? monthIndex(to) : Number.NaN;
  const currentMonth = parseMonth(current);

  const pick = (month: number) => {
    const picked = formatMonth(year, month);
    if (!anchor) {
      setAnchor(picked);
      return;
    }
    const pair =
      monthIndex(picked) < monthIndex(anchor)
        ? { from: picked, to: anchor }
        : { from: anchor, to: picked };
    setAnchor(undefined);
    onValueChange(pair);
    onOpenChange(false);
  };

  return (
    <PickerDialog label={label} onOpenChange={onOpenChange} open={open}>
      <div className="mb-8 flex gap-4">
        <MonthInput
          label={fromLabel}
          onValueChange={(next) =>
            onValueChange({
              from: next,
              to: monthIndex(next) > monthIndex(value.to) ? next : value.to,
            })
          }
          value={value.from}
        />
        <MonthInput
          label={toLabel}
          onValueChange={(next) =>
            onValueChange({
              from: monthIndex(next) < monthIndex(value.from) ? next : value.from,
              to: next,
            })
          }
          value={value.to}
        />
      </div>
      <div className="flex justify-center">
        <MonthGrid
          cellState={(month) => {
            const index = year * 12 + month - 1;
            return {
              selected: index === fromIndex || index === toIndex,
              inRange: index > fromIndex && index < toIndex,
              bandStart: Number.isFinite(toIndex) && index === fromIndex && fromIndex !== toIndex,
              bandEnd: Number.isFinite(toIndex) && index === toIndex && fromIndex !== toIndex,
              current: currentMonth?.year === year && currentMonth.month === month,
            };
          }}
          onSelect={pick}
          onYearChange={setYear}
          year={year}
        />
      </div>
    </PickerDialog>
  );
}
