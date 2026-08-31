import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";
import type * as React from "react";
import { InspectorRow } from "@/components/ui/inspector";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "pa-focus inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full bg-pa-surface px-[3px] transition-colors duration-150 data-checked:bg-pa-ink data-disabled:cursor-not-allowed data-disabled:opacity-64",
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
  tooltip,
  indent,
  id,
  disabled,
  ...props
}: SwitchPrimitive.Root.Props & {
  label: React.ReactNode;
  blocked?: React.ReactNode;
  tooltip?: React.ReactNode;
  indent?: boolean;
}): React.ReactElement {
  const generated = useId();
  const controlId = id ?? generated;
  const row = (
    <InspectorRow
      blocked={blocked}
      indent={indent}
      label={
        <label className={cn(!blocked && "cursor-pointer")} htmlFor={controlId}>
          {label}
        </label>
      }
    >
      <Switch disabled={disabled || Boolean(blocked)} id={controlId} {...props} />
    </InspectorRow>
  );
  if (!tooltip) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{row}</TooltipTrigger>
      <TooltipPopup className="max-w-56" side="left">
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
