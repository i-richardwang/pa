import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentPropsWithoutRef<"textarea"> &
  React.RefAttributes<HTMLTextAreaElement> & {
    unstyled?: boolean;
  };

export function Textarea({
  className,
  unstyled = false,
  ref,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "pa-focus-within relative inline-flex w-full rounded-lg border border-pa-line bg-pa-bg text-pa-fg transition duration-200 not-has-disabled:hover:border-pa-line-hover has-aria-invalid:border-pa-danger has-disabled:bg-pa-surface in-[[data-slot=field]]:rounded-none in-[[data-slot=field]]:border-0 in-[[data-slot=field]]:bg-transparent in-[[data-slot=field]]:focus-within:ring-0",
          className,
        ) || undefined
      }
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
            className="field-sizing-content min-h-17.5 w-full rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)] text-md outline-none placeholder:text-pa-placeholder disabled:text-pa-disabled-fg in-[[data-slot=field]]:px-0 in-[[data-slot=field]]:py-0"
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}
