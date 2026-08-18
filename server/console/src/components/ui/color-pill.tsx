"use client";

import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 色粒：一圈发丝环里一粒色点。未选是四成大的点，悬停长到五成半；选中即铺满整圆并压一枚反白勾。
 * 全站取色只有这一件——系列配色、表格单色色阶都用它，成排摆放由调用方定间距。
 */
export function ColorPill({
  color,
  selected = false,
  size = "default",
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  color: string;
  selected?: boolean;
  size?: "default" | "sm";
}): React.ReactElement {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group relative flex shrink-0 rounded-full text-pa-ink-fg ring-1 ring-pa-line ring-inset outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring",
        selected ? "cursor-default" : "cursor-pointer",
        size === "sm" ? "size-6" : "size-7",
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
