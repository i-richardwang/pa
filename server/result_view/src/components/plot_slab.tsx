/**
 * 结果面的场地：画布、排行、表格共用的一层 DOM，按场景决定画不画那圈圆角发丝框
 * （`PLOT_FRAME`），与结果长成什么形态无关——同一场景下图与表同框。落在 DOM 上也让饼图这类
 * 没有 grid 的形态有场地可铺：框圈的是绘图区，与用不用直角坐标系无关。
 *
 * 两种摆法：
 * - `rect` 在场：绝对定位压在画布底下，位置由 `plotRect` 给——那道算式同时喂给 echarts
 *   的 grid，两处对着同一组数，框才不会圈错地方。调用方要给一个 `relative` 的父盒。
 * - 无 `rect`：流式包住 DOM 内容（表格），横向留白与画布同档（`PLOT_PADDING` 的左右），
 *   画框时内容再内缩一圈（分隔线与末列的数都不该贴到框缘），上下各留与图例行同档的呼吸，
 *   框不压着题名也不压着底下的行数条。`fill` 为真时随父容器撑满并把高度交给内容自己滚。
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
  fill = false,
  children,
}: {
  plot: keyof typeof PLOT_PADDING;
  rect?: PlotInset;
  fill?: boolean;
  children?: ReactNode;
}) {
  const framed = PLOT_FRAME[plot];
  const pad = PLOT_PADDING[plot];
  const frame = framed ? "border border-pa-line" : "";
  const radius = framed ? PLOT_RADIUS : undefined;
  if (rect) {
    return (
      <div
        aria-hidden={children ? undefined : "true"}
        className={`absolute overflow-hidden ${frame}`}
        data-slot="plot-surface"
        style={{
          insetInlineStart: rect.left,
          insetInlineEnd: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          borderRadius: radius,
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={`overflow-hidden ${frame} ${framed ? "my-3 p-4" : ""} ${
        fill ? "flex min-h-0 flex-1 flex-col" : ""
      }`}
      data-slot="plot-surface"
      style={{ borderRadius: radius, marginInlineStart: pad.left, marginInlineEnd: pad.right }}
    >
      {children}
    </div>
  );
}
