import type { ReactNode } from "react";
import { MAIN_CARD_BODY_INSET } from "../layout/layout_chrome";
import { cn } from "@/lib/utils";

export function ChartStage({
  heading,
  footer,
  children,
}: {
  heading?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="chart-stage" data-testid="chart-stage">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-slot="chart-stage-main">
        <div
          className={cn("flex min-h-0 flex-1 flex-col", MAIN_CARD_BODY_INSET)}
          data-slot="chart-stage-body"
        >
          {heading}
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            data-slot="chart-stage-result"
          >
            {children}
          </div>
        </div>

        {footer ? (
          <div className="shrink-0" data-slot="chart-stage-footer">
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function ChartStageHeading({
  title,
  sub,
  extra,
  className,
}: {
  title: ReactNode;
  /** 观察窗口一句话（见 `windowSummary`）；无时间意图的宿主不传。 */
  sub?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-4 flex shrink-0 flex-col gap-4", className)}
      data-slot="chart-stage-heading"
    >
      <div className="min-w-0">
        <h1 className="mb-0.5 truncate text-xl font-semibold text-pa-fg md:mb-1">{title}</h1>
        {sub ? <p className="mb-1 truncate font-normal text-md text-pa-faint">{sub}</p> : null}
      </div>
      {extra}
    </div>
  );
}
