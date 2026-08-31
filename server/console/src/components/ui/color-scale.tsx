import type * as React from "react";
import { cn } from "@/lib/utils";

/** 停点出自编译层 `shadingStops`，件本身不调色。 */
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

export function ColorScaleTick({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("block size-[5px] rounded-full bg-pa-ink opacity-50", className)}
      data-slot="color-scale-tick"
    />
  );
}
