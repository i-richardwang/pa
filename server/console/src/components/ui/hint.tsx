import { InfoIcon } from "lucide-react";
import type React from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const HINT_TEXT = "text-pa-muted text-xs";

export function Hint({ className, ...props }: React.ComponentProps<"p">): React.ReactElement {
  return <p className={cn(HINT_TEXT, className)} data-slot="hint" {...props} />;
}

export function BlockedHint({ reason }: { reason: React.ReactNode }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            className="pa-focus flex shrink-0 cursor-help items-center text-pa-faint"
            data-slot="blocked-hint"
            type="button"
          />
        }
      >
        <InfoIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}
