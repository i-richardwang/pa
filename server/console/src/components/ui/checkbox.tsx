"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const CHECKBOX =
  "pa-focus grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm border border-pa-line bg-pa-surface text-pa-ink-fg transition-colors duration-150 data-checked:border-pa-ink data-checked:bg-pa-ink data-disabled:cursor-not-allowed data-disabled:border-transparent data-disabled:text-pa-disabled-fg data-indeterminate:border-pa-ink data-indeterminate:bg-pa-ink [&_svg]:size-3";

export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props): React.ReactElement {
  return (
    <CheckboxPrimitive.Root className={cn(CHECKBOX, className)} data-slot="checkbox" {...props}>
      <CheckboxPrimitive.Indicator
        className="grid place-items-center data-unchecked:hidden"
        data-slot="checkbox-indicator"
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>{state.indeterminate ? <MinusIcon /> : <CheckIcon />}</span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}
