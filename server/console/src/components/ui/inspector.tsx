"use client";

import { useState } from "react";
import type * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlockedHint, Hint } from "@/components/ui/hint";
import { SECTION_TITLE_TEXT } from "@/components/ui/surface";

/** 两档密度由 InspectorBody 定在栏上，段与行各自认领（两面的判据见 ui_spec「侧栏系统」）。 */
export const INSPECTOR_SECTION_CLASS =
  "border-b-[0.5px] border-pa-line px-3 py-2.5 last:border-b-0 md:px-2.5 md:py-2 " +
  "group-data-[density=reading]/inspector:border-b-0 group-data-[density=reading]/inspector:p-4 " +
  "group-data-[density=reading]/inspector:pb-0";

const INSPECTOR_SECTION_HEADER_CLASS =
  "group/panel-section-header flex h-11 items-center justify-between gap-2.5 pl-2.5 md:h-8 md:pl-2";
/** 档案面里行与段题左缘对齐：段题统辖的就是这些行。 */
const INSPECTOR_SECTION_CONTENT_CLASS =
  "px-2.5 pt-1 md:px-2 group-data-[density=reading]/inspector:px-0";
/** 档案面的段间分界：内缩两格、只隔不框——框会把每一段读成一个控件组。 */
const INSPECTOR_SECTION_RULE_CLASS =
  "mx-2 hidden border-pa-line border-b-[0.5px] pt-4 " +
  "group-data-[density=reading]/inspector:group-[&:not(:last-child)]/section:block";

/** 行里图标槽的宽：图标 4 格加与名字之间的 2.5 格。无图标的行缩这一段，名字与带图标的行同起点。 */
export const INSPECTOR_ROW_INDENT_CLASS = "ml-6.5";

export function InspectorSection({
  title,
  icon,
  blocked,
  description,
  actions,
  collapsible = false,
  defaultExpanded = true,
  children,
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
          <h3 className={cn("truncate", SECTION_TITLE_TEXT, blocked && "text-pa-faint")}>
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
        {description ? <Hint className="truncate">{description}</Hint> : null}
      </div>
    </>
  );
  return (
    <section className={cn("group/section", INSPECTOR_SECTION_CLASS)} data-slot="inspector-section">
      <header
        className={cn(INSPECTOR_SECTION_HEADER_CLASS, collapsible && "group/disclosure")}
        data-slot="inspector-section-header"
      >
        {collapsible ? (
          <button
            aria-expanded={expanded}
            className="pa-focus flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md text-left"
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
          className={cn(INSPECTOR_SECTION_CONTENT_CLASS, contentClassName, !open && "hidden")}
          data-slot="inspector-section-content"
        >
          {children}
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={INSPECTOR_SECTION_RULE_CLASS}
        data-slot="inspector-section-rule"
      />
    </section>
  );
}

/**
 * 每条右栏都从这里开正文：密度是「这栏是拿来读的还是拿来调的」，属于栏，不属于每一段。
 */
export function InspectorBody({
  density = "settings",
  children,
  className,
}: {
  density?: "settings" | "reading";
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "group/inspector flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-8",
        className,
      )}
      data-density={density}
      data-slot="inspector-body"
    >
      {children}
    </div>
  );
}

/** 档案头卡：图标、名字、口径，以及关于这条记录本身的几项事实。 */
export function InspectorProfileCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** 口径句。留空时给破折号：「这条还没写口径」也是读者要知道的。 */
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** 事实行（InspectorRow），没有就不出这一块。 */
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mx-4 rounded-xl bg-pa-canvas" data-slot="inspector-profile-card">
      <div className="p-5 pb-3">
        {icon || action ? (
          <div className="flex h-8 items-center justify-between gap-2">
            <span aria-hidden="true" className="flex items-center text-pa-muted [&_svg]:size-5">
              {icon}
            </span>
            {action}
          </div>
        ) : null}
        <h2 className="break-words font-semibold text-lg text-pa-ink">{title}</h2>
        {description !== undefined ? (
          <p className="pt-1 text-pa-muted text-sm leading-5">{description || "—"}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-col pr-5 pb-3 pl-3" data-slot="inspector-profile-facts">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 栏里唯一的一种行：清单行、设置行、事实行都是它，变的只是右槽里放什么。
 * `children` 即右槽——给字符串按「值」排版，给节点照放。行高触屏 44、桌面 32。
 */
export function InspectorRow({
  icon,
  label,
  indent,
  blocked,
  actions,
  onClick,
  children,
}: {
  /** 名字前的记号；记号槽也可以放一枚勾选框，勾的就是这一行。 */
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** 无记号的行让出记号槽的宽，名字与带记号的行同起点。 */
  indent?: boolean;
  blocked?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const box = cn(
    "flex min-h-11 min-w-0 grow items-center justify-between gap-3 rounded-md px-2 text-left text-sm md:min-h-8",
    indent && INSPECTOR_ROW_INDENT_CLASS,
    onClick && "pa-focus cursor-pointer hover:bg-pa-surface",
  );
  const name = (
    <span className="flex min-w-0 grow items-center gap-2.5">
      {icon ? (
        <span
          className="flex shrink-0 items-center text-pa-faint [&_svg]:size-4"
          data-slot="inspector-row-icon"
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate leading-5",
          // 配置面的名字是控件的名字，次于控件；档案面的名字就是内容本身。
          blocked ? "text-pa-faint" : "group-data-[density=settings]/inspector:text-pa-muted",
        )}
        title={typeof label === "string" ? label : undefined}
      >
        {label}
      </span>
      {blocked ? <BlockedHint reason={blocked} /> : null}
    </span>
  );
  // 值可以截短，控件不能：只有字符串那一档让出空间。
  const value = children ? (
    <span
      className={cn(
        "flex max-w-3/5 min-w-0 items-center justify-end gap-1 py-1",
        typeof children !== "string" && "shrink-0",
      )}
    >
      {typeof children === "string" ? (
        <span className="min-w-0 truncate text-pa-muted text-xs">{children}</span>
      ) : (
        children
      )}
    </span>
  ) : null;
  const inner = onClick ? (
    <button className={box} data-slot="inspector-row-box" onClick={onClick} type="button">
      {name}
      {value}
    </button>
  ) : (
    <div className={box} data-slot="inspector-row-box">
      {name}
      {value}
    </div>
  );
  return (
    <div
      className="flex min-w-0 items-center gap-0.5 group-data-[density=reading]/inspector:py-0.5"
      data-slot="inspector-row"
    >
      {inner}
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}
