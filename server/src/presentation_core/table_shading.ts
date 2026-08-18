/**
 * 表格热力着色：按格里的值给数值格铺一层底色，深浅或冷暖对应值的大小。
 *
 * 色阶两族：**单色**给一个系列色，值越大越浓；**双向**给一条三停色带，值从下限经中点到上限
 * 在三停之间线性插值。两族都可翻转。刻度按指标（列的 formatKey）各立一把——同一张表里人数与
 * 比率不共用深浅；缺省域是该指标在本表全部数值格上的极值，声明可逐项覆盖（契约见
 * `docs/presentation_contract.md`）。总体带是表格 chrome，不参与刻度也不着色。
 *
 * 字色按底色与承载面合成后的对比度选墨色或反白，与外部参照的可读性判据一致（WCAG 相对亮度）。
 * 本模块只算颜色，不改数值，也不产生任何要印出来的数。
 */
import type { ShadingPaletteName, TableShadingDecl } from "../semantic_core/semantic_analysis.js";
import { CHART_SERIES } from "./design_tokens.js";
import { toNumber } from "./view_format.js";

export type { TableShadingDecl } from "../semantic_core/semantic_analysis.js";

export type ShadingScale = { min: number; mid: number; max: number };

/** 编译后随表格模型下发：刻度已定，渲染端只做值→色。 */
export type TableShading = {
  palette: string;
  flipped: boolean;
  values: boolean;
  /** 按列 formatKey 立的刻度；不在表内的键即不着色 */
  scales: Record<string, ShadingScale>;
};

type Stop = { light: string; dark: string };
type DivergingPalette = { label: string; stops: readonly [Stop, Stop, Stop] };

/** 双向色阶三停（下限、中点、上限），明暗各一份；键即声明面的色阶名。 */
export const DIVERGING_PALETTES: Record<ShadingPaletteName, DivergingPalette> = {
  traffic_lights: {
    label: "红黄绿",
    stops: [
      { light: "#e0857a", dark: "#e8998f" },
      { light: "#f5e6a3", dark: "#5c4a12" },
      { light: "#3fa08f", dark: "#4fb8a5" },
    ],
  },
  red_blue: {
    label: "红蓝",
    stops: [
      { light: "#f25494", dark: "#f25494" },
      { light: "#f7e5ff", dark: "#34004d" },
      { light: "#91a1ff", dark: "#91a1ff" },
    ],
  },
  viridis: {
    label: "翠绿",
    stops: [
      { light: "#fff6a5", dark: "#5b1f6a" },
      { light: "#4da198", dark: "#4da198" },
      { light: "#5b1f6a", dark: "#fff6a5" },
    ],
  },
  magma: {
    label: "熔岩",
    stops: [
      { light: "#fcfdbf", dark: "#1b1b79" },
      { light: "#d65b8f", dark: "#d65b8f" },
      { light: "#1b1b79", dark: "#fcfdbf" },
    ],
  },
};

export function divergingPalette(palette: string): DivergingPalette | undefined {
  return Object.hasOwn(DIVERGING_PALETTES, palette)
    ? DIVERGING_PALETTES[palette as ShadingPaletteName]
    : undefined;
}

const MONO_MIN_OPACITY = 0.05;
const MONO_MAX_OPACITY = 1;

type Extent = { min: number; max: number };
type ShadedColumns = { formatKey: string }[];
type ShadedRows = (string | number | null)[][];

/** 每个要着色的列键在全部数值格上的极值；一个键没有任何数值时不出现。 */
function dataExtents(
  columns: ShadedColumns,
  rows: ShadedRows,
  shadedKeys: ReadonlySet<string>,
): Map<string, Extent> {
  const extents = new Map<string, Extent>();
  columns.forEach((column, index) => {
    if (!shadedKeys.has(column.formatKey)) return;
    for (const row of rows) {
      const value = toNumber(row[index]);
      if (value === null) continue;
      const extent = extents.get(column.formatKey);
      if (!extent) extents.set(column.formatKey, { min: value, max: value });
      else {
        if (value < extent.min) extent.min = value;
        if (value > extent.max) extent.max = value;
      }
    }
  });
  return extents;
}

function scaleOf(extent: Extent, thresholds: TableShadingDecl["thresholds"]): ShadingScale {
  const min = thresholds?.min ?? extent.min;
  const max = thresholds?.max ?? extent.max;
  return { min, mid: thresholds?.mid ?? (min + max) / 2, max };
}

/**
 * 编译刻度：对每个要着色的列键，取其全部数值格的极值作缺省两端、两端中点作缺省中点，
 * 声明阈值逐项覆盖。刻度是色的几何，不是对指标的聚合——本层不对值求和求均。
 * 一个键没有任何数值时不立刻度（渲染端遂不着色）。
 */
export function compileTableShading(
  decl: TableShadingDecl,
  columns: ShadedColumns,
  rows: ShadedRows,
  shadedKeys: ReadonlySet<string>,
): TableShading {
  const scales: Record<string, ShadingScale> = {};
  for (const [key, extent] of dataExtents(columns, rows, shadedKeys)) {
    scales[key] = scaleOf(extent, decl.thresholds);
  }
  return {
    palette: decl.palette,
    flipped: decl.flipped ?? false,
    values: decl.values ?? true,
    scales,
  };
}

/**
 * 缺省刻度的读法：不填阈值时色阶实际落在哪里。多个键各有一把刻度，这里给它们的并集
 * （最小的下限、最大的上限、两端中点），供设置面印读数与占位；一格数值都没有时为 null。
 */
export function shadingDataScale(
  columns: ShadedColumns,
  rows: ShadedRows,
  shadedKeys: ReadonlySet<string>,
): ShadingScale | null {
  let union: Extent | null = null;
  for (const extent of dataExtents(columns, rows, shadedKeys).values()) {
    union = union
      ? { min: Math.min(union.min, extent.min), max: Math.max(union.max, extent.max) }
      : { ...extent };
  }
  return union ? scaleOf(union, undefined) : null;
}

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** [a,b] 上的线性位置；域退化（a===b）时恒为 0。 */
function position(value: number, a: number, b: number): number {
  return b === a ? 0 : clamp01((value - a) / (b - a));
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** 承载面（表格所在的 pa-bg）：底色带透明度时先与它合成再判字色。 */
const SURFACE: Record<"light" | "dark", Rgb> = {
  light: hexToRgb("#ffffff"),
  dark: hexToRgb("#171717"),
};

/** 单色在暗色主题下换到该系列色的暗色档；不在系列表里的十六进制值两档同色。 */
function monoBase(palette: string, dark: boolean): Rgb {
  const pair = CHART_SERIES.find(
    (candidate) => candidate.light.toLowerCase() === palette.toLowerCase(),
  );
  return hexToRgb(dark && pair ? pair.dark : palette);
}

/**
 * 一条色阶从下限到上限的取样停点（CSS 颜色），给编辑器画色带样片用：单色两停
 * （最淡→基色）、双向三停；翻转即倒序。与 `shadeCell` 同一份取值，样片不另调色。
 */
export function shadingStops(palette: string, flipped: boolean, dark: boolean): string[] {
  const diverging = divergingPalette(palette);
  let stops: string[];
  if (diverging) {
    stops = diverging.stops.map((stop) => (dark ? stop.dark : stop.light));
  } else {
    const base = monoBase(palette, dark);
    stops = [
      `rgba(${base.r}, ${base.g}, ${base.b}, ${MONO_MIN_OPACITY})`,
      `rgb(${base.r}, ${base.g}, ${base.b})`,
    ];
  }
  return flipped ? stops.reverse() : stops;
}

export type CellShade = {
  /** 直接可写进 style.backgroundColor */
  background: string;
  /** 字色档：墨色（pa-ink）或反白（pa-ink-fg） */
  foreground: "ink" | "inverse";
};

/**
 * 一格的底色与字色。值不是数、或该键没有刻度时不着色（返回 undefined）。
 */
export function shadeCell(
  value: number | string | null,
  formatKey: string,
  shading: TableShading,
  dark: boolean,
): CellShade | undefined {
  const scale = shading.scales[formatKey];
  const numeric = toNumber(value);
  if (!scale || numeric === null) return undefined;
  const surface = SURFACE[dark ? "dark" : "light"];
  const diverging = divergingPalette(shading.palette);
  let composite: Rgb;
  let background: string;
  if (diverging) {
    const stops = diverging.stops.map((stop) => hexToRgb(dark ? stop.dark : stop.light));
    const [low, mid, high] = shading.flipped ? [stops[2], stops[1], stops[0]] : stops;
    composite =
      numeric <= scale.mid
        ? mix(low, mid, position(numeric, scale.min, scale.mid))
        : mix(mid, high, position(numeric, scale.mid, scale.max));
    background = `rgb(${composite.r}, ${composite.g}, ${composite.b})`;
  } else {
    const base = monoBase(shading.palette, dark);
    const t = position(numeric, scale.min, scale.max);
    const opacity = shading.flipped
      ? MONO_MAX_OPACITY - (MONO_MAX_OPACITY - MONO_MIN_OPACITY) * t
      : MONO_MIN_OPACITY + (MONO_MAX_OPACITY - MONO_MIN_OPACITY) * t;
    composite = mix(surface, base, opacity);
    background = `rgba(${base.r}, ${base.g}, ${base.b}, ${opacity.toFixed(3)})`;
  }
  const l = luminance(composite);
  const contrastWithBlack = (l + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (l + 0.05);
  const inkIsDark = !dark;
  // 墨色在亮色主题是深字、暗色主题是浅字：选对比更高的那一档
  const wantsDarkText = contrastWithBlack >= contrastWithWhite;
  return { background, foreground: wantsDarkText === inkIsDark ? "ink" : "inverse" };
}
