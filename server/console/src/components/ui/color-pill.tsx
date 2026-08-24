"use client";

import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function ColorPill({
  color,
  selected = false,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  color: string;
  selected?: boolean;
}): React.ReactElement {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "pa-focus group relative flex size-6 shrink-0 rounded-full text-pa-ink-fg ring-1 ring-pa-line ring-inset",
        selected ? "cursor-default" : "cursor-pointer",
        className,
      )}
      data-slot="color-pill"
      type="button"
      {...props}
    >
      <span
        className={cn(
          "relative m-auto aspect-square rounded-full transition-[width] duration-150",
          selected ? "w-full" : "w-[40%] group-hover:w-[55%]",
        )}
        style={{ backgroundColor: color }}
      >
        <CheckIcon
          aria-hidden="true"
          className={cn(
            "absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150",
            selected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </button>
  );
}
