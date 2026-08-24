/**
 * 看板栅格与瓦片尺寸的参数契约；这些常量由同一尺寸模型消费，漂移即门禁失败。
 */
import { expect, test } from "bun:test";
import {
  CELL_ASPECT,
  GRID_MARGIN,
  MIN_ROW_HEIGHT,
  MOBILE_BREAKPOINT,
  MOBILE_GRID_MARGIN,
  mobileTileHeight,
  TILE_SIZES,
} from "./tile_sizing";

test("栅格常量：格子几何与瓦片间距同出一处，横纵同值", () => {
  // 间距判据见 tile_sizing.ts 头注
  expect(GRID_MARGIN).toEqual([16, 16]);
  expect(MOBILE_GRID_MARGIN).toEqual([16, 16]);
  // 格子几何本身不动——它决定坐标语义，改了会让已存看板的 place 换位
  expect(MOBILE_BREAKPOINT).toBe(752);
  expect(MIN_ROW_HEIGHT).toBe(40);
  expect(CELL_ASPECT).toBeCloseTo(10 / 9);
});

test("各形态有固定默认格数和最小可缩尺寸", () => {
  expect(TILE_SIZES.table).toEqual({ w: 12, h: 9, minW: 4, minH: 3 });
  expect(TILE_SIZES.crosstab).toEqual({ w: 12, h: 9, minW: 4, minH: 3 });
  expect(TILE_SIZES.line).toEqual({ w: 12, h: 6, minW: 4, minH: 3 });
  expect(TILE_SIZES.bar).toEqual({ w: 12, h: 6, minW: 4, minH: 3 });
  expect(TILE_SIZES.pie).toEqual({ w: 12, h: 8, minW: 4, minH: 3 });
  expect(TILE_SIZES.kpi).toEqual({ w: 6, h: 3, minW: 2, minH: 2 });
  expect(TILE_SIZES.text).toEqual({ w: 12, h: 3, minW: 1, minH: 1 });
});

test("移动端单列高度按形态固定", () => {
  expect(mobileTileHeight("kpi", 3)).toBe(4);
  expect(mobileTileHeight("text", 1)).toBe(2);
  expect(mobileTileHeight("text", 5)).toBe(5);
  expect(mobileTileHeight("table", 9)).toBe(6);
  expect(mobileTileHeight("line", 6)).toBe(6);
});
