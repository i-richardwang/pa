"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentPropsWithoutRef<"textarea"> &
  React.RefAttributes<HTMLTextAreaElement> & {
    size?: "sm" | "default" | number;
    unstyled?: boolean;
  };

export function Textarea({
  className,
  size = "default",
  unstyled = false,
  ref,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-lg border border-pa-line bg-pa-bg text-pa-fg transition duration-200 not-has-disabled:hover:border-pa-line-hover focus-within:border-pa-focus-strong focus-within:ring-[3px] focus-within:ring-pa-focus-ring has-aria-invalid:border-pa-danger has-disabled:bg-pa-surface in-[[data-slot=field]]:rounded-none in-[[data-slot=field]]:border-0 in-[[data-slot=field]]:bg-transparent in-[[data-slot=field]]:focus-within:ring-0",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        ref={ref}
        value={props.value}
        defaultValue={props.defaultValue}
        disabled={props.disabled}
        id={props.id}
        name={props.name}
        render={(defaultProps: React.ComponentProps<"textarea">) => (
          <textarea
            className={cn(
              "field-sizing-content min-h-17.5 w-full rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)] text-md outline-none placeholder:text-pa-placeholder disabled:text-pa-disabled-fg in-[[data-slot=field]]:px-0 in-[[data-slot=field]]:py-0",
              size === "sm" &&
                "min-h-16.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1.5)-1px)]",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { FieldPrimitive };
