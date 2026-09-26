import type { ReactNode } from "react";

/**
 * 中性徽标，用于派生标记、截断说明等短标签。
 * 外观须与控制台 `ui/badge.tsx` 的中性样式一致（本包不依赖控制台），由 console_contract_boundary.test.ts 检查。
 */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm bg-pa-surface px-1.5 font-medium text-pa-muted text-xs">
      {children}
    </span>
  );
}
