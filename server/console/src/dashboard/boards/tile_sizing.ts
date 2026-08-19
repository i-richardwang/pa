import type { BoardTile } from "@contracts/board_contract";
import type { RenderShape } from "@shape";
import type { ReportRow } from "@contracts/report_contract";

export const GRID_MARGIN: [number, number] = [16, 16];
export const MOBILE_GRID_MARGIN: [number, number] = [16, 16];

export const MOBILE_BREAKPOINT = 752;

export const MIN_ROW_HEIGHT = 40;

/** 格子宽高比：行高由列宽和此比例推导，使格子近似方形。 */
export const CELL_ASPECT = 10 / 9;

export type TileShape = RenderShape | "text";

export type TileSize = { w: number; h: number; minW: number; minH: number };

/** 静态格数表：默认值管落位版面，最小值只挡「小到必然不可读」的极端。 */
export const TILE_SIZES: Record<TileShape, TileSize> = {
  kpi: { w: 6, h: 3, minW: 2, minH: 2 },
  line: { w: 12, h: 6, minW: 4, minH: 3 },
  bar: { w: 12, h: 6, minW: 4, minH: 3 },
  pie: { w: 12, h: 8, minW: 4, minH: 3 },
  crosstab: { w: 12, h: 9, minW: 4, minH: 3 },
  table: { w: 12, h: 9, minW: 4, minH: 3 },
  text: { w: 12, h: 3, minW: 1, minH: 1 },
};

export function mobileTileHeight(shape: TileShape, desktopH: number): number {
  if (shape === "kpi") return 4;
  if (shape === "text") return Math.max(2, desktopH);
  return 6;
}

export function coarseTileShape(chartType: ReportRow["presentation_type"]): RenderShape {
  switch (chartType) {
    case "line":
      return "line";
    case "bar":
      return "bar";
    case "pie":
      return "pie";
    case "kpi":
      return "kpi";
    default:
      return "table";
  }
}

export function tileShape(tile: BoardTile): TileShape {
  if (tile.kind === "text") return "text";
  return tile.render_shape ?? coarseTileShape(tile.presentation_type);
}

export function reportTileSize(report: ReportRow): TileSize {
  return TILE_SIZES[report.render_shape ?? coarseTileShape(report.presentation_type)];
}
