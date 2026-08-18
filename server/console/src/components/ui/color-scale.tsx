"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 色阶样片：一条从下限到上限的渐变，横向是胶囊（描边可选）、纵向是直条。
 * 颜色由调用方给停点（编译层 `shadingStops` 的取值），件本身不调色。
 */
export function ColorScale({
  stops,
  vertical = false,
  outlined = false,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  stops: readonly string[];
  vertical?: boolean;
  outlined?: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block shrink-0",
        vertical ? "w-1" : "h-3 rounded-full",
        outlined && "ring-1 ring-pa-line ring-inset",
        className,
      )}
      data-slot="color-scale"
      style={{
        background: `linear-gradient(${vertical ? "to top" : "to right"}, ${stops.join(", ")})`,
        ...style,
      }}
      {...props}
    />
  );
}

/** 纵向色阶上的停点圆钮：填该停的颜色，白边一圈把它从色条上抬起来。 */
export function ColorScaleStop({
  color,
  className,
}: {
  color: string;
  className?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-4 rounded-full border-[3px] border-pa-bg ring-1 ring-pa-line",
        className,
      )}
      data-slot="color-scale-stop"
      style={{ backgroundColor: color }}
    />
  );
}

/** 横向色阶上的阈值刻点：一粒半透明墨点。 */
export function ColorScaleTick({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("block size-[5px] rounded-full bg-pa-ink opacity-50", className)}
      data-slot="color-scale-tick"
    />
  );
}
