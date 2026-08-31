import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "pa-focus inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-1.5 font-medium text-xs [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-pa-surface text-pa-muted [button&,a&]:hover:bg-pa-selected",
        error: "bg-pa-danger/8 text-pa-danger-fg",
        success: "bg-pa-success/8 text-pa-success-fg",
        warning: "bg-pa-warning/8 text-pa-warning-fg",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
}

export function Badge({ className, variant, render, ...props }: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
