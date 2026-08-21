import type { ReactNode } from "react";
import { MAIN_CARD_BODY_INSET } from "../layout/layout_chrome";
import { cn } from "@/lib/utils";

export function ChartStage({
  heading,
  footer,
  children,
}: {
  /** 题名区：Explore 式 22/26 + 灰副文，恒在结果之上。 */
  heading?: ReactNode;
  /** 页面底栏：时间栏 + 结果元信息。通栏落在结果区之外。 */
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

/**
 * 题名块：名字一行，其下一行灰字答「这张图看的是哪一段时间」——**副行只出观察窗口**。
 * 粒度与对比不进副行：它们在底栏上是可点的控件，题下复述一遍既改不动又与控件抢读。
 */
export function ChartStageHeading({
  title,
  sub,
  extra,
  className,
}: {
  title: ReactNode;
  /** 观察窗口一句话（见 `windowSummary`）；无时间意图的宿主不传。 */
  sub?: ReactNode;
  /** 可选附加行（如明细弹层坐标带）；查看面主路径不传。 */
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
