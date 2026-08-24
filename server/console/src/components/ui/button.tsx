"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { LoadingMark } from "pa-result-view";

/** `icon` 是壳那一圈（整圆），`icon-sm` / `icon-xs` 落在内容里（基准圆角）。 */
export const buttonVariants = cva(
  "pa-focus relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap border font-medium text-sm pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 disabled:pointer-events-none not-data-loading:disabled:text-pa-disabled-fg data-loading:select-none data-loading:text-transparent [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 rounded-full px-[calc(--spacing(3)-1px)]",
        lg: "h-10 rounded-full px-[calc(--spacing(3.5)-1px)]",
        compact: "h-6 gap-1 rounded-full px-[calc(--spacing(2.5)-1px)] text-xs",
        icon: "size-8 rounded-full",
        "icon-sm": "size-7 rounded-md",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "border-pa-line bg-transparent text-pa-fg hover:border-pa-line-hover data-pressed:bg-pa-wash *:data-[slot=loading-mark]:text-pa-fg",
        filled:
          "border-transparent bg-pa-ink text-pa-ink-fg transition-opacity duration-300 ease-out hover:opacity-85 data-pressed:opacity-70 not-data-loading:disabled:bg-pa-surface not-data-loading:disabled:text-pa-fg/25 *:data-[slot=loading-mark]:text-pa-ink-fg",
        subtle:
          "border-transparent text-pa-fg hover:bg-pa-surface data-pressed:bg-pa-surface *:data-[slot=loading-mark]:text-pa-fg",
        danger:
          "[color-scheme:dark] border-transparent bg-pa-danger text-pa-fg transition-opacity duration-300 ease-out hover:opacity-85 data-pressed:opacity-70 not-data-loading:disabled:[color-scheme:normal] not-data-loading:disabled:bg-pa-surface not-data-loading:disabled:text-pa-fg/25 *:data-[slot=loading-mark]:text-pa-fg",
        "danger-subtle":
          "border-transparent text-pa-danger-fg hover:bg-pa-danger/8 data-pressed:bg-pa-danger/8 *:data-[slot=loading-mark]:text-pa-danger-fg",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <LoadingMark
            className={cn(
              "pointer-events-none absolute",
              size === "lg" ? "scale-75" : "scale-[0.6]",
            )}
            decorative
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
