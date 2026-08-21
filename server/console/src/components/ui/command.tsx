"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { Dialog as CommandDialogPrimitive } from "@base-ui/react/dialog";
import { SearchIcon } from "lucide-react";
import type * as React from "react";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/ui/autocomplete";
import { DIALOG_BACKDROP_CLASS } from "@/components/ui/dialog";
import { GLASS_STAGE_SURFACE } from "@/components/ui/surface";

export const CommandDialog: typeof CommandDialogPrimitive.Root = CommandDialogPrimitive.Root;

export type CommandFinalFocus = CommandDialogPrimitive.Popup.Props["finalFocus"];

export function useOpenerFocus(): {
  capture: () => void;
  finalFocus: NonNullable<CommandFinalFocus>;
} {
  const opener = useRef<HTMLElement | null>(null);
  return {
    capture: useCallback(() => {
      opener.current = document.activeElement as HTMLElement | null;
    }, []),
    finalFocus: useCallback(() => {
      const target = opener.current;
      return target?.isConnected ? target : true;
    }, []),
  };
}

export function CommandDialogPopup({
  className,
  children,
  portalProps,
  ...props
}: CommandDialogPrimitive.Popup.Props & {
  portalProps?: CommandDialogPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <CommandDialogPrimitive.Portal {...portalProps}>
      <CommandDialogPrimitive.Backdrop
        className={DIALOG_BACKDROP_CLASS}
        data-slot="command-dialog-backdrop"
      />
      <CommandDialogPrimitive.Viewport
        className="fixed inset-0 z-50 flex flex-col items-center px-4 pt-[12%] pb-4"
        data-slot="command-dialog-viewport"
      >
        <CommandDialogPrimitive.Popup
          className={cn(
            "relative flex max-h-[76%] min-h-0 w-full min-w-0 max-w-[600px] flex-col rounded-2xl opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity] duration-200 ease-in-out will-change-transform data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1",
            GLASS_STAGE_SURFACE,
            className,
          )}
          data-slot="command-dialog-popup"
          {...props}
        >
          {children}
        </CommandDialogPrimitive.Popup>
      </CommandDialogPrimitive.Viewport>
    </CommandDialogPrimitive.Portal>
  );
}

export function Command({
  autoHighlight = "always",
  keepHighlight = true,
  ...props
}: React.ComponentProps<typeof Autocomplete>): React.ReactElement {
  return (
    <Autocomplete
      autoHighlight={autoHighlight}
      inline
      keepHighlight={keepHighlight}
      open
      {...props}
    />
  );
}

export function CommandInput({
  className,
  placeholder = "跳转至",
  ...props
}: AutocompletePrimitive.Input.Props): React.ReactElement {
  return (
    <div className="group flex h-16 shrink-0 items-center gap-2.5 px-5">
      <SearchIcon aria-hidden="true" className="size-6 shrink-0 text-pa-faint" strokeWidth={1.6} />
      <AutocompletePrimitive.Input
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "min-w-0 grow border-0 bg-transparent pb-0.5 text-xl leading-tight text-pa-fg outline-none placeholder:text-pa-placeholder",
          className,
        )}
        placeholder={placeholder}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteList>): React.ReactElement {
  return (
    <AutocompleteList
      className={cn("not-empty:p-0", className)}
      data-slot="command-list"
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteEmpty>): React.ReactElement {
  return (
    <AutocompleteEmpty
      className={cn("not-empty:px-3.5 not-empty:py-6 text-sm text-pa-faint", className)}
      data-slot="command-empty"
      {...props}
    />
  );
}

export function CommandPanel({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative min-h-0 flex-1 overflow-y-auto border-t-[0.5px] border-pa-line p-2 **:data-[slot=scroll-area-scrollbar]:mt-2",
        className,
      )}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteGroup>): React.ReactElement {
  return <AutocompleteGroup className={className} data-slot="command-group" {...props} />;
}

export const CommandCollection = AutocompleteCollection;

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteItem>): React.ReactElement {
  return (
    <AutocompleteItem
      className={cn(
        "h-12 gap-2 rounded-md py-0 pr-4 pl-3.5 text-base sm:text-base data-highlighted:bg-pa-surface data-highlighted:text-pa-fg",
        className,
      )}
      data-slot="command-item"
      {...props}
    />
  );
}

export function CommandFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 border-t-[0.5px] border-pa-line pt-3 pr-3.5 pb-3.5 pl-4 text-sm text-pa-faint",
        className,
      )}
      data-slot="command-footer"
      {...props}
    />
  );
}

export function CommandKbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-pa-surface px-1 pb-0.5 text-center text-2xs leading-none text-pa-muted",
        className,
      )}
      data-slot="command-kbd"
      {...props}
    />
  );
}
