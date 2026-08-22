import type { ReactNode } from "react";

/**
 * 中性徽标：派生标记、截断说明这类随内容走的短标签。
 *
 * 与控制台 `ui/badge.tsx` 的中性档同形；本包不引控制台，同值由 console_contract_boundary.test.ts 看住。
 */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm bg-pa-surface px-1.5 font-medium text-pa-muted text-xs">
      {children}
    </span>
  );
}
