import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";

/** 清单行首的圆形标识片：人给首字母，物给类型图标。 */
export function RowBadge({ children }: { children: ReactNode }) {
  return <Avatar aria-hidden="true">{children}</Avatar>;
}
