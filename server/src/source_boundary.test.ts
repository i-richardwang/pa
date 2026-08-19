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
 * 宿主专有令牌名：控制台样式表定义、MCP widget 样式表没有。渲染栈跨两个宿主复用，
 * 用了这些名字的工具类在 widget 侧生不出规则——与 pa-* 缺映射同一种失败，方向相反。
 * chart-N 不在其列：两个宿主都定义，图表系列色本就是共享契约。
 */
const HOST_ONLY_COLORS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "info",
  "info-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
];

const HOST_COLOR_PATTERN = new RegExp(
  `\\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(${HOST_ONLY_COLORS.join("|")})(?![\\w-])`,
  "g",
);

test("the render stack styles itself only through pa-* tokens", async () => {
  // 探测器自身的活性：已知坏输入必中、好输入必零中
  expect([..."text-primary-foreground bg-card".matchAll(HOST_COLOR_PATTERN)].length).toBe(2);
  expect([..."border-b text-xs bg-pa-surface".matchAll(HOST_COLOR_PATTERN)].length).toBe(0);

  const names = (await readdir(RENDER_STACK, { recursive: true })).filter(
    (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
  );
  for (const name of names) {
    const source = await readFile(new URL(name, RENDER_STACK), "utf8");
    const found = [...source.matchAll(HOST_COLOR_PATTERN)].map((match) => match[0]);
    expect(
      found,
      `result_view/src/${name} uses host-only color utilities: ${found.join(", ")}`,
    ).toEqual([]);
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
 * 浏览器工作区的模块别名白名单：名字集合全等，任何新别名都必须先记到这里，
 * 编译器内务模块无从借道一个未登记的别名进入浏览器。tsconfig 与 vite 两套必须一致。
 * 自身工作区根别名（@、@widget）之外，别名一律指向显式源码边界。
 */
const BROWSER_ALIASES: Record<string, string[]> = {
  console: [
    "@",
    "@charts",
    "@contracts",
    "@data-capability-map",
    "@format",
    "@member",
    "@payload",
    "@semantic-analysis",
    "@shape",
    "@time",
  ],
  widget: [
    "@charts",
    "@format",
    "@member",
    "@payload",
    "@product",
    "@records",
    "@shape",
    "@widget",
  ],
};
const WORKSPACE_ROOT_ALIASES = new Set(["@", "@widget"]);

const aliasNames = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].map((match) => match[1].replace(/\/\*$/, "")).sort();

test("browser aliases are exactly the approved source-boundary set", async () => {
  // 探测器活性：登记形态必须被抽出，非别名键必须落空
  expect(
    aliasNames(`"@shape": ["../src/presentation_core/view_shape.ts"]`, /"(@[^"]*)"\s*:\s*\[/g),
  ).toEqual(["@shape"]);
  expect(aliasNames(`"strict": true`, /"(@[^"]*)"\s*:\s*\[/g)).toEqual([]);

  for (const [workspace, approved] of Object.entries(BROWSER_ALIASES)) {
    const tsconfig = await readFile(
      new URL(`../${workspace}/tsconfig.json`, import.meta.url),
      "utf8",
    );
    const vite = await readFile(new URL(`../${workspace}/vite.config.ts`, import.meta.url), "utf8");
    expect(aliasNames(tsconfig, /"(@[^"]*)"\s*:\s*\[/g), `${workspace}/tsconfig.json`).toEqual(
      approved,
    );
    expect(
      aliasNames(vite, /"(@[^"]*)"\s*:\s*path\.resolve\(/g),
      `${workspace}/vite.config.ts`,
    ).toEqual(approved);

    for (const alias of approved) {
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
