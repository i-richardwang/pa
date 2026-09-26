import type * as React from "react";
import { BlockedHint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

export const GLASS_POPUP_SURFACE = "pa-popup-surface";

export const GLASS_STAGE_SURFACE = "pa-popup-surface pa-popup-surface-stage";

export const POPUP_WIDTH = {
  menu: "w-45",
  list: "w-max min-w-60 max-w-120",
  settings: "w-64",
  picker: "w-75",
} as const;

export type PopupWidth = keyof typeof POPUP_WIDTH;

export const POPUP_ROW = "min-h-8 gap-2.5 rounded-md py-2 pr-2.5 pl-3 text-sm leading-4";

/** 浮层分组标题与右栏分节标题共用这套排印。 */
export const SECTION_TITLE_TEXT = "font-semibold text-md text-pa-ink leading-4";

export const POPUP_TITLE = cn("truncate px-3 py-2", SECTION_TITLE_TEXT);

export function PopupTitle({
  blocked,
  children,
}: {
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className={cn(POPUP_TITLE, "min-w-0", blocked && "text-pa-faint")} data-slot="popup-title">
        {children}
      </p>
      {blocked ? <BlockedHint reason={blocked} /> : null}
    </div>
  );
}

/** `-mx-1.5` 假定所在浮层正文的内边距为 1.5，分隔线才能贴到浮层边缘。 */
export function PopupSection({
  label,
  blocked,
  children,
}: {
  label?: React.ReactNode;
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="-mx-1.5 mt-1.5 border-pa-line border-t px-1.5 pt-1.5 first:mt-0 first:border-t-0 first:pt-0"
      data-slot="popup-section"
    >
      {label ? <PopupTitle blocked={blocked}>{label}</PopupTitle> : null}
      {children}
    </div>
  );
}
