/**
 * 各宿主场景的显示取舍统一在这张表里查，组件不另加布尔参数。绘图区留白和边框见 chart_config 的
 * `PLOT_PADDING` / `PLOT_FRAME`，与 echarts grid 共用。
 */
import type { ViewScene } from "../../src/presentation_core/chart_config.js";

export type { ViewScene };

type SceneTraits = {
  /** 空状态的上下内边距 */
  emptyPad: string;
  /** 高度取容器高度：图表撑满、表格内部滚动、指标卡垂直居中；需要容器有确定高度 */
  fill: boolean;
  /** 表格全量渲染，不按 INLINE_ROWS 截行 */
  allRows: boolean;
  /** 由渲染器显示结果自带的标题和副标题；容器自己有标题时关闭 */
  title: boolean;
  /** 在结果下方显示行数栏和导出提示；关闭时由宿主页面底栏显示 */
  inlineChrome: boolean;
  /** 显示常驻的口径说明栏（只在结果卡中显示） */
  scopeBand: boolean;
  /** 表格单元格内边距；各场景的密度只通过内边距区分，字号、线色和底色相同 */
  cellPad: string;
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
