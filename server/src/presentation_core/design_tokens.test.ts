import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CHART_CHROME, CHART_SERIES, FONT_FAMILY, UI_TOKENS } from "./design_tokens.js";
import { CHART_DARK_COLORS, SERIES_COLORS } from "./chart_config.js";

const TOKENS_CSS = new URL("./tokens.css", import.meta.url);

/** tokens.css :root 里的 --pa-* 定义解析为明暗成对（单值 = 明暗同值） */
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
  // 图表 chrome 也在同一张表里：它的字面值进序列化 option，与 CSS 侧不得各写一份
  expect(cssTokens.get("faint")).toEqual({ ...CHART_CHROME.axisText });

  for (const [name, pair] of Object.entries(UI_TOKENS)) {
    expect(cssTokens.get(name), `tokens.css lacks --pa-${name}`).toEqual({ ...pair });
  }
  // CSS 侧不得有 TS 镜像之外的**字面**颜色令牌。
  // 下列例外都不是颜色：投影、玻璃壳模糊槽位、由 ink 现算（color-mix）的 selected。
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
  // 首色 = 数据蓝，与 --pa-accent 亮值同源
  expect(SERIES_COLORS[0]).toBe("#3b6fdb");
});

test("dark color map covers exactly the pairs that differ", () => {
  expect(CHART_DARK_COLORS["#3b6fdb"]).toBe("#5b8def");
  expect(CHART_DARK_COLORS[CHART_CHROME.gridLine.light]).toBe(CHART_CHROME.gridLine.dark);
  for (const [light, dark] of Object.entries(CHART_DARK_COLORS)) {
    expect(dark, `${light} 的暗色替换是恒等`).not.toBe(light);
  }
  expect(CHART_DARK_COLORS["#123456"]).toBeUndefined();
  // 键恒为小写（渲染端 lookup 前做 toLowerCase）
  for (const key of Object.keys(CHART_DARK_COLORS)) {
    expect(key).toBe(key.toLowerCase());
  }
});

test("the variable cut of inter leads the shared font stack", () => {
  // 可变档必须排在静态 Inter 之前：落到静态档上，420 / 450 / 520 会被吸回 400 / 500，
  // 写出来的那几档字重就永远看不见。
  expect(FONT_FAMILY.startsWith("'Inter Variable', Inter,")).toBe(true);
});

test("series colors stay readable on the label chip in both themes", () => {
  // 值标签把系列色印在浅灰底片上，可读的最低对比档取 1.45。色板是封闭集合，
  // 整套过检就不需要运行时调暗环节——这条护栏看住这个前提。
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
  // 自检：已知坏输入必中（浅底上印白字），好输入必过
  expect(contrast("#ffffff", CHART_CHROME.labelChip.light)).toBeLessThan(1.45);
  expect(contrast("#000000", CHART_CHROME.labelChip.light)).toBeGreaterThan(1.45);
  for (const pair of CHART_SERIES) {
    expect(
      contrast(pair.light, CHART_CHROME.labelChip.light),
      `${pair.light} 在浅色底片上不够醒目`,
    ).toBeGreaterThanOrEqual(1.45);
    expect(
      contrast(pair.dark, CHART_CHROME.labelChip.dark),
      `${pair.dark} 在暗色底片上不够醒目`,
    ).toBeGreaterThanOrEqual(1.45);
  }
});
