import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CHART_CHROME, CHART_SERIES, FONT_FAMILY, UI_TOKENS } from "./design_tokens.js";
import { CHART_DARK_COLORS, SERIES_COLORS } from "./chart_config.js";

const TOKENS_CSS = new URL("./tokens.css", import.meta.url);

/** 把 tokens.css 里的 --pa-* 定义解析成明暗两值，单值令牌明暗相同 */
async function parseCssTokens(): Promise<Map<string, { light: string; dark: string }>> {
  const css = await readFile(TOKENS_CSS, "utf8");
  const tokens = new Map<string, { light: string; dark: string }>();
  for (const match of css.matchAll(/--pa-([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, raw] = match;
    const value = raw.replaceAll(/\s+/g, " ").trim();
    const pair = value.match(/^light-dark\((.+),\s*((?:[^()]|\([^)]*\))+)\)$/);
    if (pair) {
      tokens.set(name, { light: pair[1].trim(), dark: pair[2].trim() });
    } else {
      tokens.set(name, { light: value, dark: value });
    }
  }
  return tokens;
}

test("tokens.css and design_tokens.ts define the same values", async () => {
  const cssTokens = await parseCssTokens();
  expect(cssTokens.get("bg")).toEqual({ light: "#ffffff", dark: "#171717" });
  expect(cssTokens.get("accent")).toEqual({ light: "#3b6fdb", dark: "#5b8def" });
  // 图表辅助色写进序列化 option，也必须与 CSS 令牌同值
  expect(cssTokens.get("faint")).toEqual({ ...CHART_CHROME.axisText });

  for (const [name, pair] of Object.entries(UI_TOKENS)) {
    expect(cssTokens.get(name), `tokens.css lacks --pa-${name}`).toEqual({ ...pair });
  }
  // CSS 里除 UI_TOKENS 外不能有字面颜色令牌；下列几项不是字面颜色：
  // 浮层光晕、玻璃浮层的模糊值、由 ink 用 color-mix 计算的 selected。
  const extra = [...cssTokens.keys()].filter((name) => !(name in UI_TOKENS));
  expect(extra).toEqual([
    "selected",
    "glass-blur-card",
    "glass-blur-popup",
    "popover-glow",
    "glass-blur",
  ]);
});

test("the series palette feeds serialized options in order", () => {
  expect(CHART_SERIES).toHaveLength(8);
  expect(SERIES_COLORS).toEqual(CHART_SERIES.map((pair) => pair.light));
  // 首色与 --pa-accent 的亮色值相同
  expect(SERIES_COLORS[0]).toBe("#3b6fdb");
});

test("dark color map covers exactly the pairs that differ", () => {
  expect(CHART_DARK_COLORS["#3b6fdb"]).toBe("#5b8def");
  expect(CHART_DARK_COLORS[CHART_CHROME.gridLine.light]).toBe(CHART_CHROME.gridLine.dark);
  for (const [light, dark] of Object.entries(CHART_DARK_COLORS)) {
    expect(dark, `${light} 的暗色值与浅色值相同`).not.toBe(light);
  }
  expect(CHART_DARK_COLORS["#123456"]).toBeUndefined();
  // 键必须是小写：渲染端查表前会 toLowerCase
  for (const key of Object.keys(CHART_DARK_COLORS)) {
    expect(key).toBe(key.toLowerCase());
  }
});

test("the variable cut of inter leads the shared font stack", () => {
  // 可变字体必须排在静态 Inter 之前：用到静态字体时，420 / 450 / 520 字重会显示成 400 / 500。
  expect(FONT_FAMILY.startsWith("'Inter Variable', Inter,")).toBe(true);
});

test("series colors stay readable on the label chip in both themes", () => {
  // 数值标签把系列色画在浅灰底上，对比度下限取 1.45；色板全部达标，渲染端因此不做运行时调暗。
  const luminance = (hex: string): number => {
    const channel = (raw: string) => {
      const v = Number.parseInt(raw, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(hex.slice(1, 3)) +
      0.7152 * channel(hex.slice(3, 5)) +
      0.0722 * channel(hex.slice(5, 7))
    );
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // 反向自检：浅底白字必须低于下限，黑字必须高于下限
  expect(contrast("#ffffff", CHART_CHROME.labelChip.light)).toBeLessThan(1.45);
  expect(contrast("#000000", CHART_CHROME.labelChip.light)).toBeGreaterThan(1.45);
  for (const pair of CHART_SERIES) {
    expect(
      contrast(pair.light, CHART_CHROME.labelChip.light),
      `${pair.light} 在浅色背景上对比度不足`,
    ).toBeGreaterThanOrEqual(1.45);
    expect(
      contrast(pair.dark, CHART_CHROME.labelChip.dark),
      `${pair.dark} 在深色背景上对比度不足`,
    ).toBeGreaterThanOrEqual(1.45);
  }
});
