"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type React from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  className,
  ...props
}: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-0", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

export function TabsList({
  className,
  children,
  variant = "underline",
  ...props
}: TabsPrimitive.List.Props & { variant?: "underline" | "segments" }): React.ReactElement {
  if (variant === "segments") {
    return (
      <TabsPrimitive.List
        className={cn("flex items-center gap-0.5", className)}
        data-slot="tabs-list"
        data-variant="segments"
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    );
  }
  return (
    <TabsPrimitive.List
      className={cn("relative z-0 mb-5 flex w-full items-center gap-1 border-b", className)}
      data-slot="tabs-list"
      data-variant="underline"
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        className="absolute bottom-0 left-0 z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-px bg-pa-ink transition-[width,translate] duration-200 ease-in-out"
        data-slot="tab-indicator"
      />
    </TabsPrimitive.List>
  );
}

export function TabsTab({
  className,
  ...props
}: TabsPrimitive.Tab.Props): React.ReactElement {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap px-3 font-medium text-sm text-pa-muted outline-none transition-colors duration-150 hover:text-pa-fg focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring data-disabled:pointer-events-none data-active:text-pa-fg data-disabled:text-pa-disabled-fg [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",

        "in-[[data-slot=tabs-list][data-variant=segments]]:h-8 in-[[data-slot=tabs-list][data-variant=segments]]:rounded-lg in-[[data-slot=tabs-list][data-variant=segments]]:data-active:bg-pa-selected in-[[data-slot=tabs-list][data-variant=segments]]:data-active:text-pa-fg",
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { TabsPrimitive, TabsTab as TabsTrigger, TabsPanel as TabsContent };
