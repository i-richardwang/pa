import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TileShell({
  title,
  interacting = false,
  affordance = "hover",
  frame = "md",
  actions,
  children,
}: {
  title: ReactNode;

  interacting?: boolean;

  affordance?: "hover" | "pinned";

  frame?: "md" | "xl";
  /** 标题行右侧操作（`⋯` 菜单等）。 */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pinned = affordance === "pinned";

  return (
    <div className="group relative h-full min-h-0">
      <div
        className={cn(
          "pa-tile-card flex h-full min-h-0 flex-col overflow-hidden border border-pa-line bg-pa-bg",
          frame === "xl" ? "rounded-xl" : "rounded-md",
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-1 px-4">
          <span className="min-w-0 flex-1 truncate font-medium text-base text-pa-fg">{title}</span>
          {actions ? (
            <span
              data-dontdrag
              className={cn(
                "flex shrink-0 items-center gap-1",
                interacting
                  ? "invisible"
                  : pinned
                    ? null
                    : "opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 group-has-[[data-popup-open]]:opacity-100",
              )}
            >
              {actions}
            </span>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export const tileEditMenuTriggerClass = "text-pa-fg-soft hover:text-pa-fg";
