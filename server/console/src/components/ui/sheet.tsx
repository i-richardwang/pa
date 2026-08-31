import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { XIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import {
  DIALOG_BACKDROP_CLASS,
  OVERLAY_CLOSE_INSET_CLASS,
  OverlayCloseButton,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Sheet: typeof SheetPrimitive.Root = SheetPrimitive.Root;

const SIDESHEET_WIDTH = "max-w-160";

type SheetSide = "right" | "left" | "bottom";

const SHEET_VIEWPORT: Record<SheetSide, string> = {
  bottom: "grid-rows-[1fr_auto] pt-12",
  left: "flex justify-start",
  right: "flex justify-end",
};

const SHEET_POPUP: Record<SheetSide, string> = {
  bottom: "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
  left: "w-[calc(100%-(--spacing(12)))] max-w-md border-e data-ending-style:-translate-x-1/2 data-starting-style:-translate-x-1/2",
  right: `col-start-2 w-[calc(100%-(--spacing(12)))] ${SIDESHEET_WIDTH} border-s data-ending-style:translate-x-1/2 data-starting-style:translate-x-1/2`,
};

export function SheetPopup({
  className,
  children,
  showCloseButton = true,
  side = "right",
  closeProps,
  portalProps,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  side?: SheetSide;
  closeProps?: SheetPrimitive.Close.Props;
  portalProps?: SheetPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <SheetPrimitive.Portal {...portalProps}>
      <SheetPrimitive.Backdrop className={DIALOG_BACKDROP_CLASS} data-slot="sheet-backdrop" />
      <SheetPrimitive.Viewport
        className={cn("fixed inset-0 z-50 grid", SHEET_VIEWPORT[side])}
        data-slot="sheet-viewport"
      >
        <SheetPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-pa-bg text-pa-fg shadow-md transition-[opacity,translate] duration-150 ease-out will-change-transform data-ending-style:opacity-0 data-starting-style:opacity-0",
            SHEET_POPUP[side],
            className,
          )}
          data-slot="sheet-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label="关闭"
              className={OVERLAY_CLOSE_INSET_CLASS}
              render={<OverlayCloseButton />}
              {...closeProps}
            >
              <XIcon />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col gap-2 p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-3 max-sm:pb-4",
      className,
    ),
    "data-slot": "sheet-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SheetTitle({
  className,
  ...props
}: SheetPrimitive.Title.Props): React.ReactElement {
  return (
    <SheetPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props): React.ReactElement {
  return (
    <SheetPrimitive.Description
      className={cn("text-pa-muted text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export function SheetPanel({
  className,
  scrollFade = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn("p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-header])]:pt-1", className),
    "data-slot": "sheet-panel",
  };

  return (
    <ScrollArea scrollFade={scrollFade}>
      {useRender({
        defaultTagName: "div",
        props: mergeProps<"div">(defaultProps, props),
        render,
      })}
    </ScrollArea>
  );
}
