"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { GLASS_POPUP_SURFACE, POPUP_ROW } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export const Select: typeof SelectPrimitive.Root = SelectPrimitive.Root;

export const selectTriggerVariants = cva(
  "relative inline-flex w-full min-w-0 cursor-pointer select-none items-center justify-start rounded-lg border text-left text-sm text-pa-fg outline-none transition duration-200 ease-in-out pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-transparent focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring aria-invalid:border-pa-danger data-disabled:pointer-events-none data-disabled:text-pa-disabled-fg data-disabled:[&_svg]:text-pa-disabled-fg [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "outline",
    },
    variants: {
      size: {
        sm: "min-h-7 gap-1 px-[calc(--spacing(2)-1px)]",
        default: "min-h-8 gap-1 px-[calc(--spacing(2)-1px)]",
        field: "min-h-10 gap-2 pr-[calc(--spacing(3)-1px)] pl-[calc(--spacing(2.5)-1px)]",
      },
      variant: {
        outline: "border-pa-line bg-pa-bg not-data-disabled:hover:border-pa-line-hover",
        ghost:
          "border-transparent bg-transparent not-data-disabled:hover:bg-pa-surface data-popup-open:bg-pa-surface",
      },
    },
  },
);

export const selectTriggerIconClassName = "size-3 shrink-0 text-pa-faint";

export interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  variant?: VariantProps<typeof selectTriggerVariants>["variant"];
}

export function SelectButton({
  className,
  size,
  variant,
  render,
  children,
  ...props
}: SelectButtonProps): React.ReactElement {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        <span className="mx-0.5 min-w-0 flex-1 truncate in-data-placeholder:text-pa-muted">
          {children}
        </span>
        <ChevronsUpDownIcon className={selectTriggerIconClassName} />
      </>
    ),
    className: cn(selectTriggerVariants({ size, variant }), className),
    "data-slot": "select-button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export function SelectTrigger({
  className,
  size = "default",
  variant,
  label,
  children,
  ...props
}: SelectPrimitive.Trigger.Props &
  VariantProps<typeof selectTriggerVariants> & {
    label?: React.ReactNode;
  }): React.ReactElement {
  return (
    <SelectPrimitive.Trigger
      aria-label={typeof label === "string" ? label : undefined}
      className={cn(
        selectTriggerVariants({ size: label == null ? size : "field", variant }),
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {label == null ? (
        <span className="mx-0.5 flex min-w-0 flex-1 items-center">{children}</span>
      ) : (
        <>

          <span className="flex shrink-0 grow items-center truncate" data-slot="select-trigger-label">
            {label}
          </span>
          <span className="mx-0.5 flex min-w-0 shrink items-center justify-end">{children}</span>
        </>
      )}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronsUpDownIcon className={selectTriggerIconClassName} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/**
 * 下拉的名字由 Base UI 绑定到触发件上；不带它的下拉没有可读名称。
 *
 * 它出 `<span>`：设置行的左槽是行内的（见 `InspectorRow`），Base UI 默认的 div 塞不进去。
 */
export function SelectLabel({
  className,
  ...props
}: SelectPrimitive.Label.Props): React.ReactElement {
  return (
    <SelectPrimitive.Label
      className={cn("min-w-0 cursor-default truncate", className)}
      data-slot="select-label"
      render={<span />}
      {...props}
    />
  );
}

export function SelectValue({
  className,
  ...props
}: SelectPrimitive.Value.Props): React.ReactElement {
  return (
    <SelectPrimitive.Value
      className={cn("min-w-0 truncate data-placeholder:text-pa-muted", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

/**
 * 下拉面：落在触发件下方 4px，**不盖住触发件**——把选中项对到触发件上的那套（Base UI 的
 * `alignItemWithTrigger`）会让同一个「选一个值」在下拉与浮层列表上长出两种开合方式。
 * 面料与行排印出自 `surface.ts`，高度到 19rem 自滚，滚动不另加渐隐箭头。
 */
export function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  anchor,
  portalProps,
  ...props
}: SelectPrimitive.Popup.Props & {
  portalProps?: SelectPrimitive.Portal.Props;
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}): React.ReactElement {
  return (
    <SelectPrimitive.Portal {...portalProps}>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            "flex min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden text-pa-fg outline-none transition-[transform,opacity,scale] duration-150 ease-out data-ending-style:scale-[0.99] data-ending-style:opacity-0 data-starting-style:scale-[0.99] data-starting-style:opacity-0",
            GLASS_POPUP_SURFACE,
          )}
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.List
            className={cn(
              "flex max-h-[min(19rem,var(--available-height))] min-h-0 flex-col overflow-y-auto p-1.5 outline-none",
              className,
            )}
            data-slot="select-list"
          >
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props): React.ReactElement {
  return (
    <SelectPrimitive.Item
      className={cn(
        POPUP_ROW,
        "flex w-full min-w-0 cursor-pointer items-center border-0 bg-transparent text-left text-pa-fg outline-none data-disabled:pointer-events-none data-disabled:opacity-30 data-highlighted:bg-pa-surface data-selected:font-medium",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <SelectPrimitive.ItemText className="min-h-[1.25em] min-w-0 flex-1 truncate">
          {children}
        </SelectPrimitive.ItemText>
        <span className="inline-flex w-4 shrink-0 items-center justify-center self-center">
          <SelectPrimitive.ItemIndicator>
            <CheckIcon className="size-3" />
          </SelectPrimitive.ItemIndicator>
        </span>
      </span>
    </SelectPrimitive.Item>
  );
}

export { SelectPrimitive, SelectPopup as SelectContent };
