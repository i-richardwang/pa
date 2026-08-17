"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = { left: 400, right: 355 } as const;

export function ViewSidebar({
  side,
  open,
  width = SIDEBAR_WIDTH[side],
  className,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  width?: number;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <aside
      className={cn(
        "relative shrink-0 overflow-y-auto overflow-x-hidden bg-pa-bg",

        open && (side === "left" ? "border-r" : "border-l"),

        side === "right" && "max-sm:ms-auto",
        className,
      )}
      data-side={side}
      data-slot="view-sidebar"
      style={{ width: open ? width : 0 }}
    >

      <div className="absolute h-full" style={{ width }}>
        {children}
      </div>
    </aside>
  );
}
