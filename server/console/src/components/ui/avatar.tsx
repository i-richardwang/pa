import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "flex shrink-0 items-center justify-center overflow-hidden font-medium",
  {
    defaultVariants: { shape: "round", size: "default", tone: "muted" },
    variants: {
      shape: {
        round: "rounded-full",
        square: "rounded-avatar",
      },
      size: {
        xs: "size-6 text-2xs [&_svg]:size-3.5",
        sm: "size-7 text-2xs [&_svg]:size-4",
        default: "size-8 text-2xs [&_svg]:size-4",
        lg: "size-13 text-sm [&_svg]:size-6",
      },
      tone: {
        muted: "bg-pa-surface text-pa-muted",
        accent: "bg-pa-avatar text-pa-fg",
        ink: "bg-pa-ink text-pa-ink-fg",
      },
    },
  },
);

export function Avatar({
  className,
  shape,
  size,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof avatarVariants>): React.ReactElement {
  return (
    <span
      className={cn(avatarVariants({ shape, size, tone }), className)}
      data-slot="avatar"
      {...props}
    />
  );
}
