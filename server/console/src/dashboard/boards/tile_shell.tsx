import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 瓦片壳：卡面 + 标题行 + 右侧操作。壳自己就是边界，内容区不画框（见 `PLOT_FRAME.tile`）。
 * 操作钮的现身档由 `affordance` 定：查看态悬停/聚焦才现，编辑态常驻。
 * 拖拽/缩放进行中把它藏起来是那一块瓦片的状态，落在 styles.css 的 `.react-draggable-dragging` 规则上。
 */
export function TileShell({
  title,
  affordance = "hover",
  actions,
  children,
}: {
  title: ReactNode;
  affordance?: "hover" | "pinned";
  /** 标题行右侧操作（`⋯` 菜单等）。 */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group relative h-full min-h-0">
      <div className="pa-tile-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-pa-line bg-pa-bg">
        <header className="flex h-12 shrink-0 items-center gap-1 px-4">
          <span className="min-w-0 flex-1 truncate font-medium text-base text-pa-fg">{title}</span>
          {actions ? (
            <span
              data-dontdrag
              className={cn(
                "flex shrink-0 items-center gap-1",
                affordance === "pinned"
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
