import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const CONSOLE_SRC = new URL("../console/src/", import.meta.url);
const RESULT_VIEW_SRC = new URL("../result_view/src/", import.meta.url);
const WIDGET_SRC = new URL("../widget/src/", import.meta.url);
const COMMENT_OR_JSX_COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function isProductSource(name: string): boolean {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx")) return false;
  return !name.endsWith(".test.ts") && !name.endsWith(".test.tsx");
}

async function readSources(base: URL): Promise<Array<{ name: string; text: string }>> {
  const names = (await readdir(base, { recursive: true })).filter(isProductSource);
  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(new URL(name, base), "utf8"),
    })),
  );
}

const STAGE_RAIL_DIVIDER = /\bborder-l-\[0\.5px\]/g;
const STAGE_RAIL_OWNER = "dashboard/layout/shell.tsx";

test("右侧栏与主区之间的分隔线只在 shell.tsx 里画", async () => {
  const bad = 'className="flex flex-col border-pa-line border-l-[0.5px]"';
  const good = 'className="flex flex-col border-pa-line border-l"';
  expect([...bad.matchAll(STAGE_RAIL_DIVIDER)], "匹配规则没有命中已知的违规样本").toHaveLength(1);
  const other = 'className="md:border-r-[0.5px] border-pa-line border-l"';
  expect([...good.matchAll(STAGE_RAIL_DIVIDER)], "匹配规则误报了 1px 边框").toEqual([]);
  expect(
    [...other.matchAll(STAGE_RAIL_DIVIDER)],
    "匹配规则误报了其他位置的竖线（如设置页左侧导航自己的右边框）",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  const owner = sources.find(({ name }) => name.endsWith(STAGE_RAIL_OWNER));
  expect(owner?.text, "shell.tsx 里没有找到这条分隔线，这条检查已经不起作用").toMatch(
    STAGE_RAIL_DIVIDER,
  );
  STAGE_RAIL_DIVIDER.lastIndex = 0;

  for (const { name, text } of sources) {
    if (name.endsWith(STAGE_RAIL_OWNER)) continue;
    expect(
      [...text.matchAll(STAGE_RAIL_DIVIDER)],
      `console/src/${name} 自己画了右侧栏分隔线；这条线只由 shell.tsx 画，两处都画会叠成 1px`,
    ).toEqual([]);
  }
});

const HAND_ROLLED_ROLE =
  /(?<![[\w-])role=["'](listbox|option|combobox|menu|menubar|menuitem|menuitemcheckbox|menuitemradio|tab|tablist|tabpanel|tree|treeitem|grid|gridcell|dialog|alertdialog|radiogroup|slider|spinbutton)["']/g;

test("interaction roles are set by primitives, not written at call sites", async () => {
  const bad = '<div role="listbox"><span role="option">A</span></div>';

  const good =
    '<div role="alert" /><p role="presentation" /><style>{"[role=\'combobox\'], [role=\'listbox\'] {}"}</style>';
  expect([...bad.matchAll(HAND_ROLLED_ROLE)].length, "role matcher is stale").toBe(2);
  expect([...good.matchAll(HAND_ROLLED_ROLE)], "role matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  for (const { name, text } of sources) {
    const found = [...text.matchAll(HAND_ROLLED_ROLE)].map((match) => match[1]);
    expect(
      found,
      `console/src/${name} hand-writes role=${found.join("/")}; take it from a Base UI primitive instead`,
    ).toEqual([]);
  }
});

const POPUP_SURFACE_CSS = new URL("./presentation_core/tokens.css", import.meta.url);
const POPUP_SURFACE_CLASS = "pa-popup-surface";
const POPUP_SURFACE_INGREDIENT =
  /\bbg-pa-glass(?:-popover)?\b|\bbackdrop-blur(?:-[a-z0-9[\]()-]+)?\b/g;
const GLASS_TIERS = ["card", "popup"];

test("the glass popup surface is defined in one place, with blur levels set in tokens", async () => {
  expect(
    [
      ...'className="bg-pa-glass-popover backdrop-blur-lg bg-pa-glass"'.matchAll(
        POPUP_SURFACE_INGREDIENT,
      ),
    ].length,
    "surface matcher is stale",
  ).toBe(3);
  expect(
    [
      ...'className="pa-popup-surface pa-popup-surface-stage backdrop-grayscale"'.matchAll(
        POPUP_SURFACE_INGREDIENT,
      ),
    ],
    "surface matcher over-matches",
  ).toEqual([]);

  const css = await readFile(POPUP_SURFACE_CSS, "utf8");
  const recipe = css.match(/\.pa-popup-surface\s*\{([^}]*)\}/);
  expect(recipe, "tokens.css no longer defines .pa-popup-surface").not.toBeNull();
  expect(recipe?.[1]).toContain("var(--pa-glass-popover)");
  expect(recipe?.[1]).toContain("var(--pa-popover-glow)");
  expect(recipe?.[1]).toContain("blur(var(--pa-glass-blur))");
  for (const tier of GLASS_TIERS) {
    expect(css, `tokens.css lost the ${tier} blur tier`).toMatch(
      new RegExp(`--pa-glass-blur-${tier}:\\s*\\d+px;`),
    );
  }
  expect(css, "tokens.css lost the card surface modifier").toMatch(
    /\.pa-popup-surface-card\s*\{[^}]*--pa-glass-blur:\s*var\(--pa-glass-blur-card\)/,
  );
  expect(css, "tokens.css lost the stage surface modifier").toMatch(
    /\.pa-popup-surface-stage\s*\{[^}]*background-color:\s*var\(--pa-glass\)/,
  );

  const sources = [
    ...(await readSources(CONSOLE_SRC)),
    ...(await readSources(RESULT_VIEW_SRC)),
    ...(await readSources(WIDGET_SRC)),
  ];
  const consumers = sources.filter(({ text }) => text.includes(POPUP_SURFACE_CLASS));
  expect(
    consumers.length,
    "nobody consumes the popup surface — the class name moved",
  ).toBeGreaterThan(0);

  for (const { name, text } of sources) {
    expect(
      [...text.matchAll(POPUP_SURFACE_INGREDIENT)].map((match) => match[0]),
      `${name} re-spells the popup surface instead of taking .${POPUP_SURFACE_CLASS}`,
    ).toEqual([]);
  }
});

const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const CARD_TITLE_FILES = [
  { base: CONSOLE_SRC, name: "dashboard/boards/tile_shell.tsx" },
  { base: RESULT_VIEW_SRC, name: "components/view_renderer.tsx" },
  { base: WIDGET_SRC, name: "components/record_card.tsx" },
];

const TYPOGRAPHY_CLASS = /^(?:font|text|leading|tracking)-/;
const CARD_TITLE_SIZE = "text-base";

function typographyOf(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((name) => TYPOGRAPHY_CLASS.test(name))
    .sort();
}

test("the card title uses the same typography in all three hosts", async () => {
  expect(
    typographyOf("min-w-0 flex-1 truncate font-medium text-base text-pa-fg"),
    "typography matcher is stale",
  ).toEqual(["font-medium", "text-base", "text-pa-fg"]);
  expect(
    typographyOf("min-w-0 flex-1 truncate"),
    "typography matcher over-matches layout classes",
  ).toEqual([]);

  expect(
    typographyOf("font-semibold text-pa-fg text-sm"),
    "recipe comparison would pass the pre-fix spelling",
  ).not.toEqual(typographyOf("font-medium text-base text-pa-fg"));

  const recipes = await Promise.all(
    CARD_TITLE_FILES.map(async ({ base, name }) => {
      const text = await readFile(new URL(name, base), "utf8");
      const titles = [...text.matchAll(/className="([^"]*)"/g)]
        .map((match) => match[1])
        .filter((className) => className.includes(CARD_TITLE_SIZE));
      expect(
        titles.length,
        `${name} no longer has exactly one ${CARD_TITLE_SIZE} class string — the card title moved or changed size`,
      ).toBe(1);
      return { name, recipe: typographyOf(titles[0]) };
    }),
  );

  const [first, ...rest] = recipes;
  for (const { name, recipe } of rest) {
    expect(
      recipe,
      `${name} spells the card title as "${recipe.join(" ")}"; ${first.name} spells it "${first.recipe.join(" ")}" — one semantic, one recipe`,
    ).toEqual(first.recipe);
  }
  expect(first.recipe).toContain(CARD_TITLE_SIZE);
  expect(first.recipe).toContain("font-medium");
  for (const weight of ["font-semibold", "font-bold"]) {
    expect(first.recipe, `card title leans on ${weight} instead of size`).not.toContain(weight);
  }
});

const WINDOW_ONLY_WIDTH = /\bWidthProvider\b/g;

test("container width is measured with ResizeObserver, not from the window size", async () => {
  expect(
    [..."const G = WidthProvider(Responsive)".matchAll(WINDOW_ONLY_WIDTH)].length,
    "width matcher is stale",
  ).toBe(1);
  expect(
    [..."const G = Responsive; // width={size.width}".matchAll(WINDOW_ONLY_WIDTH)],
    "width matcher over-matches",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  for (const { name, text } of sources) {
    const code = text.replaceAll(COMMENT_OR_JSX_COMMENT, " ");
    expect(
      [...code.matchAll(WINDOW_ONLY_WIDTH)],
      `console/src/${name} takes its width from WidthProvider; observe the element instead (useElementSize)`,
    ).toEqual([]);
  }

  const observed = sources.filter(({ text }) => text.includes("useElementSize"));
  expect(
    observed.length,
    "nobody observes element size — the replacement path is gone",
  ).toBeGreaterThan(0);
});

const HEADER_ROW_UNDO = /<TableRow\b[^>]*className=["'][^"']*(?:border-t-0|hover:bg-transparent)/g;

test("primitive defaults are changed in the primitive, not overridden per page", async () => {
  const bad = '<TableRow className="border-t-0 hover:bg-transparent">';
  const good = '<TableRow className="cursor-pointer"><TableHead className="w-[60%]" />';
  expect([...bad.matchAll(HEADER_ROW_UNDO)].length, "header-row matcher is stale").toBe(1);
  expect([...good.matchAll(HEADER_ROW_UNDO)], "header-row matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  for (const { name, text } of sources) {
    expect(
      [...text.matchAll(HEADER_ROW_UNDO)],
      `console/src/${name} undoes the row default on a header row; put the rule on TableHeader instead`,
    ).toEqual([]);
  }

  const table = sources.find(({ name }) => name.endsWith("ui/table.tsx"));
  expect(table, "ui/table.tsx not found — the scan path is stale").toBeDefined();
  expect(table?.text).toContain("[&_tr]:border-t-0");
  expect(table?.text).toContain("[&_tr]:hover:bg-transparent");
});

const OFF_VOCAB_GUTTER = /(?<![@\w-])container(?![\w-])/g;

test("the in-card padding is defined in one place", async () => {
  const bad = '<div className="container pt-4" /><div className={cn("container flex")} />';
  const good =
    '<div className="@container flex" /><div data-slot="table-container" /><div data-slot="sidebar-container" /><div className={cn(MAIN_CARD_BODY_INSET)} />';
  expect([...bad.matchAll(OFF_VOCAB_GUTTER)].length, "gutter matcher is stale").toBe(2);
  expect([...good.matchAll(OFF_VOCAB_GUTTER)], "gutter matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  for (const { name, text } of sources) {
    const code = text.replaceAll(COMMENT_OR_JSX_COMMENT, " ");
    expect(
      [...code.matchAll(OFF_VOCAB_GUTTER)],
      `console/src/${name} opens a second in-card gutter with \`container\`; use MAIN_CARD_BODY_INSET`,
    ).toEqual([]);
  }

  const gutter = sources.find(({ name }) => name.endsWith("layout/layout_chrome.tsx"));
  expect(gutter?.text, "layout_chrome no longer defines the single gutter").toContain(
    "export const MAIN_CARD_BODY_INSET =",
  );
  const users = sources.filter(({ text }) => /\bMAIN_CARD_BODY_INSET\b/.test(text));
  expect(
    users.length,
    "the single gutter has no consumers left — it stopped being the one road",
  ).toBeGreaterThan(1);
});

const COMPONENT_DEF = /^(?:export )?function ([A-Z][A-Za-z0-9]*)\(/gm;

test("a component name is defined in exactly one file", async () => {
  const bad = "function EmptyPanel({ text }) {\nexport function EmptyPanel(props) {";
  const good = "function useThing() {\n  function EmptyPanel() {}\nconst EmptyPanel = 1;";
  expect(
    [...bad.matchAll(COMPONENT_DEF)].map((m) => m[1]),
    "component matcher is stale",
  ).toEqual(["EmptyPanel", "EmptyPanel"]);
  expect([...good.matchAll(COMPONENT_DEF)], "component matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(sources.length, "console source scan found no files — path likely stale").toBeGreaterThan(
    0,
  );
  const homes = new Map<string, string[]>();
  for (const { name, text } of sources) {
    for (const [, component] of text.matchAll(COMPONENT_DEF)) {
      homes.set(component, [...(homes.get(component) ?? []), name]);
    }
  }

  expect(homes.size, "no components found — the matcher stopped matching").toBeGreaterThan(50);

  const shared = [...homes].filter(([, files]) => files.length > 1);
  expect(
    shared.map(([component, files]) => `${component}: ${files.join(", ")}`),
    "the same component is defined in more than one file; give it one home and import it",
  ).toEqual([]);
});

const NON_CHINESE_ARIA_LABEL = /aria-label=["']([^"'{}]*)["']/g;
const HAS_CHINESE = /[一-鿿]/;

test("aria-label is written in the interface's own language", async () => {
  const bad = 'aria-label="Close" aria-label="pagination"';
  const good = 'aria-label="关闭" aria-label="API 密钥" aria-label={copyLabel}';
  expect(
    [...bad.matchAll(NON_CHINESE_ARIA_LABEL)].map((m) => m[1]),
    "aria-label matcher is stale",
  ).toEqual(["Close", "pagination"]);
  expect(
    [...good.matchAll(NON_CHINESE_ARIA_LABEL)].map((m) => m[1]).filter((l) => !HAS_CHINESE.test(l)),
    "aria-label matcher flags Chinese labels or reads into expressions",
  ).toEqual([]);

  for (const base of [CONSOLE_SRC, RESULT_VIEW_SRC, WIDGET_SRC]) {
    const sources = await readSources(base);
    expect(sources.length, "source scan found no files — path likely stale").toBeGreaterThan(0);
    for (const { name, text } of sources) {
      const english = [...text.matchAll(NON_CHINESE_ARIA_LABEL)]
        .map((m) => m[1])
        .filter((label) => !HAS_CHINESE.test(label));
      expect(
        english,
        `${name} names something in English for screen readers only; write it in Chinese`,
      ).toEqual([]);
    }
  }
});

const PAGE_WRITTEN_SHEET_WIDTH = /<SheetPopup\b[^>]*\bmax-w-/g;

test("pages do not set the sheet width", async () => {
  const bad = '<SheetPopup className="max-w-160">';
  const good = '<SheetPopup>\n<DialogPopup className="max-w-lg">';
  expect([...bad.matchAll(PAGE_WRITTEN_SHEET_WIDTH)], "sheet width matcher is stale").toHaveLength(
    1,
  );
  expect([...good.matchAll(PAGE_WRITTEN_SHEET_WIDTH)], "sheet width matcher over-matches").toEqual(
    [],
  );

  const sources = await readSources(CONSOLE_SRC);
  for (const { name, text } of sources) {
    if (name.endsWith("components/ui/sheet.tsx")) continue;
    expect(
      [...text.matchAll(PAGE_WRITTEN_SHEET_WIDTH)],
      `console/src/${name} writes the sheet width; it belongs to ui/sheet.tsx`,
    ).toEqual([]);
  }

  const sheet = sources.find(({ name }) => name.endsWith("components/ui/sheet.tsx"));
  expect(sheet?.text, "ui/sheet.tsx does not define the single sheet width").toMatch(
    /const SIDESHEET_WIDTH = ["']max-w-/,
  );
});

const OPTION_ROW = /<InspectorRow\b([\s\S]*?)<\/InspectorRow>/g;
const SELECT_TRIGGER = /<SelectTrigger\b([^>]*)>/g;

/** 行内下拉框的可访问名称来自行标签 `label={<SelectLabel>}` 或自身的 `aria-label`。 */
function unnamedSelectRows(text: string): string[] {
  const bad: string[] = [];
  for (const [block, body] of text.matchAll(OPTION_ROW)) {
    const named = /label=\{[\s\S]{0,80}?<SelectLabel\b/.test(block);
    const anonymous = [...body.matchAll(SELECT_TRIGGER)].filter(
      ([, attributes]) => !attributes.includes("aria-label"),
    );
    if (!anonymous.length || named) continue;
    bad.push(block.slice(0, 60).replaceAll(/\s+/g, " "));
  }
  return bad;
}

test("a settings row provides the accessible name of its control", async () => {
  const BAD = '<InspectorRow label="坐标轴">\n<SelectTrigger />\n</InspectorRow>';
  const GOOD =
    "<InspectorRow label={<SelectLabel>坐标轴</SelectLabel>}>\n<SelectTrigger />\n</InspectorRow>";
  const SELF_NAMED =
    '<InspectorRow label="按组织">\n<SelectTrigger aria-label="算哪个指标的占比" />\n</InspectorRow>';
  const TEXT_ONLY = '<InspectorRow label="类型">\n<span>指标</span>\n</InspectorRow>';
  expect(unnamedSelectRows(BAD), "匹配规则没有命中已知的违规样本").toHaveLength(1);
  expect(unnamedSelectRows(GOOD), "匹配规则误报了已用 SelectLabel 命名的行").toEqual([]);
  expect(unnamedSelectRows(SELF_NAMED), "下拉自带 aria-label 时不应报错").toEqual([]);
  expect(unnamedSelectRows(TEXT_ONLY), "只有静态文本、没有控件的行不应报错").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  const rows = sources.filter(({ text }) => text.includes("<InspectorRow"));
  expect(rows.length, "没有扫描到任何设置行，这条检查已经不起作用").toBeGreaterThan(1);
  for (const { name, text } of rows) {
    expect(
      unnamedSelectRows(text),
      `console/src/${name} 的设置行给下拉用了纯文本标签；请改用 <SelectLabel>，否则屏幕阅读器读出的是当前值`,
    ).toEqual([]);
  }
});

const AUTOCOMPLETE_TRIGGER = /<AutocompleteTrigger\b([\s\S]*?)>/g;

function unnamedComboTriggers(text: string): string[] {
  return [...text.matchAll(AUTOCOMPLETE_TRIGGER)]
    .filter(([, attrs]) => !attrs.includes("aria-label") && !attrs.includes("render="))
    .map(([tag]) => tag.replaceAll(/\s+/g, " ").slice(0, 60));
}

test("a custom combobox trigger has its own accessible name", async () => {
  expect(
    unnamedComboTriggers('<AutocompleteTrigger className="x">'),
    "匹配规则没有命中已知的违规样本",
  ).toHaveLength(1);
  expect(
    unnamedComboTriggers('<AutocompleteTrigger aria-label="添加瓦片" className="x">'),
    "匹配规则误报了已写 aria-label 的触发按钮",
  ).toEqual([]);
  expect(
    unnamedComboTriggers("<AutocompleteTrigger render={trigger} />"),
    "用 render= 渲染时名称在别处提供，不应报错",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  const hosts = sources.filter(({ text }) => text.includes("<AutocompleteTrigger"));
  expect(hosts.length, "没有扫描到任何 AutocompleteTrigger，这条检查已经不起作用").toBeGreaterThan(
    0,
  );
  for (const { name, text } of hosts) {
    expect(
      unnamedComboTriggers(text),
      `console/src/${name} 的下拉触发按钮缺少可访问名称；按钮上显示的文字不算，请写 aria-label`,
    ).toEqual([]);
  }
});

const COMMAND_POPUP = /<CommandDialogPopup\b([^>]*)>/g;

function popupsWithoutFinalFocus(text: string): string[] {
  return [...text.matchAll(COMMAND_POPUP)]
    .filter(([, attrs]) => !attrs.includes("finalFocus"))
    .map(([tag]) => tag.replaceAll(/\s+/g, " "));
}

test("command popups without a trigger declare where focus returns", async () => {
  expect(
    popupsWithoutFinalFocus("<CommandDialogPopup>"),
    "匹配规则没有命中已知的违规样本",
  ).toHaveLength(1);
  expect(
    popupsWithoutFinalFocus("<CommandDialogPopup finalFocus={opener}>"),
    "匹配规则误报了已声明 finalFocus 的弹层",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  const hosts = sources.filter(({ text }) => text.includes("<CommandDialogPopup"));
  expect(hosts.length, "没有扫描到任何 CommandDialogPopup，这条检查已经不起作用").toBeGreaterThan(
    0,
  );
  for (const { name, text } of hosts) {
    expect(
      popupsWithoutFinalFocus(text),
      `console/src/${name} 没有声明 finalFocus；关闭后键盘焦点会丢失`,
    ).toEqual([]);
  }
});

const SPIN_USE = /\banimate-spin\b/g;

test("waiting is shown with LoadingMark, not a standalone spinner", async () => {
  expect(
    [...'className="size-4 animate-spin"'.matchAll(SPIN_USE)],
    "matcher is stale",
  ).toHaveLength(1);
  expect([...'className="animate-spinner"'.matchAll(SPIN_USE)], "matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  for (const { name, text } of sources) {
    expect(
      [...text.matchAll(SPIN_USE)],
      `console/src/${name} spins on its own; a wait is marked by LoadingMark`,
    ).toEqual([]);
  }
});

const ALERT_WITH_ICON = /<Alert\b[^>]*>\s*<[A-Z][A-Za-z]*Icon\b/g;

test("alerts render their own level icon; call sites pass only text", async () => {
  expect(
    [...'<Alert variant="error">\n  <CircleAlertIcon />'.matchAll(ALERT_WITH_ICON)],
    "matcher is stale",
  ).toHaveLength(1);
  expect(
    [...'<Alert variant="error">\n  <AlertTitle>{error}</AlertTitle>'.matchAll(ALERT_WITH_ICON)],
    "matcher over-matches",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  const hosts = sources.filter(({ text }) => /<Alert[\s>]/.test(text));
  expect(hosts.length, "没有扫描到任何 Alert，这条检查已经不起作用").toBeGreaterThan(0);
  for (const { name, text } of hosts) {
    expect(
      [...text.matchAll(ALERT_WITH_ICON)],
      `console/src/${name} hands an alert its icon; the level already decides it`,
    ).toEqual([]);
  }
});

/** 等待内容时显示的加载文字（应改用 LoadingMark）。 */
const WAITING_WORDS = /(?:正在)?(?:载入|加载)中|正在(?:载入|加载)/g;

const LOADING_MARK_TAG = /<LoadingMark\b[^>]*>/g;

/** 只检查显示在界面上的文字，不算注释和 LoadingMark 给屏幕阅读器的名称。 */
function waitingWords(text: string): string[] {
  return [...text.replace(COMMENT, "").replace(LOADING_MARK_TAG, "").matchAll(WAITING_WORDS)].map(
    ([hit]) => hit,
  );
}

test("region loading renders LoadingMark instead of loading text", async () => {
  expect(
    waitingWords('<p className="text-sm">载入中…</p>'),
    "匹配规则没有命中已知的违规样本",
  ).toHaveLength(1);
  expect(
    waitingWords('{pending ? "正在加载数据" : rows}'),
    "匹配规则漏掉了表达式里的加载文字",
  ).toHaveLength(1);
  expect(
    waitingWords("{pending ? <LoadingMark /> : rows}"),
    "匹配规则误报了 LoadingMark 本身",
  ).toEqual([]);
  expect(
    waitingWords('<LoadingMark label="正在载入" />'),
    "匹配规则误报了 LoadingMark 给屏幕阅读器的名称",
  ).toEqual([]);
  expect(waitingWords("// 载入中显示的名字\nconst a = 1;"), "匹配规则误报了注释").toEqual([]);
  expect(
    waitingWords('<Alert variant="error">加载失败</Alert>'),
    "匹配规则误报了其他含「加载」的文字",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  expect(
    sources.some(({ text }) => text.includes("<LoadingMark")),
    "控制台里没有找到 LoadingMark，这条检查已经不起作用",
  ).toBe(true);
  for (const { name, text } of sources) {
    expect(
      waitingWords(text),
      `console/src/${name} 用文字代替了加载标记；区域加载请使用 LoadingMark`,
    ).toEqual([]);
  }
});

const PIXEL_TYPOGRAPHY = /\b(?:text|leading)-\[\d+px\]|\bfont-\[\d+\]/g;
const HAND_WRITTEN_RADIUS = /\brounded(?:-[a-z]+)?-\[(?!inherit\])[^\]]+\]/g;
const DISPLAY_RAMP = "components/kpis.tsx";

const HAND_DRAWN_ROUND = /\brounded-full\b/g;
const ROUND_PRIMITIVES = "components/ui/";

const NEUTRAL_CHIP = ["rounded-sm", "h-5", "px-1.5", "bg-pa-surface", "text-pa-muted", "text-xs"];

const FILL_HOVER = /\b(?:hover|data-pressed|data-highlighted|data-popup-open):bg-pa-[a-z-]+/;
const COLOUR_TRANSITION = /\btransition(?:-colors)?\b(?!-(?:opacity|transform|shadow|\[))/;

const DISABLED_BORROWS_CONTENT = /\bdata-disabled:|\bdisabled:/.source;
const BORROWED_FAINT = new RegExp(
  `(?:${DISABLED_BORROWS_CONTENT})(?:\\[&_svg\\]:)?text-pa-faint\\b`,
  "g",
);

const BORROWED_PLACEHOLDER = /(?<![\w-])placeholder:text-pa-(?:faint|muted)\b/g;

test("font sizes use the named steps, not hand-written pixel values", async () => {
  const bad = 'className="text-[13px] font-[450] leading-[17px]"';
  const good = 'className="text-[1.75rem] text-[length:inherit] leading-[inherit] size-[13px]"';
  expect([...bad.matchAll(PIXEL_TYPOGRAPHY)], "typography matcher is stale").toHaveLength(3);
  expect([...good.matchAll(PIXEL_TYPOGRAPHY)], "typography matcher over-matches").toEqual([]);

  const hosts = [
    { label: "console", base: CONSOLE_SRC },
    { label: "result_view", base: RESULT_VIEW_SRC },
    { label: "widget", base: WIDGET_SRC },
  ];
  for (const { label, base } of hosts) {
    const sources = await readSources(base);
    expect(
      sources.length,
      `${label} source scan found no files — path likely stale`,
    ).toBeGreaterThan(0);
    for (const { name, text } of sources) {
      if (name.endsWith(DISPLAY_RAMP)) continue;
      expect(
        [...text.matchAll(PIXEL_TYPOGRAPHY)],
        `${label}/src/${name} writes typography in pixels; take the named step, or fix the step in tokens.css`,
      ).toEqual([]);
    }
  }
});

test("border radius uses only the defined steps", async () => {
  const bad = 'className="rounded-[5px] rounded-[calc(var(--radius)-1px)] rounded-tl-[7px]"';
  const good = 'className="rounded-md rounded-avatar rounded-[inherit] size-[13px]"';
  expect([...bad.matchAll(HAND_WRITTEN_RADIUS)], "radius matcher is stale").toHaveLength(3);
  expect([...good.matchAll(HAND_WRITTEN_RADIUS)], "radius matcher over-matches").toEqual([]);

  const hosts = [
    { label: "console", base: CONSOLE_SRC },
    { label: "result_view", base: RESULT_VIEW_SRC },
    { label: "widget", base: WIDGET_SRC },
  ];
  for (const { label, base } of hosts) {
    const sources = await readSources(base);
    expect(
      sources.length,
      `${label} source scan found no files — path likely stale`,
    ).toBeGreaterThan(0);
    for (const { name, text } of sources) {
      expect(
        [...text.matchAll(HAND_WRITTEN_RADIUS)],
        `${label}/src/${name} writes a radius by hand; take the named step, or add the step in tokens.css`,
      ).toEqual([]);
    }
  }

  const consoleCss = await readFile(new URL("../console/src/styles.css", import.meta.url), "utf8");
  expect(consoleCss, "console re-declared a radius step; the ladder has one home").not.toMatch(
    /--radius(?:-[a-z0-9]+)?\s*:/,
  );
});

test("pills and round badges are drawn by primitives, not by call sites", async () => {
  const bad = '<Button className="h-8 rounded-full px-3" />';
  const good = '<Button size="icon" /><span className="rounded-lg" />';
  expect([...bad.matchAll(HAND_DRAWN_ROUND)], "round matcher is stale").toHaveLength(1);
  expect([...good.matchAll(HAND_DRAWN_ROUND)], "round matcher over-matches").toEqual([]);

  const hosts = [
    { label: "console", base: CONSOLE_SRC },
    { label: "result_view", base: RESULT_VIEW_SRC },
    { label: "widget", base: WIDGET_SRC },
  ];
  const consoleSources = await readSources(CONSOLE_SRC);
  for (const { label, base } of hosts) {
    const sources = label === "console" ? consoleSources : await readSources(base);
    expect(
      sources.length,
      `${label} source scan found no files — path likely stale`,
    ).toBeGreaterThan(0);
    for (const { name, text } of sources) {
      if (name.startsWith(ROUND_PRIMITIVES)) continue;
      expect(
        [...text.matchAll(HAND_DRAWN_ROUND)],
        `${label}/src/${name} draws a round shape by hand; take Button's size="icon" / pill sizes or Avatar`,
      ).toEqual([]);
    }
  }

  const button = consoleSources.find(({ name }) => name.endsWith("ui/button.tsx"));
  const avatar = consoleSources.find(({ name }) => name.endsWith("ui/avatar.tsx"));
  expect(button?.text, "ui/button.tsx no longer emits the pill").toContain("rounded-full");
  expect(avatar?.text, "ui/avatar.tsx no longer emits the round badge").toContain("rounded-full");
});

const CHIP_CLASS = /function Badge\([\s\S]*?className="([^"]*)"/;

const HEADING_TAG = /<h[12]\s+className="([^"]*)"/g;
const HEADING_DISPLAY_EXEMPT = "login.tsx";

function classLiterals(text: string): string[] {
  return [...text.matchAll(/"([^"\n]{12,})"|`([^`\n]{12,})`/g)].map((m) => m[1] ?? m[2] ?? "");
}

test("page headings use the title font weight", async () => {
  const bad = '<h2 className="text-xl font-medium">账号</h2>';
  const good = '<h1 className="truncate text-xl font-semibold">看板</h1>';

  const good2 = '<h1 className="min-w-0 truncate">{title}</h1>';
  const weights = (text: string) =>
    [...text.matchAll(HEADING_TAG)]
      .map((m) => m[1] ?? "")
      .filter((c) => /\bfont-(?:normal|medium)\b/.test(c));
  expect(weights(bad), "heading matcher is stale").toHaveLength(1);
  expect(weights(good + good2), "heading matcher over-matches").toEqual([]);

  for (const { name, text } of await readSources(CONSOLE_SRC)) {
    if (name.endsWith(HEADING_DISPLAY_EXEMPT)) continue;
    expect(
      weights(text),
      `console/src/${name} sets a page heading below the title weight; take font-semibold`,
    ).toEqual([]);
  }

  const tokens = await readFile(new URL("./presentation_core/tokens.css", import.meta.url), "utf8");
  expect(tokens, "the title weight drifted off 520").toContain("--font-weight-semibold: 520;");
});

test("hover background appears immediately, without a colour transition", async () => {
  const bad = '"rounded-md transition-colors duration-150 hover:bg-pa-surface"';
  const good =
    '"transition-opacity duration-300 hover:opacity-85" + "rounded-md hover:bg-pa-surface" + "transition duration-200 hover:border-pa-line-hover"';
  const hits = (text: string) =>
    classLiterals(text).filter((c) => FILL_HOVER.test(c) && COLOUR_TRANSITION.test(c));
  expect(hits(bad), "fill-hover matcher is stale").toHaveLength(1);
  expect(hits(good), "fill-hover matcher over-matches").toEqual([]);

  for (const base of [CONSOLE_SRC, RESULT_VIEW_SRC, WIDGET_SRC]) {
    for (const { name, text } of await readSources(base)) {
      expect(
        hits(text),
        `${name} fades a hover fill in; the grey means "the pointer is here" and must not lag it`,
      ).toEqual([]);
    }
  }

  const input = (await readSources(CONSOLE_SRC)).find(({ name }) => name.endsWith("ui/input.tsx"));
  expect(input?.text, "the input frame lost its transition").toContain("transition duration-200");
});

test("disabled and placeholder text use their own tokens, not content text colours", async () => {
  const bad = 'className="disabled:text-pa-faint data-disabled:[&_svg]:text-pa-faint"';
  const good = 'className="text-pa-faint disabled:text-pa-disabled-fg"';
  expect([...bad.matchAll(BORROWED_FAINT)], "disabled-borrow matcher is stale").toHaveLength(2);
  expect([...good.matchAll(BORROWED_FAINT)], "disabled-borrow matcher over-matches").toEqual([]);

  const badHold = 'className="placeholder:text-pa-faint placeholder:text-pa-muted"';
  const goodHold =
    'className="text-pa-muted placeholder:text-pa-placeholder data-placeholder:text-pa-muted"';
  expect([...badHold.matchAll(BORROWED_PLACEHOLDER)], "placeholder matcher is stale").toHaveLength(
    2,
  );
  expect([...goodHold.matchAll(BORROWED_PLACEHOLDER)], "placeholder matcher over-matches").toEqual(
    [],
  );

  for (const base of [CONSOLE_SRC, RESULT_VIEW_SRC, WIDGET_SRC]) {
    for (const { name, text } of await readSources(base)) {
      expect(
        [...text.matchAll(BORROWED_FAINT)],
        `${name} paints a disabled control with the content tier; take pa-disabled-fg`,
      ).toEqual([]);
      expect(
        [...text.matchAll(BORROWED_PLACEHOLDER)],
        `${name} paints a placeholder with the content tier; take pa-placeholder`,
      ).toEqual([]);
    }
  }

  const tokens = await readFile(new URL("./presentation_core/tokens.css", import.meta.url), "utf8");
  for (const axis of ["disabled-fg", "placeholder"]) {
    expect(tokens, `tokens.css dropped the ${axis} axis`).toContain(`--pa-${axis}:`);
    expect(tokens, `pa-${axis} is not exposed to Tailwind`).toContain(`--color-pa-${axis}:`);
  }
});

test("the neutral chip looks the same in every host", async () => {
  const sample =
    'function Badge({ children }) {\n  return <span className="rounded-sm px-1.5">{children}</span>;\n}';
  expect(CHIP_CLASS.exec(sample)?.[1], "chip class probe is stale").toBe("rounded-sm px-1.5");
  expect(
    CHIP_CLASS.exec('<input className="border-pa-line" />')?.[1],
    "chip class probe over-matches",
  ).toBeUndefined();

  const badge = (await readSources(CONSOLE_SRC)).find(({ name }) => name.endsWith("ui/badge.tsx"));
  const derived = (await readSources(RESULT_VIEW_SRC)).find(({ name }) =>
    name.endsWith("components/badge.tsx"),
  );
  expect(badge?.text, "console/src/components/ui/badge.tsx not found").toBeString();
  expect(derived?.text, "result_view/src/components/badge.tsx not found").toBeString();

  const chip = CHIP_CLASS.exec(derived?.text ?? "")?.[1];
  expect(chip, "result_view's Badge no longer matches the probe").toBeString();

  for (const token of NEUTRAL_CHIP) {
    expect(
      badge?.text,
      `ui/badge.tsx no longer carries ${token}; the pinned recipe is stale`,
    ).toContain(token);
    expect(chip, `result_view's Badge drifted from ui/badge.tsx on ${token}`).toContain(token);
  }

  expect(chip, "result_view's Badge grew a border; badges carry no outline").not.toContain(
    "border",
  );
});

const HAND_ROLLED_CLOSE = /aria-label="关闭"[\s\S]{0,160}?<Button\b/g;

test("the overlay close button is defined in one place", async () => {
  const bad = '<DialogClose aria-label="关闭" render={<Button size="icon" variant="subtle" />}>';
  const good = '<DialogClose aria-label="关闭" render={<OverlayCloseButton />}>';
  expect([...bad.matchAll(HAND_ROLLED_CLOSE)], "close-button matcher is stale").toHaveLength(1);
  expect([...good.matchAll(HAND_ROLLED_CLOSE)], "close-button matcher over-matches").toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  for (const { name, text } of sources) {
    if (name.endsWith("components/ui/toast.tsx")) continue;
    expect(
      [...text.matchAll(HAND_ROLLED_CLOSE)],
      `console/src/${name} draws its own close button; it belongs to ui/dialog.tsx`,
    ).toEqual([]);
  }

  const dialog = sources.find(({ name }) => name.endsWith("components/ui/dialog.tsx"));
  expect(dialog?.text, "ui/dialog.tsx no longer defines the single close-button shape").toMatch(
    /export function OverlayCloseButton\b/,
  );
  expect(dialog?.text, "ui/dialog.tsx no longer defines the single close-button inset").toMatch(
    /export const OVERLAY_CLOSE_INSET_CLASS = ["']absolute /,
  );
});

const ICON_SIZE_STEP = /"(icon(?:-sm|-xs)?)":\s*"([^"]*)"|\bicon:\s*"([^"]*)"/g;
const SHELL_ICON_HOMES = ["dashboard/layout/view_chrome.tsx", "components/ui/dialog.tsx"];

function iconSteps(text: string): Map<string, string> {
  const steps = new Map<string, string>();
  for (const match of text.matchAll(ICON_SIZE_STEP)) {
    steps.set(match[1] ?? "icon", match[2] ?? match[3] ?? "");
  }
  return steps;
}

test("icon button radius follows its size: app-frame buttons are round, content buttons use the base radius", async () => {
  const probe = iconSteps('icon: "size-8 rounded-full", "icon-sm": "size-7 rounded-md",');
  expect([...probe.keys()], "icon step probe is stale").toEqual(["icon", "icon-sm"]);

  const sources = await readSources(CONSOLE_SRC);
  const button = sources.find(({ name }) => name.endsWith("components/ui/button.tsx"));
  const steps = iconSteps(button?.text ?? "");
  expect([...steps.keys()].sort(), "button.tsx lost an icon step").toEqual([
    "icon",
    "icon-sm",
    "icon-xs",
  ]);
  expect(steps.get("icon"), "the shell icon step is no longer round").toContain("rounded-full");
  for (const step of ["icon-sm", "icon-xs"]) {
    expect(steps.get(step), `${step} left the base radius`).toContain("rounded-md");
    expect(steps.get(step), `${step} is not a shell step`).not.toContain("rounded-full");
  }

  for (const home of SHELL_ICON_HOMES) {
    const source = sources.find(({ name }) => name.endsWith(home));
    expect(source?.text, `${home} fell back to a content icon step`).toMatch(/size="icon"/);
  }
  const sidebar = sources.find(({ name }) => name.endsWith("components/ui/sidebar.tsx"));
  expect(sidebar?.text, "the sidebar tool button no longer takes the shell round").toMatch(
    /sidebarToolButtonClass =\s*\n?\s*"[^"]*\bsize-8\b[^"]*\brounded-full\b/,
  );
});

const HAND_WRITTEN_FOCUS =
  /\b(?:focus|focus-visible|focus-within):(?:ring-(?:\[|pa-|[1-9])[\w[\]/-]*|outline-[\w[\]/-]+)/g;
const FOCUS_UTILITIES = ["pa-focus", "pa-focus-within"];

test("keyboard focus uses the pa-focus utilities, not hand-written rings or outlines", async () => {
  const bad =
    'className="outline-none focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring focus-within:ring-2 focus:outline-pa-focus-strong focus-visible:outline-none"';
  const good =
    'className="pa-focus has-data-[slot=field-label]:pa-focus-within in-[[data-slot=field]]:focus-within:ring-0 focus-visible:border-transparent"';
  expect([...bad.matchAll(HAND_WRITTEN_FOCUS)], "focus matcher is stale").toHaveLength(5);
  expect([...good.matchAll(HAND_WRITTEN_FOCUS)], "focus matcher over-matches").toEqual([]);

  const tokens = await readFile(new URL("./presentation_core/tokens.css", import.meta.url), "utf8");
  for (const utility of FOCUS_UTILITIES) {
    expect(tokens, `tokens.css no longer defines @utility ${utility}`).toContain(
      `@utility ${utility} {`,
    );
  }
  const consoleCss = await readFile(new URL("../console/src/styles.css", import.meta.url), "utf8");
  expect(consoleCss, "console re-opened a global outline as a second focus mark").not.toMatch(
    /\boutline-pa-/,
  );

  for (const [label, base, floor] of [
    ["console/src", CONSOLE_SRC, 10],
    ["result_view/src", RESULT_VIEW_SRC, 5],
    ["widget/src", WIDGET_SRC, -1],
  ] as const) {
    // widget 只渲染结果视图，没有自己的可聚焦组件；floor 为 -1 表示只检查没有手写焦点样式。
    const sources = await readSources(base);
    for (const { name, text } of sources) {
      expect(
        [...text.matchAll(HAND_WRITTEN_FOCUS)].map((match) => match[0]),
        `${label}/${name} spells a focus mark by hand; take pa-focus or pa-focus-within`,
      ).toEqual([]);
    }
    const users = sources.filter(({ text }) => /\bpa-focus(?:-within)?\b/.test(text));
    expect(
      users.length,
      `${label}: nobody takes the focus utilities — the name moved`,
    ).toBeGreaterThan(floor);
  }
});

const OVERRIDDEN_SMALLEST_LEADING =
  /text-2xs[^"'`]*\bleading-(?:4|5|6|7|relaxed|normal|loose)\b|\bleading-(?:4|5|6|7|relaxed|normal|loose)[^"'`]*text-2xs/g;

test("the smallest font step is not given a looser paragraph line height", async () => {
  const bad = 'className="px-2 py-1.5 text-2xs leading-4 text-pa-muted"';
  const good = 'className="px-1 text-2xs leading-none text-pa-muted"';
  expect(
    [...bad.matchAll(OVERRIDDEN_SMALLEST_LEADING)],
    "smallest-step matcher is stale",
  ).toHaveLength(1);
  expect(
    [...good.matchAll(OVERRIDDEN_SMALLEST_LEADING)],
    "smallest-step matcher over-matches",
  ).toEqual([]);

  const sources = await readSources(CONSOLE_SRC);
  for (const { name, text } of sources) {
    expect(
      [...text.matchAll(OVERRIDDEN_SMALLEST_LEADING)],
      `console/src/${name} re-leads the smallest step; a hint paragraph takes <Hint>`,
    ).toEqual([]);
  }

  const hint = sources.find(({ name }) => name.endsWith("components/ui/hint.tsx"));
  expect(hint?.text, "ui/hint.tsx no longer defines the single hint step").toMatch(
    /export const HINT_TEXT = /,
  );
});

const RAW_AUTOCOMPLETE_INPUT = /<AutocompletePrimitive\.Input\b/g;
const AUTOCOMPLETE_INPUT_HOMES = ["components/ui/autocomplete.tsx", "components/ui/command.tsx"];

test("the popup search row is defined in one place", async () => {
  expect([
    ...'<AutocompletePrimitive.Input aria-label="搜索" />'.matchAll(RAW_AUTOCOMPLETE_INPUT),
  ]).toHaveLength(1);
  expect([...'<AutocompleteSearch aria-label="搜索" />'.matchAll(RAW_AUTOCOMPLETE_INPUT)]).toEqual(
    [],
  );

  const sources = await readSources(CONSOLE_SRC);
  for (const { name, text } of sources) {
    if (AUTOCOMPLETE_INPUT_HOMES.some((home) => name.endsWith(home))) continue;
    expect(
      [...text.matchAll(RAW_AUTOCOMPLETE_INPUT)],
      `console/src/${name} spells its own search row; it belongs to ui/autocomplete.tsx`,
    ).toEqual([]);
  }

  const autocomplete = sources.find(({ name }) => name.endsWith("components/ui/autocomplete.tsx"));
  expect(autocomplete?.text, "ui/autocomplete.tsx no longer exports the search row").toMatch(
    /export function AutocompleteSearch\b/,
  );
});

const DIRECTIONAL_COLOR = /\b(?:text|bg|border)-pa-(?:success|danger)\b/g;

test("差值只显示正负号，不使用涨跌色", async () => {
  const bad = '<span className="text-pa-success-fg tabular-nums">{row.delta}</span>';
  expect([...bad.matchAll(DIRECTIONAL_COLOR)], "匹配规则没有命中已知的违规样本").toHaveLength(1);
  const good = '<span className="text-pa-muted-fg tabular-nums">{row.delta}</span>';
  expect([...good.matchAll(DIRECTIONAL_COLOR)], "匹配规则误报了中性色").toEqual([]);

  const sources = (await readSources(RESULT_VIEW_SRC)).filter(({ text }) => /delta/i.test(text));
  expect(
    sources.length,
    "result_view 里没有找到渲染差值的组件，这条检查已经不起作用",
  ).toBeGreaterThan(0);
  for (const { name, text } of sources) {
    expect(
      [...text.matchAll(DIRECTIONAL_COLOR)],
      `result_view/src/${name} 给差值用了涨跌色；模型没有声明指标的好坏方向，按涨绿跌红着色会让离职类指标的含义看反`,
    ).toEqual([]);
  }
});
