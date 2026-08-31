import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";
import { GLASS_POPUP_SURFACE, POPUP_WIDTH, type PopupWidth } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;

export function PopoverTrigger({
  className,
  ...props
}: PopoverPrimitive.Trigger.Props): React.ReactElement {
  return <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props} />;
}

export function PopoverPopup({
  children,
  className,
  width,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset,
  anchor,
  portalProps,
  ...props
}: PopoverPrimitive.Popup.Props & {
  width?: PopupWidth;
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  portalProps?: PopoverPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <PopoverPrimitive.Portal {...portalProps}>
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
            width && POPUP_WIDTH[width],
            GLASS_POPUP_SURFACE,
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
