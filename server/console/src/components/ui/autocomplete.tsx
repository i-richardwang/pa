"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type React from "react";
import { SearchIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GLASS_POPUP_SURFACE,
  POPUP_GROUP_LABEL,
  POPUP_ROW,
} from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/**
 * 字段选择面（combobox）：搜索、过滤、方向键走位与无障碍语义全归 Base UI 原语。
 * 值选择列表是**另一份契约**，归 `popover-list.tsx`——两者长得几乎一样，
 * 但键盘模型不同，按长相合并会逼出一个只认领 `listbox` 角色、不实现走位的假件。
 *
 * 默认值说的是 PA 的话（玻璃壳、13px/420 行、禁用不降透明度），不是出厂值：
 * 统一封装输入、候选列表与键盘交互，避免消费者重复实现同一组行为。
 */
export const Autocomplete: typeof AutocompletePrimitive.Root =
  AutocompletePrimitive.Root;

export function AutocompletePopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  alignOffset,
  align = "start",
  anchor,
  portalProps,
  ...props
}: AutocompletePrimitive.Popup.Props & {
  align?: AutocompletePrimitive.Positioner.Props["align"];
  sideOffset?: AutocompletePrimitive.Positioner.Props["sideOffset"];
  alignOffset?: AutocompletePrimitive.Positioner.Props["alignOffset"];
  side?: AutocompletePrimitive.Positioner.Props["side"];
  anchor?: AutocompletePrimitive.Positioner.Props["anchor"];
  portalProps?: AutocompletePrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <AutocompletePrimitive.Portal {...portalProps}>
      <AutocompletePrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="autocomplete-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <span
          className={cn(
            "relative flex max-h-full min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden transition-[scale,opacity]",
            GLASS_POPUP_SURFACE,
            className,
          )}
        >
          <AutocompletePrimitive.Popup
            className="flex max-h-[min(var(--available-height),23rem)] flex-1 flex-col"
            data-slot="autocomplete-popup"
            {...props}
          >
            {children}
          </AutocompletePrimitive.Popup>
        </span>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  );
}

export function AutocompleteSearch({
  className,
  ...props
}: AutocompletePrimitive.Input.Props): React.ReactElement {
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-3 border-pa-line border-b px-4"
      data-slot="autocomplete-search"
    >
      <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-pa-faint" />
      <AutocompletePrimitive.Input
        autoComplete="off"
        className={cn(
          "block w-full min-w-0 border-0 bg-transparent pb-0.5 text-pa-fg text-sm leading-tight outline-none placeholder:text-pa-placeholder",
          className,
        )}
        spellCheck={false}
        {...props}
      />
    </div>
  );
}

export function AutocompleteItem({
  className,
  children,
  ...props
}: AutocompletePrimitive.Item.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Item
      className={cn(
        POPUP_ROW,

        "flex cursor-pointer select-none items-center text-pa-fg outline-none data-disabled:pointer-events-none data-disabled:text-pa-muted data-highlighted:bg-pa-surface",
        className,
      )}
      data-slot="autocomplete-item"
      {...props}
    >
      {children}
    </AutocompletePrimitive.Item>
  );
}

export function AutocompleteGroup({
  className,
  ...props
}: AutocompletePrimitive.Group.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Group
      className={cn("[[role=group]+&]:mt-1.5", className)}
      data-slot="autocomplete-group"
      {...props}
    />
  );
}

export function AutocompleteGroupLabel({
  className,
  ...props
}: AutocompletePrimitive.GroupLabel.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.GroupLabel
      className={cn(POPUP_GROUP_LABEL, className)}
      data-slot="autocomplete-group-label"
      {...props}
    />
  );
}

export function AutocompleteEmpty({
  className,
  ...props
}: AutocompletePrimitive.Empty.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Empty
      className={cn(
        "not-empty:px-3 not-empty:py-2 text-left text-sm text-pa-muted",
        className,
      )}
      data-slot="autocomplete-empty"
      {...props}
    />
  );
}

export function AutocompleteList({
  className,
  ...props
}: AutocompletePrimitive.List.Props): React.ReactElement {
  return (
    <ScrollArea scrollbarGutter scrollFade>
      <AutocompletePrimitive.List
        className={cn(
          "not-empty:scroll-py-1.5 not-empty:p-1.5 in-data-has-overflow-y:pe-3",
          className,
        )}
        data-slot="autocomplete-list"
        {...props}
      />
    </ScrollArea>
  );
}

export const AutocompleteCollection: typeof AutocompletePrimitive.Collection =
  AutocompletePrimitive.Collection;

export const useAutocompleteFilter: typeof AutocompletePrimitive.useFilter =
  AutocompletePrimitive.useFilter;

export function AutocompleteTrigger({
  className,
  children,
  ...props
}: AutocompletePrimitive.Trigger.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Trigger
      className={className}
      data-slot="autocomplete-trigger"
      {...props}
    >
      {children}
    </AutocompletePrimitive.Trigger>
  );
}

export { AutocompletePrimitive };
