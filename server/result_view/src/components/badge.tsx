import type { ReactNode } from "react";

/**
 * 中性徽标：派生标记、截断说明这类随内容走的短标签。
 *
 * 形与控制台 `ui/badge.tsx` 的中性档同值。这里手写而非取那件，是因为本包不带宿主、
 * 也不引 cva/tailwind-merge；两边同值由 console_contract_boundary.test.ts 看住。
 */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm bg-pa-surface px-1.5 font-medium text-pa-muted text-xs">
      {children}
    </span>
  );
}
