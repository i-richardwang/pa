import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import {
  GLASS_POPUP_SURFACE,
  POPUP_ROW,
  POPUP_WIDTH,
  type PopupWidth,
} from "@/components/ui/surface";
import { cn } from "@/lib/utils";

const MENU_ITEM_CLASS = cn(
  POPUP_ROW,
  "flex w-full cursor-pointer select-none items-center text-pa-fg outline-none data-disabled:pointer-events-none data-disabled:text-pa-muted data-highlighted:bg-pa-surface [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-pa-fg",
);

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

export function MenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  width = "menu",
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  ...props
}: MenuPrimitive.Popup.Props & {
  width?: PopupWidth;
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  portalProps?: MenuPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <MenuPrimitive.Portal {...portalProps}>
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
            "relative flex origin-(--transform-origin) flex-col overflow-hidden outline-none",
            POPUP_WIDTH[width],
            GLASS_POPUP_SURFACE,
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1.5">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({ className, ...props }: MenuPrimitive.Item.Props): React.ReactElement {
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
