"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";

export function ToggleGroup({
  className,
  columns,
  bordered = false,
  children,
  ...props
}: ToggleGroupPrimitive.Props & { columns: number; bordered?: boolean }): ReactElement {
  const track = useRef<HTMLDivElement>(null);
  const [slider, setSlider] = useState<{ width: number; offset: number }>();

  const [sliding, setSliding] = useState(false);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => {
      const pressed = element.querySelector<HTMLElement>(
        '[data-slot="toggle-group-item"][data-pressed]',
      );
      if (!pressed) return setSlider(undefined);
      const box = pressed.getBoundingClientRect();
      const base = element.getBoundingClientRect();
      setSlider({ offset: box.x - base.x, width: box.width });
    };
    measure();

    const attributes = new MutationObserver(measure);
    attributes.observe(element, { attributeFilter: ["data-pressed"], subtree: true });
    const size = new ResizeObserver(measure);
    size.observe(element);
    return () => {
      attributes.disconnect();
      size.disconnect();
    };
  }, []);

  useEffect(() => {
    if (slider) setSliding(true);
  }, [slider]);

  return (
    <ToggleGroupPrimitive
      className={cn(
        "group/toggle relative grid rounded-md",
        bordered && "border border-pa-line px-0.5",
        className,
      )}
      data-bordered={bordered ? "" : undefined}
      data-slot="toggle-group"
      ref={track}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      {...props}
    >
      {slider ? (
        <span
          aria-hidden="true"
          className={cn(

            "pointer-events-none absolute left-0 bg-pa-selected",

            bordered ? "top-0.5 bottom-0.5 rounded-sm" : "top-0 bottom-0 rounded-md",
            sliding && "transition-transform duration-250 ease-in-out",
          )}
          data-slot="toggle-group-slider"
          style={{ transform: `translateX(${slider.offset}px)`, width: slider.width }}
        />
      ) : null}
      {children}
    </ToggleGroupPrimitive>
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: TogglePrimitive.Props): ReactElement {
  return (
    <TogglePrimitive
      className={cn(
        "relative flex h-8 cursor-pointer items-center justify-center rounded-md group-data-bordered/toggle:rounded-sm text-sm text-pa-muted outline-none transition-colors duration-300 hover:text-pa-fg-soft focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring data-disabled:cursor-not-allowed data-disabled:text-pa-disabled-fg data-disabled:hover:text-pa-disabled-fg data-pressed:font-medium data-pressed:text-pa-fg",
        className,
      )}
      data-slot="toggle-group-item"
      {...props}
    />
  );
}
