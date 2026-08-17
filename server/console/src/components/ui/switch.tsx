"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";
import type * as React from "react";
import { BlockedHint } from "@/components/ui/inspector";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full bg-pa-surface px-[3px] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring data-checked:bg-pa-ink data-disabled:cursor-not-allowed data-disabled:opacity-64",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-3.5 rounded-full bg-pa-ink-fg transition-transform duration-150 data-checked:translate-x-5"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export function SwitchField({
  label,
  blocked,
  className,
  id,
  disabled,
  ...props
}: SwitchPrimitive.Root.Props & {
  label: React.ReactNode;
  blocked?: React.ReactNode;
}): React.ReactElement {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div
      className={cn("flex min-h-8 items-center gap-0.5 text-sm", className)}
      data-slot="switch-field"
    >
      <label
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 truncate",
          blocked ? "text-pa-faint" : "cursor-pointer text-pa-muted",
        )}
        htmlFor={controlId}
      >
        <span className="min-w-0 truncate">{label}</span>
      </label>
      {blocked ? <BlockedHint reason={blocked} /> : null}
      <Switch disabled={disabled || Boolean(blocked)} id={controlId} {...props} />
    </div>
  );
}

export { SwitchPrimitive };
