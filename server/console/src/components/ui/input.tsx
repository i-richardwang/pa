"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "sm" | "default" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  style,
  ...props
}: InputProps): React.ReactElement {
  const inputClassName = cn(
    "h-10 w-full min-w-0 rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] text-md outline-none in-[[data-slot=field]]:h-5 in-[[data-slot=field]]:px-0 [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-pa-placeholder disabled:text-pa-disabled-fg",
    size === "sm" && "h-7 px-[calc(--spacing(2.5)-1px)] text-sm",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-pa-muted file:me-3 file:bg-transparent file:font-medium file:text-pa-fg file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&

            "relative inline-flex w-full rounded-lg border border-pa-line bg-pa-bg text-pa-fg transition duration-200 not-has-disabled:hover:border-pa-line-hover focus-within:border-pa-focus-strong focus-within:ring-[3px] focus-within:ring-pa-focus-ring has-aria-invalid:border-pa-danger has-disabled:bg-pa-surface in-[[data-slot=field]]:rounded-none in-[[data-slot=field]]:border-0 in-[[data-slot=field]]:bg-transparent in-[[data-slot=field]]:focus-within:ring-0 in-[[data-slot=field]]:has-disabled:bg-transparent",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
}

export { InputPrimitive };
