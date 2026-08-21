"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";
import { BlockedHint } from "@/components/ui/inspector";
import { GLASS_POPUP_SURFACE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;
const PopoverPortal: typeof PopoverPrimitive.Portal =
  PopoverPrimitive.Portal;
export function PopoverTrigger({
  className,
  ...props
}: PopoverPrimitive.Trigger.Props): React.ReactElement {
  return (
    <PopoverPrimitive.Trigger
      className={className}
      data-slot="popover-trigger"
      {...props}
    />
  );
}

export function PopoverPopup({
  children,
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset,
  anchor,
  portalProps,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  portalProps?: PopoverPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <PopoverPortal {...portalProps}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "relative max-h-(--available-height) origin-(--transform-origin) overflow-y-auto outline-none",
            GLASS_POPUP_SURFACE,
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  );
}

export { PopoverPrimitive };

/**
 * 设置浮层里的组题。菜单族的组题走 `POPUP_GROUP_LABEL`（与菜单行同缩进）；
 * 这一档给浮层里摆控件与清单行的那种面，缩进与行对齐。
 */
export function PopoverSettingTitle({
  blocked,
  children,
}: {
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex min-w-0 items-center gap-1 px-2 py-1.5"
      data-slot="popover-setting-title"
    >
      <span
        className={cn(
          "min-w-0 truncate font-semibold text-md leading-5",
          blocked ? "text-pa-faint" : "text-pa-ink",
        )}
      >
        {children}
      </span>
      {blocked ? <BlockedHint reason={blocked} /> : null}
    </div>
  );
}
