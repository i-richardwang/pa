import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root;

export function DialogClose(props: DialogPrimitive.Close.Props): React.ReactElement {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export const DIALOG_BACKDROP_CLASS =
  "fixed inset-0 z-50 bg-pa-dimmer backdrop-grayscale transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0";

export const OVERLAY_CLOSE_INSET_CLASS = "absolute end-2.5 top-2.5";

export function OverlayCloseButton(props: React.ComponentProps<typeof Button>): React.ReactElement {
  return <Button size="icon" variant="subtle" {...props} />;
}

export type DialogVariant = "form" | "stage";

/** `form` 是要提交或确认的动作表单，`stage` 是占满视口中央的舞台（设置面、受控明细）。 */
export const dialogViewportVariants = cva(
  "fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4",
  {
    defaultVariants: { variant: "form" },
    variants: {
      variant: {
        form: "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12",
        stage: "",
      },
    },
  },
);

export const dialogPopupVariants = cva(
  "relative row-start-2 flex max-h-full min-h-0 w-full min-w-0 origin-center flex-col rounded-3xl bg-pa-bg text-pa-fg opacity-[calc(1-0.1*var(--nested-dialogs))] shadow-stage outline-none transition-[scale,opacity,translate] duration-150 ease-out will-change-transform data-ending-style:opacity-0 data-starting-style:opacity-0 sm:scale-[calc(1-0.1*var(--nested-dialogs))] sm:data-ending-style:translate-y-2.5 sm:data-starting-style:translate-y-2.5",
  {
    defaultVariants: { variant: "form" },
    variants: {
      variant: {
        form: "max-w-lg max-sm:max-w-none max-sm:origin-bottom max-sm:rounded-none max-sm:border-t max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4",
        stage:
          "max-h-[min(80vh,calc(90vh-4rem))] min-h-[300px] w-[min(100%-2rem,1024px)] max-w-none overflow-hidden md:h-[min(80vh,calc(90vh-4rem))]",
      },
    },
  },
);

export function DialogPopup({
  className,
  children,
  variant = "form",
  showCloseButton = true,
  closeProps,
  portalProps,
  ...props
}: DialogPrimitive.Popup.Props &
  VariantProps<typeof dialogPopupVariants> & {
    showCloseButton?: boolean;
    closeProps?: DialogPrimitive.Close.Props;
    portalProps?: DialogPrimitive.Portal.Props;
  }): React.ReactElement {
  return (
    <DialogPrimitive.Portal {...portalProps}>
      <DialogPrimitive.Backdrop className={DIALOG_BACKDROP_CLASS} data-slot="dialog-backdrop" />
      <DialogPrimitive.Viewport
        className={dialogViewportVariants({ variant })}
        data-slot="dialog-viewport"
      >
        <DialogPrimitive.Popup
          className={cn(dialogPopupVariants({ variant }), className)}
          data-slot="dialog-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="关闭"
              className={OVERLAY_CLOSE_INSET_CLASS}
              render={<OverlayCloseButton />}
              {...closeProps}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center justify-center gap-2 border-b border-pa-line px-12",
        className,
      )}
      data-slot="dialog-header"
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogFooter({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col-reverse gap-2 px-6 pt-4 pb-6 sm:flex-row sm:justify-end",
      "has-[[data-slot=dialog-close]]:border-pa-line has-[[data-slot=dialog-close]]:border-t has-[[data-slot=dialog-close]]:sm:justify-between",
      className,
    ),
    "data-slot": "dialog-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn("min-w-0 truncate pb-0.5 font-medium text-sm", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn("text-pa-muted text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export function DialogPanel({
  className,
  scrollFade = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "px-6 pt-5 pb-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer])]:pb-5",
      className,
    ),
    "data-slot": "dialog-panel",
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
