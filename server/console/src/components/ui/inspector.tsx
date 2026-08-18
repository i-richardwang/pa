"use client";

import { useState } from "react";
import type * as React from "react";
import { ChevronRightIcon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

export const INSPECTOR_SECTION_CLASS =
  "border-b-[0.5px] border-pa-line px-3 py-2.5 last:border-b-0 md:px-2.5 md:py-2";

const INSPECTOR_SECTION_HEADER_CLASS =
  "group/panel-section-header flex h-11 items-center justify-between gap-2.5 pl-2.5 md:h-8 md:pl-2";
const INSPECTOR_SECTION_CONTENT_CLASS = "px-2.5 pt-1 md:px-2";

const SECTION_CLASS = INSPECTOR_SECTION_CLASS;
const SECTION_HEADER_CLASS = INSPECTOR_SECTION_HEADER_CLASS;
const SECTION_CONTENT_CLASS = INSPECTOR_SECTION_CONTENT_CLASS;

export function BlockedHint({ reason }: { reason: React.ReactNode }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            className="flex shrink-0 cursor-help items-center text-pa-faint outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring"
            data-slot="inspector-blocked"
            type="button"
          />
        }
      >
        <InfoIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}

export function InspectorSection({
  title,
  icon,
  blocked,
  description,
  actions,
  collapsible = false,
  defaultExpanded = true,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;

  icon?: React.ReactNode;

  blocked?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 可折叠节：题行整行可点，题后跟一枚折角；收起时内容只隐藏不卸载 */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const open = !collapsible || expanded;
  const heading = (
    <>
      {icon ? (
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center text-pa-faint [&_svg]:size-4"
            data-slot="inspector-section-icon"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h3
              className={cn(
                "truncate font-medium text-sm leading-5",
                blocked ? "text-pa-faint" : "text-pa-ink",
              )}
            >
              {title}
            </h3>
            {blocked ? <BlockedHint reason={blocked} /> : null}
            {collapsible ? (
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 text-pa-faint transition-transform duration-150 group-hover/disclosure:text-pa-ink",
                  expanded && "rotate-90",
                )}
              />
            ) : null}
          </div>
          {description ? (
            <Hint className="truncate">{description}</Hint>
          ) : null}
        </div>
    </>
  );
  return (
    <section className={cn(SECTION_CLASS, className)} data-slot="inspector-section">
      <header
        className={cn(SECTION_HEADER_CLASS, collapsible && "group/disclosure")}
        data-slot="inspector-section-header"
      >
        {collapsible ? (
          <button
            aria-expanded={expanded}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {heading}
          </button>
        ) : (
          heading
        )}
        {actions ? (
          <div className="flex shrink-0 items-center gap-1" data-slot="inspector-section-actions">
            {actions}
          </div>
        ) : null}
      </header>
      {children ? (
        <div
          className={cn(SECTION_CONTENT_CLASS, contentClassName, !open && "hidden")}
          data-slot="inspector-section-content"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function InspectorFieldGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "divide-y divide-pa-line overflow-hidden rounded-lg border border-pa-line-subtle bg-pa-bg px-3",
        "focus-within:border-pa-focus-strong focus-within:ring-[3px] focus-within:ring-pa-focus-ring",
        className,
      )}
      data-slot="inspector-field-group"
    >
      {children}
    </div>
  );
}

export function InspectorFieldRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn("flex items-start justify-between gap-2 py-1", className)}
      data-slot="inspector-field-row"
    >
      <span className="mt-[5px] w-[27%] shrink-0 truncate text-sm leading-5 text-pa-muted">
        {label}
      </span>
      <div className="flex min-h-7 min-w-0 max-w-[72%] flex-1 items-center">{children}</div>
    </div>
  );
}

export function InspectorRow({
  children,
  className,
  interactive = false,
  onClick,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
} & Omit<React.ComponentProps<"button">, "children">): React.ReactElement {
  const shell = cn(
    "flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm",
    (interactive || onClick) && "hover:bg-pa-surface",
    onClick && "w-full cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring",
    className,
  );
  if (!onClick) {
    return (
      <div className={shell} data-slot="inspector-row">
        {children}
      </div>
    );
  }
  return (
    <button className={shell} data-slot="inspector-row" onClick={onClick} type="button" {...props}>
      {children}
    </button>
  );
}

export const INSPECTOR_MEMBER_INSET_CLASS = "ml-[26px]";

export function InspectorMemberRow({
  label,
  actions,
  className,
}: {
  label: string;
  actions?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      data-slot="inspector-member-row"
    >
      <div
        className={cn(
          INSPECTOR_MEMBER_INSET_CLASS,
          "flex min-h-8 min-w-0 grow items-center px-2",
        )}
      >
        <span className="min-w-0 truncate text-sm leading-5 text-pa-muted" title={label}>
          {label}
        </span>
      </div>
      {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
    </div>
  );
}

export function InspectorSettingTitle({
  blocked,
  children,
}: {
  blocked?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex min-w-0 items-center gap-1 px-2 py-1.5"
      data-slot="inspector-setting-title"
    >
      <span
        className={cn(

          "min-w-0 truncate font-semibold text-md leading-5",
          blocked ? "text-pa-faint" : "text-pa-ink",
        )}
      >
        {children}
      </span>
      {blocked ? <BlockedHint reason={blocked} /> : null}
    </div>
  );
}

export function InspectorOptionRow({
  label,
  blocked,
  children,
  className,
}: {
  label: React.ReactNode;
  blocked?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-8 min-w-0 items-center gap-0.5", className)}
      data-slot="inspector-option-row"
    >
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 truncate text-sm leading-4",
          blocked ? "text-pa-faint" : "text-pa-muted",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {blocked ? <BlockedHint reason={blocked} /> : null}
      </span>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
