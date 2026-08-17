"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import type React from "react";
import { HINT_TEXT } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

const FIELD_BOX =
  "has-data-[slot=field-label]:min-h-14 has-data-[slot=field-label]:justify-center has-data-[slot=field-label]:rounded-lg has-data-[slot=field-label]:border has-data-[slot=field-label]:border-pa-line has-data-[slot=field-label]:px-3 has-data-[slot=field-label]:transition has-data-[slot=field-label]:duration-200 has-data-[slot=field-label]:not-has-disabled:hover:border-pa-line-hover has-data-[slot=field-label]:focus-within:border-pa-focus-strong has-data-[slot=field-label]:focus-within:ring-[3px] has-data-[slot=field-label]:focus-within:ring-pa-focus-ring has-data-[slot=field-label]:has-aria-invalid:border-pa-danger";

export function Field({
  className,
  ...props
}: FieldPrimitive.Root.Props): React.ReactElement {
  return (
    <FieldPrimitive.Root
      className={cn("flex w-full flex-col items-stretch gap-1", FIELD_BOX, className)}
      data-slot="field"
      {...props}
    />
  );
}

export function FieldLabel({
  className,
  ...props
}: FieldPrimitive.Label.Props): React.ReactElement {
  return (
    <FieldPrimitive.Label
      className={cn(

        "inline-flex cursor-text items-center gap-2 text-sm text-pa-faint transition-colors duration-200 in-[[data-slot=field]:focus-within]:text-pa-highlight data-disabled:opacity-64",
        className,
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  ...props
}: FieldPrimitive.Description.Props): React.ReactElement {
  return (
    <FieldPrimitive.Description
      className={cn(HINT_TEXT, className)}
      data-slot="field-description"
      {...props}
    />
  );
}

export function FieldError({
  className,
  ...props
}: FieldPrimitive.Error.Props): React.ReactElement {
  return (
    <FieldPrimitive.Error
      className={cn("text-pa-danger-fg text-xs", className)}
      data-slot="field-error"
      {...props}
    />
  );
}

export { FieldPrimitive };
