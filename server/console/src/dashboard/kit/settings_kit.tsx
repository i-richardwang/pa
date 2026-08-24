import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";

export function RowBadge({ children }: { children: ReactNode }) {
  return <Avatar aria-hidden="true">{children}</Avatar>;
}
