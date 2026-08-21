import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const TITLEBAR_HEIGHT = 51;

const ALIGN = {
  start: "justify-start",
  between: "justify-between",
  end: "justify-end",
} as const;

export function Titlebar({
  align = "start",
  as: Tag = "header",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
  align?: keyof typeof ALIGN;
  as?: "header" | "div";
}) {
  return (
    <Tag
      className={cn(
        "flex h-(--pa-titlebar) shrink-0 items-center gap-2 border-b border-transparent px-3",
        ALIGN[align],
        className,
      )}
      data-slot="titlebar"
      style={{ "--pa-titlebar": `${TITLEBAR_HEIGHT}px` } as CSSProperties}
      {...props}
    >
      {children}
    </Tag>
  );
}
