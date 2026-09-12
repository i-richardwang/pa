import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { STATUS_ICONS } from "@/components/ui/status";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[calc(var(--spacing)*4)_1fr] items-start gap-x-2 gap-y-0.5 rounded-lg border px-3.5 py-3 text-pa-fg text-sm [&>svg]:h-lh [&>svg]:w-4",
  {
    variants: {
      variant: {
        error: "border-pa-danger/32 bg-pa-danger/4 [&>svg]:text-pa-danger-fg",
        warning: "border-pa-warning/32 bg-pa-warning/4 [&>svg]:text-pa-warning-fg",
      },
    },
  },
);

export function Alert({
  children,
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & {
  variant: NonNullable<VariantProps<typeof alertVariants>["variant"]>;
}): React.ReactElement {
  const Icon = STATUS_ICONS[variant];
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    >
      <Icon />
      {children}
    </div>
  );
}

export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div className={cn("col-start-2 font-medium", className)} data-slot="alert-title" {...props} />
  );
}

export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("col-start-2 flex flex-col gap-2.5 text-pa-muted", className)}
      data-slot="alert-description"
      {...props}
    />
  );
}
