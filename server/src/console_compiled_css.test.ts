import { compile } from "@tailwindcss/node";
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CONSOLE_SRC = new URL("../console/src/", import.meta.url);
const RESULT_VIEW_SRC = new URL("../result_view/src/", import.meta.url);
const WIDGET_SRC = new URL("../widget/src/", import.meta.url);
const ENTRY = new URL("../console/src/styles.css", import.meta.url);

const HOSTS = [
  { label: "console", entry: ENTRY, srcs: [CONSOLE_SRC, RESULT_VIEW_SRC] },
  {
    label: "widget",
    entry: new URL("../widget/src/styles.css", import.meta.url),
    srcs: [WIDGET_SRC, RESULT_VIEW_SRC],
  },
];

const OWNED =
  /^-?(?:rounded|text|font|leading|tracking|bg|border|ring|outline|fill|stroke|divide|from|to|via|caret|placeholder|decoration)-|-pa-/;

function utility(candidate: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) cut = i;
  }
  return candidate.slice(cut + 1).replace(/^!/, "");
}

const NOT_IN_A_CLASS_NAME = /[;"'<{}$`]/;

/**
 * 候选提取：取字符串字面量里以空白分隔的片段，与 Tailwind 自己看见的那一份对齐——
 * 拼接出来的类名（`rounded-${x}`）两边都看不见，那是 Tailwind 本身的约束，不是这里的漏。
 */
function candidates(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? "";
    for (const token of literal.split(/\s+/)) {
      // 样式值不是类名：`--pa-stage-aside` 是自定义属性名，`var(--pa-ink)` 是它的取值，
      // 拼 HTML 那几处还会切出 `font-weight:450;line-height:21px` 这样的碎片。
      // 这一路由 console_style_boundary 那侧看守（它管的是「有没有绕开令牌写死色值」）
      if (token.startsWith("--") || token.startsWith("var(")) continue;
      if (NOT_IN_A_CLASS_NAME.test(token)) continue;
      if (token.length > 1 && /^[\w[!:*&>~.@[\]/-]/.test(token)) out.add(token);
    }
  }
  return [...out];
}

function isProductSource(name: string): boolean {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx")) return false;
  return !name.endsWith(".test.ts") && !name.endsWith(".test.tsx");
}

const ALIVE_PROBE = ["rounded-md", "rounded-avatar", "text-md", "md:rounded-lg", "bg-pa-wash"];
const DEAD_PROBE = [
  "rounded-xs",
  "rounded-4xl",
  "text-2xl",
  "bg-pa-wsh",
  "text-pa-fant",
  "bg-card",
  "text-muted-foreground",
];

test("a class name that was written actually compiles to a rule", async () => {
  for (const { label, entry, srcs } of HOSTS) {
    /** 候选去重后记住谁先写的，判死时才报得出出处 */
    const origin = new Map<string, string>();
    for (const src of srcs) {
      const names = (await readdir(src, { recursive: true })).filter(isProductSource);
      expect(
        names.length,
        `${label} source scan found no files — path likely stale`,
      ).toBeGreaterThan(0);
      for (const name of names) {
        const text = await readFile(new URL(name, src), "utf8");
        for (const candidate of candidates(text)) {
          if (OWNED.test(utility(candidate)) && !origin.has(candidate)) origin.set(candidate, name);
        }
      }
    }
    expect(
      origin.size,
      `${label}: candidate extraction found nothing to judge — the extractor is broken`,
    ).toBeGreaterThan(20);

    const { build } = await compile(await readFile(entry, "utf8"), {
      base: fileURLToPath(new URL(".", entry)),
      onDependency: () => {},
    });
    // build() 累积候选；输入必须去重，输出长度变化才表示当前候选产生了规则。
    let emitted = build([]).length;
    const emits = (candidate: string): boolean => {
      const next = build([candidate]).length;
      const grew = next > emitted;
      emitted = next;
      return grew;
    };

    for (const alive of ALIVE_PROBE) {
      expect(emits(alive), `${label} probe is broken: ${alive} should compile`).toBe(true);
    }
    for (const dead of DEAD_PROBE) {
      expect(emits(dead), `${label} probe is broken: ${dead} should compile to nothing`).toBe(
        false,
      );
    }

    for (const [candidate, name] of origin) {
      if (ALIVE_PROBE.includes(candidate)) continue;
      expect(
        emits(candidate),
        `${label}: ${name} writes \`${candidate}\`, which compiles to nothing under the ${label} ` +
          `entry — the utility is unknown or misspelled`,
      ).toBe(true);
    }
  }
});

const FOREIGN_COLOR_REF = /var\(--color-(?!pa-)[a-z0-9-]+\)/g;
const COLOR_PROBE = {
  foreign: ["bg-red-500", "text-white"],
  owned: ["bg-pa-surface", "text-pa-muted"],
};

test("every colour a class compiles to comes from the pa-* table", async () => {
  for (const { label, entry, srcs } of HOSTS) {
    const origin = new Map<string, string>();
    for (const src of srcs) {
      const names = (await readdir(src, { recursive: true })).filter(isProductSource);
      for (const name of names) {
        const text = await readFile(new URL(name, src), "utf8");
        for (const candidate of candidates(text)) {
          if (!origin.has(candidate)) origin.set(candidate, name);
        }
      }
    }
    expect(origin.size, `${label}: candidate extraction found nothing to judge`).toBeGreaterThan(
      20,
    );

    const { build } = await compile(await readFile(entry, "utf8"), {
      base: fileURLToPath(new URL(".", entry)),
      onDependency: () => {},
    });
    // build() 累积输出：新增候选若引入了 pa-* 以外的颜色变量，引用集合就会长大。
    const seen = new Set<string>(build([]).match(FOREIGN_COLOR_REF) ?? []);
    const introduces = (candidate: string): string[] => {
      const fresh = (build([candidate]).match(FOREIGN_COLOR_REF) ?? []).filter(
        (ref) => !seen.has(ref),
      );
      for (const ref of fresh) seen.add(ref);
      return fresh;
    };

    for (const owned of COLOR_PROBE.owned) {
      expect(introduces(owned), `${label} probe is broken: ${owned} is a pa-* colour`).toEqual([]);
    }
    for (const foreign of COLOR_PROBE.foreign) {
      expect(
        introduces(foreign).length,
        `${label} probe is broken: ${foreign} should reach a palette colour`,
      ).toBeGreaterThan(0);
    }

    for (const [candidate, name] of origin) {
      expect(
        introduces(candidate),
        `${label}: ${name} writes \`${candidate}\`, which paints with a colour outside the pa-* table`,
      ).toEqual([]);
    }
  }
});

test("the extractor claims owned utilities with variant prefixes", async () => {
  const text = await readFile(new URL("components/ui/input.tsx", CONSOLE_SRC), "utf8");
  const claimed = new Set(candidates(text).filter((c) => OWNED.test(utility(c))));
  for (const shape of [
    "text-md",
    "placeholder:text-pa-placeholder",
    "in-[[data-slot=field]]:rounded-none",
  ]) {
    expect(claimed.has(shape), `extractor no longer claims \`${shape}\``).toBe(true);
  }
  for (const value of ["--pa-stage-aside", "var(--pa-ink)"]) {
    expect(candidates(`"${value}"`), `extractor claims the style value \`${value}\``).toEqual([]);
  }
});

const LADDER: Array<[string, string]> = [
  ["rounded-sm", "border-radius:4px"],
  ["rounded-md", "border-radius:6px"],
  ["rounded-lg", "border-radius:8px"],
  ["rounded-xl", "border-radius:12px"],
  ["rounded-2xl", "border-radius:16px"],
  ["rounded-3xl", "border-radius:24px"],
  ["rounded-avatar", "border-radius:18%"],
  ["text-sm", "font-size:13px"],
  ["text-md", "font-size:14px"],
  ["text-xl", "font-size:22px"],
  ["font-normal", "font-weight:420"],
  ["font-medium", "font-weight:450"],
  ["font-semibold", "font-weight:520"],
];

test("named steps compile to their declared values", async () => {
  for (const { label, entry } of HOSTS) {
    const { build } = await compile(await readFile(entry, "utf8"), {
      base: fileURLToPath(new URL(".", entry)),
      onDependency: () => {},
    });
    const out = build(LADDER.map(([candidate]) => candidate)).replaceAll(/\s+/g, "");

    for (const [candidate, declaration] of LADDER) {
      expect(out, `${label}: \`${candidate}\` no longer compiles to \`${declaration}\``).toContain(
        declaration,
      );
    }

    expect(
      out,
      `${label}: the ladder probe matches anything — the assertion is vacuous`,
    ).not.toContain("border-radius:7777px");
  }
});
