
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Frame({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative flex flex-col [&>*+*]:mt-10 [&>[data-slot=frame-panel-footer]]:mt-0",
        className,
      )}
      data-slot="frame"
      {...props}
    />
  );
}

export function FramePanel({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 border-b pb-8 last:border-b-0 last:pb-0",
        className,
      )}
      data-slot="frame-panel"
      {...props}
    />
  );
}

export function FrameFooter({
  className,
  ...props
}: React.ComponentProps<"footer">): React.ReactElement {
  return (
    <footer
      className={cn("flex items-center justify-end gap-2 pt-4", className)}
      data-slot="frame-panel-footer"
      {...props}
    />
  );
}
