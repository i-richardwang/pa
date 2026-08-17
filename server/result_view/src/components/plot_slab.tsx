/**
 * 绘图区那块场地：铺在画布底下的一层 DOM，按场景决定画不画那圈圆角发丝框。
 *
 * 它是 DOM 而不是 echarts 的 grid，理由见 `PLOT_FRAME` 的头注：canvas 画不出圆角，
 * 而圆角是这块场地的形本身。落到 DOM 还顺带让饼图这类没有 grid 的形态也有场地可铺
 * ——框圈的是绘图区，与用不用直角坐标系无关。
 *
 * 恒为绝对定位，故调用方要给一个 `relative` 的父盒。位置由 `plotRect` 给：那道算式同时
 * 喂给 echarts 的 grid，两处对着同一组数，框才不会圈错地方。
 */
import type { ReactNode } from "react";
import {
  PLOT_FRAME,
  PLOT_PADDING,
  PLOT_RADIUS,
} from "../../../src/presentation_core/chart_config.js";

export type PlotInset = { left: number; right: number; top: number; bottom: number };

export function PlotSlab({
  plot,
  rect,
  children,
}: {
  plot: keyof typeof PLOT_PADDING;
  rect: PlotInset;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden={children ? undefined : "true"}
      className={`absolute overflow-hidden ${
        PLOT_FRAME[plot] ? "border border-pa-line" : ""
      }`}
      data-slot="chart-plot-surface"
      style={{
        insetInlineStart: rect.left,
        insetInlineEnd: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        borderRadius: PLOT_FRAME[plot] ? PLOT_RADIUS : undefined,
      }}
    >
      {children}
    </div>
  );
}
