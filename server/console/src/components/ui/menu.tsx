"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { GLASS_POPUP_SURFACE, POPUP_ROW } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

const MENU_ITEM_CLASS = cn(
  POPUP_ROW,

  "flex w-full cursor-pointer select-none items-center text-pa-fg outline-none data-disabled:pointer-events-none data-disabled:text-pa-muted data-highlighted:bg-pa-surface [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-pa-fg",
);

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

const MenuPortal = MenuPrimitive.Portal;

export function MenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      {...props}
    >
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  viewportClassName,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  portalProps?: MenuPrimitive.Portal.Props;
    viewportClassName?: string;
}): React.ReactElement {
  return (
    <MenuPortal {...portalProps}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:w-[180px] origin-(--transform-origin) flex-col overflow-hidden outline-none focus:outline-none",
            GLASS_POPUP_SURFACE,
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div
            className={cn(
              "max-h-(--available-height) w-full overflow-y-auto p-1.5",
              viewportClassName,
            )}
          >
            {children}
          </div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPortal>
  );
}

export function MenuItem({
  className,
  ...props
}: MenuPrimitive.Item.Props): React.ReactElement {
  return (
    <MenuPrimitive.Item
      className={cn(MENU_ITEM_CLASS, className)}
      data-slot="menu-item"
      {...props}
    />
  );
}

export function MenuLinkItem({
  className,
  closeOnClick = true,
  ...props
}: MenuPrimitive.LinkItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.LinkItem
      className={cn(MENU_ITEM_CLASS, className)}
      closeOnClick={closeOnClick}
      data-slot="menu-link-item"
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-pa-line", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export function MenuDangerGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("-mx-1.5 -mb-1.5 mt-1 border-t border-pa-line p-1.5", className)}
      data-slot="menu-danger-group"
      {...props}
    />
  );
}
