import { CHART_SERIES, TABLE_SHADING_TOKENS } from "./design_tokens.js";
import type { ShadingPaletteName, TableShadingPreferences } from "./view_preferences.js";
import { toNumber } from "./view_format.js";

export type ShadingScale = { min: number; mid: number; max: number };

export type TableShading = {
  palette: string;
  flipped: boolean;
  values: boolean;
  scales: Record<string, ShadingScale>;
};

type Stop = { light: string; dark: string };
type DivergingPalette = { label: string; stops: readonly [Stop, Stop, Stop] };

export const DIVERGING_PALETTES: Record<ShadingPaletteName, DivergingPalette> = {
  ...TABLE_SHADING_TOKENS.palettes,
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

function scaleOf(extent: Extent, thresholds: TableShadingPreferences["thresholds"]): ShadingScale {
  // 自动端点包住数据与已声明的其他停点，色阶恒有序。
  const min =
    thresholds?.min ??
    Math.min(extent.min, thresholds?.mid ?? extent.min, thresholds?.max ?? extent.min);
  const max =
    thresholds?.max ??
    Math.max(extent.max, thresholds?.mid ?? extent.max, thresholds?.min ?? extent.max);
  return { min, mid: thresholds?.mid ?? (min + max) / 2, max };
}

export function compileTableShading(
  decl: TableShadingPreferences,
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

const SURFACE: Record<"light" | "dark", Rgb> = {
  light: hexToRgb(TABLE_SHADING_TOKENS.surface.light),
  dark: hexToRgb(TABLE_SHADING_TOKENS.surface.dark),
};

/** 单色在暗色主题下换到该系列色的暗色档；不在系列表里的十六进制值两档同色。 */
function monoBase(palette: string, dark: boolean): Rgb {
  const pair = CHART_SERIES.find(
    (candidate) => candidate.light.toLowerCase() === palette.toLowerCase(),
  );
  return hexToRgb(dark && pair ? pair.dark : palette);
}

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
  background: string;
  foreground: "ink" | "inverse";
};

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
