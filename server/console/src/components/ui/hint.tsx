import type React from "react";
import { cn } from "@/lib/utils";

export const HINT_TEXT = "text-pa-muted text-xs";

export function Hint({ className, ...props }: React.ComponentProps<"p">): React.ReactElement {
  return <p className={cn(HINT_TEXT, className)} data-slot="hint" {...props} />;
}
