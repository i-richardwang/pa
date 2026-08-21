import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const BROWSER_SAFE_ROOTS = [
  ["contracts", new URL("./contracts/", import.meta.url)],
  ["semantic_core", new URL("./semantic_core/", import.meta.url)],
  ["presentation_core", new URL("./presentation_core/", import.meta.url)],
  ["result_view", new URL("../result_view/src/", import.meta.url)],
] as const;

/** 结果视图的样式契约：组件在 result_view，令牌单源在 presentation_core/tokens.css，
    两个宿主样式表都必须导入它，缺导入则类名在而 CSS 规则不在。 */
const RENDER_STACK = new URL("../result_view/src/", import.meta.url);
const HOST_STYLESHEETS = ["../widget/src/styles.css", "../console/src/styles.css"];
const TOKENS_CSS = new URL("./presentation_core/tokens.css", import.meta.url);

test("browser-safe source packages remain free of Node, database, and service configuration imports", async () => {
  // 就近同置的用例不进浏览器，可以用 bun:test 与 node:fs 读取真文件；只扫产品模块。
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

  // 工具类 bg-pa-surface → @theme inline 需有 --color-pa-surface（透明度修饰符 /50 不计入色名）
  const utilities = new Set(
    [
      ...source.matchAll(
        /\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(pa-[a-z][a-z-]*)/g,
      ),
    ].map((match) => match[1]),
  );
  // 内联 style 直接消费的变量：当前渲染栈可以零消费（tooltip 恒深底走字面色），
  // 但一旦消费就必须有裸变量定义；正则活性用合成样例保证，不依赖真实用例存在。
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

  // 令牌单源只在被宿主样式表导入时才生效：两个宿主都必须显式 @import
  for (const stylesheet of HOST_STYLESHEETS) {
    const css = await readFile(new URL(stylesheet, import.meta.url), "utf8");
    expect(
      css.includes(`@import "../../src/presentation_core/tokens.css"`),
      `${stylesheet} does not import presentation_core/tokens.css`,
    ).toBe(true);
  }
});

/**
 * 出类名的源目录必须在两个宿主样式表里 `@source` 登记。没登记的目录不是立刻失效——
 * 它的类只在别处碰巧写过同名类时才生出规则，于是新类静默丢失、旧类看着还好。
 * 渲染栈在 result_view，图例行版式那份配方在 presentation_core（`legendRowClass`）。
 */
const CLASS_BEARING_SOURCES = ["../../result_view/src", "../../src/presentation_core"];

test("every source directory that emits class names is registered with both host stylesheets", async () => {
  for (const stylesheet of HOST_STYLESHEETS) {
    const css = await readFile(new URL(stylesheet, import.meta.url), "utf8");
    const registered = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((match) => match[1]);
    // 探测器活性：认得出真登记项，且不把随便一个路径当成已登记
    expect(
      registered.length,
      `${stylesheet} 一条 @source 都没读到，断言失去着力点`,
    ).toBeGreaterThan(0);
    expect(registered).not.toContain("../../src/semantic_core");
    for (const source of CLASS_BEARING_SOURCES) {
      expect(registered, `${stylesheet} 少登记 ${source}，那里的新类会静默丢失`).toContain(source);
    }
  }
});

/**
 * 浏览器工作区的模块别名：tsconfig 与 vite 两套声明同一个集合，每个别名都有源码在 import，
 * 自身工作区根别名之外，别名一律指向显式源码边界（contracts / semantic_core / presentation_core）。
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
  // 探测器活性：登记形态必须被抽出，非别名键必须落空；importer 计数认 from 与动态 import 两种写法
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
