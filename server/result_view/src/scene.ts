/**
 * 宿主场景的 chrome 取舍：`ViewScene` 一个枚举，每一项取舍由这一张表答完。结果面里的每个
 * 构件都按 scene 查这张表，不另收布尔参数。新增场景 = 表里加一行。
 *
 * 场地几何（留白、画不画框）同样按 scene 查，表在 chart_config（`PLOT_PADDING` / `PLOT_FRAME`），
 * 因为 echarts 的 grid 与 DOM 的场地框要读同一组数。
 */
import type { ViewScene } from "../../src/presentation_core/chart_config.js";

export type { ViewScene };

export type SceneTraits = {
  /** 空态纵向呼吸 */
  emptyPad: string;
  /** 高度取容器而非内容：图表撑满、表格自带内滚、指标卡纵向居中——需容器给定确定高度 */
  fill: boolean;
  /** 表格全量渲染，不按 INLINE_ROWS 截行 */
  allRows: boolean;
  /** 载荷派生的标题与副行由渲染器渲染（容器自带标题时关） */
  title: boolean;
  /** 中段内联 chrome：行数条、导出提示行（关掉时由宿主的页面底栏承载） */
  inlineChrome: boolean;
  /** 中段常驻口径带（只有答数态挂） */
  scopeBand: boolean;
  /** 表格明细格内衬：密度由留白分，不动字级、线色与底色 */
  cellPad: string;
  /** 表格行数条：瓦片里贴着壳底不画线，其余场景画顶线 */
  countBar: string;
};

export const VIEW_SCENES: Record<ViewScene, SceneTraits> = {
  card: {
    emptyPad: "py-6",
    fill: false,
    allRows: false,
    title: true,
    inlineChrome: true,
    scopeBand: true,
    cellPad: "px-2.5 py-2",
    countBar: "h-7.5 border-pa-line border-t px-2 text-pa-muted",
  },
  tile: {
    emptyPad: "py-4",
    fill: true,
    allRows: true,
    title: false,
    inlineChrome: true,
    scopeBand: false,
    cellPad: "px-2 py-1.5",
    countBar: "h-7 pt-1 text-pa-faint leading-4",
  },
  page: {
    emptyPad: "py-6",
    fill: true,
    allRows: true,
    title: false,
    inlineChrome: false,
    scopeBand: false,
    cellPad: "px-2.5 py-2",
    countBar: "h-7.5 border-pa-line border-t px-2 text-pa-muted",
  },
};
