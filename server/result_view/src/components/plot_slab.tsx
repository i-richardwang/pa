/**
 * 图和表共用的绘图区域层。传 `rect` 时与 echarts grid 使用同一个矩形（`plotRect`），
 * 此时父元素须为 `relative`。
 */
import type { ReactNode } from "react";
import {
  PLOT_FRAME,
  PLOT_PADDING,
  PLOT_RADIUS,
  type ViewScene,
} from "../../../src/presentation_core/chart_config.js";
import { VIEW_SCENES } from "../scene.js";

export type PlotInset = { left: number; right: number; top: number; bottom: number };

export function PlotSlab({
  scene,
  rect,
  children,
}: {
  scene: ViewScene;
  rect?: PlotInset;
  children?: ReactNode;
}) {
  const framed = PLOT_FRAME[scene];
  const pad = PLOT_PADDING[scene];
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
        VIEW_SCENES[scene].fill ? "flex min-h-0 flex-1 flex-col" : ""
      }`}
      data-slot="plot-surface"
      style={{ borderRadius: radius, marginInlineStart: pad.left, marginInlineEnd: pad.right }}
    >
      {children}
    </div>
  );
}
