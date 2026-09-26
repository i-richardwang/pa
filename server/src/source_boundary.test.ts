import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const BROWSER_SAFE_ROOTS = [
  ["contracts", new URL("./contracts/", import.meta.url)],
  ["semantic_core", new URL("./semantic_core/", import.meta.url)],
  ["presentation_core", new URL("./presentation_core/", import.meta.url)],
  ["result_view", new URL("../result_view/src/", import.meta.url)],
] as const;

/** 设计令牌定义在 presentation_core/tokens.css，两个宿主样式表都必须导入它。 */
const RENDER_STACK = new URL("../result_view/src/", import.meta.url);
const HOST_STYLESHEETS = ["../widget/src/styles.css", "../console/src/styles.css"];
const TOKENS_CSS = new URL("./presentation_core/tokens.css", import.meta.url);

test("browser-safe source packages remain free of Node, database, and service configuration imports", async () => {
  for (const [label, root] of BROWSER_SAFE_ROOTS) {
    const files = (await readdir(root, { recursive: true })).filter(
      (name) => (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.includes(".test."),
    );
    expect(files.length, `${label} has no product modules`).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(new URL(file, root), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of imports) {
        const context = `${label}/${file} imports ${specifier}`;
        expect(specifier.startsWith("node:"), context).toBe(false);
        expect(specifier.startsWith("bun:"), context).toBe(false);
        expect(specifier.includes("sqlite"), context).toBe(false);
        expect(/(^|\/)config(\.js)?$/.test(specifier), context).toBe(false);
      }
    }
  }
});

test("every pa-* token the render stack uses is defined by both host stylesheets", async () => {
  const names = await readdir(RENDER_STACK, { recursive: true });
  const sources = await Promise.all(
    names
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      .map((name) => readFile(new URL(name, RENDER_STACK), "utf8")),
  );
  const source = sources.join("\n");

  // 工具类 bg-pa-surface 需要 @theme inline 里有 --color-pa-surface（透明度修饰符如 /50 不算颜色名的一部分）
  const utilities = new Set(
    [
      ...source.matchAll(
        /\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(pa-[a-z][a-z-]*)/g,
      ),
    ].map((match) => match[1]),
  );
  // 内联 style 用到的每个 CSS 变量都必须有定义。
  const VAR_PATTERN = /var\(\s*(--pa-[a-z][a-z-]*)/g;
  expect([...'style="color:var(--pa-fg)"'.matchAll(VAR_PATTERN)].map((match) => match[1])).toEqual([
    "--pa-fg",
  ]);
  const variables = new Set([...source.matchAll(VAR_PATTERN)].map((match) => match[1]));
  expect(
    utilities.size,
    "render stack uses no pa-* utilities — regex likely stale",
  ).toBeGreaterThan(0);

  const tokens = await readFile(TOKENS_CSS, "utf8");
  for (const utility of utilities) {
    expect(tokens.includes(`--color-${utility}:`), `tokens.css lacks --color-${utility}`).toBe(
      true,
    );
  }
  for (const variable of variables) {
    expect(tokens.includes(`${variable}:`), `tokens.css lacks ${variable}`).toBe(true);
  }

  // tokens.css 只有被宿主样式表导入才生效，两个宿主都必须显式 @import
  for (const stylesheet of HOST_STYLESHEETS) {
    const css = await readFile(new URL(stylesheet, import.meta.url), "utf8");
    expect(
      css.includes(`@import "../../src/presentation_core/tokens.css"`),
      `${stylesheet} does not import presentation_core/tokens.css`,
    ).toBe(true);
  }
});

/** 会产生 Tailwind 类名的源码目录，必须在两个宿主样式表里用 `@source` 登记，否则其中的新类不会被生成。 */
const CLASS_BEARING_SOURCES = ["../../result_view/src", "../../src/presentation_core"];

test("every source directory that emits class names is registered with both host stylesheets", async () => {
  for (const stylesheet of HOST_STYLESHEETS) {
    const css = await readFile(new URL(stylesheet, import.meta.url), "utf8");
    const registered = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(
      registered.length,
      `${stylesheet} 里没有读到任何 @source，这条检查已经不起作用`,
    ).toBeGreaterThan(0);
    expect(registered).not.toContain("../../src/semantic_core");
    for (const source of CLASS_BEARING_SOURCES) {
      expect(registered, `${stylesheet} 没有登记 ${source}，该目录新增的样式类不会生成`).toContain(
        source,
      );
    }
  }
});

/**
 * 浏览器工作区的模块别名：tsconfig 和 vite 必须声明同一组别名，每个别名至少被 import 一次；
 * 除工作区自身的根别名外，别名只能指向 contracts、semantic_core 或 presentation_core。
 */
const BROWSER_WORKSPACES = ["console", "widget"] as const;
const WORKSPACE_ROOT_ALIASES = new Set(["@", "@widget"]);

const aliasNames = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].map((match) => match[1].replace(/\/\*$/, "")).sort();

const importers = (alias: string, sources: string[]): number =>
  sources.filter((text) =>
    new RegExp(`from\\s+["']${alias}(?:/|["'])|import\\(\\s*["']${alias}(?:/|["'])`).test(text),
  ).length;

test("every browser alias is declared twice and imported at least once", async () => {
  // 先验证匹配规则本身：能提取别名、不误认普通键，并同时识别 from 和动态 import 两种写法
  expect(
    aliasNames(`"@shape": ["../src/presentation_core/view_shape.ts"]`, /"(@[^"]*)"\s*:\s*\[/g),
  ).toEqual(["@shape"]);
  expect(aliasNames(`"strict": true`, /"(@[^"]*)"\s*:\s*\[/g)).toEqual([]);
  expect(
    importers("@shape", ['import { a } from "@shape";', 'import("@widget/x")', 'from "@shapes"']),
  ).toBe(1);
  expect(importers("@widget", ['import("@widget/components/x")'])).toBe(1);
  expect(importers("@member", ['from "@members"'])).toBe(0);

  for (const workspace of BROWSER_WORKSPACES) {
    const tsconfig = await readFile(
      new URL(`../${workspace}/tsconfig.json`, import.meta.url),
      "utf8",
    );
    const vite = await readFile(new URL(`../${workspace}/vite.config.ts`, import.meta.url), "utf8");
    const declared = aliasNames(tsconfig, /"(@[^"]*)"\s*:\s*\[/g);
    expect(declared.length, `${workspace}/tsconfig.json declares no alias`).toBeGreaterThan(0);
    expect(
      aliasNames(vite, /"(@[^"]*)"\s*:\s*path\.resolve\(/g),
      `${workspace}/vite.config.ts and tsconfig.json disagree`,
    ).toEqual(declared);

    const srcDir = new URL(`../${workspace}/src/`, import.meta.url);
    const names = (await readdir(srcDir, { recursive: true })).filter(
      (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
    );
    const sources = await Promise.all(names.map((name) => readFile(new URL(name, srcDir), "utf8")));

    for (const alias of declared) {
      expect(
        importers(alias, sources),
        `${workspace} declares ${alias} but nothing imports it — drop it from both configs`,
      ).toBeGreaterThan(0);
      if (WORKSPACE_ROOT_ALIASES.has(alias)) continue;
      const line = tsconfig
        .split("\n")
        .find(
          (candidate) => candidate.includes(`"${alias}"`) || candidate.includes(`"${alias}/*"`),
        );
      expect(line, `${workspace}/tsconfig.json ${alias}`).toMatch(
        /\/(?:contracts|semantic_core|presentation_core)\//,
      );
    }
  }
});

test("result_view exposes one public package entry", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../result_view/package.json", import.meta.url), "utf8"),
  ) as { name?: string; exports?: Record<string, string> };
  expect(packageJson.name).toBe("pa-result-view");
  expect(packageJson.exports).toEqual({ ".": "./src/index.ts" });
});
