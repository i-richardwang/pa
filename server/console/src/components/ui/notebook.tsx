"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type NotebookTone = "strong" | "muted";

const TONE = {
  strong: {
    itemActive: "border-transparent bg-pa-surface text-pa-ink hover:bg-pa-selected",
    itemGuide: "border-pa-line text-pa-muted hover:border-pa-line-strong hover:bg-pa-surface",
  },
  muted: {
    itemActive: "border-transparent bg-pa-surface text-pa-ink hover:bg-pa-selected",
    itemGuide: "border-pa-line text-pa-muted hover:border-pa-line-strong hover:bg-pa-surface",
  },
} as const satisfies Record<NotebookTone, Record<string, string>>;

const ITEM_SHELL =
  "inline-flex h-6 max-w-40 items-stretch rounded-full border border-transparent text-sm transition-colors duration-150";

const ITEM_BODY =
  "flex min-w-0 cursor-pointer items-center gap-1 px-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring disabled:pointer-events-none disabled:text-pa-disabled-fg";

export function NotebookCellItem({
  tone = "strong",
  guide = false,
  icon,
  right,
  render,
  className,
  children,
  ...props
}: useRender.ComponentProps<"button"> & {
  tone?: NotebookTone;

  guide?: boolean;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}): React.ReactElement {
  const shell = cn(ITEM_SHELL, guide ? TONE[tone].itemGuide : TONE[tone].itemActive, className);
  const full = typeof children === "string" ? children : undefined;
  const defaultProps = {
    title: full,
    children: (
      <>
        {icon}
        {children ? <span className="min-w-0 truncate">{children}</span> : null}
      </>
    ),
    className: right ? cn(ITEM_BODY, "h-full pr-0") : cn(shell, ITEM_BODY),
    "data-slot": "notebook-cell-item",
    type: render ? undefined : ("button" as const),
  };
  const body = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });

  if (!right) return body;
  return (
    <span className={shell} data-slot="notebook-cell-item-shell" title={full}>
      {body}
      <span className="flex items-center pr-2 pl-1 opacity-60 transition-opacity hover:opacity-100">
        {right}
      </span>
    </span>
  );
}
