import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const CONSOLE_SRC = new URL("../console/src/", import.meta.url);

const FORBIDDEN = [
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb()/rgba() literal", pattern: /\brgba?\(/g },
  {
    name: "white/black utility",
    pattern: /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:white|black)\b(?:\/\d+)?/g,
  },
];

/** 内联 style 只认设计令牌：它绕开了编译产物那道门，所以在源码上看。 */
const INLINE_STYLE = /style=\{\{[^}]*\}\}/g;
const FOREIGN_INLINE_VAR = /var\(\s*--(?!pa-)[\w-]+/g;
function foreignInlineVars(source: string): string[] {
  return [...source.matchAll(INLINE_STYLE)].flatMap((block) =>
    [...block[0].matchAll(FOREIGN_INLINE_VAR)].map((match) => match[0]),
  );
}

function isProductSource(name: string): boolean {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx")) return false;
  return !name.endsWith(".test.ts") && !name.endsWith(".test.tsx");
}

const TITLEBAR_HEIGHT_SOURCE = "components/ui/titlebar.tsx";
const TITLEBAR_LITERAL = /\b51px\b/g;

test("titlebar height has exactly one spelling", async () => {
  expect([...'className="h-[51px]"'.matchAll(TITLEBAR_LITERAL)].length).toBeGreaterThan(0);
  expect([...'className="h-(--pa-titlebar)"'.matchAll(TITLEBAR_LITERAL)]).toEqual([]);

  const names = (await readdir(CONSOLE_SRC, { recursive: true })).filter(isProductSource);
  const source = await readFile(new URL(TITLEBAR_HEIGHT_SOURCE, CONSOLE_SRC), "utf8");
  expect(source, "titlebar geometry source is stale").toContain("TITLEBAR_HEIGHT");

  for (const name of names) {
    if (name === TITLEBAR_HEIGHT_SOURCE) continue;
    const text = await readFile(new URL(name, CONSOLE_SRC), "utf8");
    expect(
      [...text.matchAll(TITLEBAR_LITERAL)].map((match) => match[0]),
      `console/src/${name} re-spells the titlebar height instead of consuming --pa-titlebar`,
    ).toEqual([]);
  }
});

test("console components style themselves only through design tokens", async () => {
  const bad =
    'className="text-[#767676] border-[rgba(0,0,0,0.09)] hover:bg-black/[0.04] text-white/70 bg-white"';
  const good = 'className="text-pa-muted border-pa-line hover:bg-pa-surface [color-scheme:dark]"';
  expect(foreignInlineVars('style={{ fill: "var(--card)", stroke: "var( --primary )" }}')).toEqual([
    "var(--card",
    "var( --primary",
  ]);
  expect(
    foreignInlineVars(
      'style={{ color: "var(--pa-ink)" }} className="max-h-[var(--available-height)]"',
    ),
  ).toEqual([]);
  for (const { name, pattern } of FORBIDDEN) {
    expect([...bad.matchAll(pattern)].length, `${name} matcher is stale`).toBeGreaterThan(0);
    expect(
      [...good.matchAll(pattern)].map((match) => match[0]),
      `${name} over-matches`,
    ).toEqual([]);
  }

  const names = (await readdir(CONSOLE_SRC, { recursive: true })).filter(isProductSource);
  expect(names.length, "console source scan found no files — path likely stale").toBeGreaterThan(0);

  for (const name of names) {
    const source = await readFile(new URL(name, CONSOLE_SRC), "utf8");
    expect(
      foreignInlineVars(source),
      `console/src/${name} inline style reaches outside the pa-* tokens`,
    ).toEqual([]);
    for (const { name: kind, pattern } of FORBIDDEN) {
      const found = [...source.matchAll(pattern)].map((match) => match[0]);
      expect(found, `console/src/${name} carries ${kind} literals: ${found.join(", ")}`).toEqual(
        [],
      );
    }
  }
});

const SLIDER_FACE_FILE = "../console/src/components/ui/toggle-group.tsx";

const sliderFace = (source: string): string[] =>
  [...source.matchAll(/pointer-events-none absolute[^"]*/g)].flatMap((match) =>
    [...match[0].matchAll(/\bbg-[a-z0-9-]+/g)].map((bg) => bg[0]),
  );

test("分段控件的选中面出自面料令牌，不是手写色", async () => {
  expect(sliderFace('"pointer-events-none absolute left-0 bg-pa-surface"')).toEqual([
    "bg-pa-surface",
  ]);
  expect(sliderFace('className="pointer-events-none absolute inset-0"')).toEqual([]);

  const source = await readFile(new URL(SLIDER_FACE_FILE, import.meta.url), "utf8");
  expect(sliderFace(source), "分段控件的罩层没找到，本用例失去着力点").toEqual(["bg-pa-selected"]);
});

const RENDER_STACKS = [
  { src: new URL("../result_view/src/", import.meta.url), label: "result_view/src" },
  { src: new URL("../widget/src/", import.meta.url), label: "widget/src" },
] as const;

const RENDER_FORBIDDEN = [
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb()/rgba() literal", pattern: /\brgba?\(\s*[\d.]/g },
];

test("the render stacks take every colour from the token table", async () => {
  const bad = 'const c = dark ? "rgba(255, 255, 255, 0.69)" : "#aaaaaa";';
  const D = "$";
  const good = `return \`rgba(${D}{r}, ${D}{g}, ${D}{b})\`;`;
  for (const { name, pattern } of RENDER_FORBIDDEN) {
    expect([...bad.matchAll(pattern)].length, `${name} matcher is stale`).toBeGreaterThan(0);
    expect(
      [...good.matchAll(pattern)].map((match) => match[0]),
      `${name} over-matches`,
    ).toEqual([]);
  }

  for (const { src, label } of RENDER_STACKS) {
    const names = (await readdir(src, { recursive: true })).filter(isProductSource);
    expect(names.length, `${label} scan found no files — path likely stale`).toBeGreaterThan(0);
    for (const name of names) {
      const source = await readFile(new URL(name, src), "utf8");
      for (const { name: kind, pattern } of RENDER_FORBIDDEN) {
        const found = [...source.matchAll(pattern)].map((match) => match[0]);
        expect(found, `${label}/${name} carries ${kind} literals: ${found.join(", ")}`).toEqual([]);
      }
    }
  }
});
