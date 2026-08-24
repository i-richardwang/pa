"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type React from "react";
import { cn } from "@/lib/utils";
import {
  DIALOG_BACKDROP_CLASS,
  dialogPopupVariants,
  dialogViewportVariants,
} from "@/components/ui/dialog";

export const AlertDialog: typeof AlertDialogPrimitive.Root = AlertDialogPrimitive.Root;

export function AlertDialogPopup({
  className,
  portalProps,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  portalProps?: AlertDialogPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <AlertDialogPrimitive.Portal {...portalProps}>
      <AlertDialogPrimitive.Backdrop
        className={DIALOG_BACKDROP_CLASS}
        data-slot="alert-dialog-backdrop"
      />
      <AlertDialogPrimitive.Viewport
        className={dialogViewportVariants({ variant: "form" })}
        data-slot="alert-dialog-viewport"
      >
        <AlertDialogPrimitive.Popup
          className={cn(dialogPopupVariants({ variant: "form" }), "max-w-md", className)}
          data-slot="alert-dialog-popup"
          {...props}
        />
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col gap-2 p-6 text-left", className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

export function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 px-6 py-4 sm:flex-row sm:justify-end", className)}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props): React.ReactElement {
  return (
    <AlertDialogPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props): React.ReactElement {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-pa-muted text-sm", className)}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

export function AlertDialogClose(props: AlertDialogPrimitive.Close.Props): React.ReactElement {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}
