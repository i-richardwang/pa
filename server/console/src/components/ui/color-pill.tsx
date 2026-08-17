"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";

const colorPillVariants = cva(
  "grid shrink-0 cursor-pointer place-items-center rounded-full border border-transparent outline-none hover:border-pa-faint focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring aria-pressed:border-pa-faint aria-pressed:hover:border-pa-fg",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        default: "size-8 p-[3px]",
        sm: "size-4.5 p-px",
      },
    },
  },
);

function ColorPill({
  color,
  className,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof colorPillVariants> & {
    color: string;
  }): React.ReactElement {
  return (
    <button
      className={cn(colorPillVariants({ size }), className)}
      data-slot="color-pill"
      type="button"
      {...props}
    >
      <span
        className="size-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

export function ColorSelector({
  value,
  colors,
  onValueChange,
  label,
  size = "default",
}: {
  value: string;
  colors: readonly string[];
  onValueChange: (color: string) => void;
  label: string;
  size?: VariantProps<typeof colorPillVariants>["size"];
}): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger
        render={<ColorPill aria-label={label} color={value} size={size} />}
      />
      <PopoverPopup className="flex max-w-88 flex-wrap gap-1 p-3">
        {colors.map((color) => (
          <ColorPill
            aria-label={color}
            aria-pressed={color === value}
            color={color}
            key={color}
            onClick={() => onValueChange(color)}
            size={size}
          />
        ))}
      </PopoverPopup>
    </Popover>
  );
}
