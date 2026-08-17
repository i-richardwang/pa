"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export function ChartTypePicker({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset adds browser layout that this segmented control cannot accept.
    <div
      className={cn("relative inline-flex h-8 w-full rounded-md", className)}
      data-slot="chart-type-picker"
      role="group"
    >
      {children}
    </div>
  );
}

export function ChartTypeOption({
  icon,
  label,
  selected,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
}): React.ReactElement {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-1 cursor-pointer items-center justify-center text-pa-muted outline-none transition-colors duration-150 hover:text-pa-ink focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring aria-pressed:text-pa-ink disabled:cursor-not-allowed disabled:text-pa-disabled-fg disabled:hover:text-pa-disabled-fg [&_svg]:relative [&_svg]:size-4",
        className,
      )}
      data-slot="chart-type-option"
      type="button"
      {...props}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-0 rounded-md bg-pa-surface" />
      ) : null}
      {icon}
    </button>
  );
}
