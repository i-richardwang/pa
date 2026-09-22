import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, INLINE_ROWS, resolveTableSort } from "./data_table.js";
import type { ViewScene } from "../scene.js";
import type { TableModel } from "../../../src/presentation_core/view_shape.js";

const column = (label: string, formatKey: string, numeric: boolean, group?: string) => ({
  label,
  formatKey,
  numeric,
  headerPath: group
    ? [
        { key: `group:${formatKey}`, label: group },
        { key: `leaf:${formatKey}:${label}`, label },
      ]
    : [{ key: `field:${formatKey}`, label }],
});

const flat: TableModel = {
  columns: [
    column("组织", "hr.organization_name", false),
    column("在职人数", "hr.active_employee_count", true),
  ],
  rows: [
    ["研发", 120],
    ["市场", 45],
  ],
};

const grouped: TableModel = {
  columns: [
    column("组织", "hr.organization_name", false),
    column("1月", "hr.active_employee_count", true, "在职人数"),
    column("2月", "hr.active_employee_count", true, "在职人数"),
    column("1月", "hr.turnover_count", true, "离职人数"),
    column("2月", "hr.turnover_count", true, "离职人数"),
  ],
  rows: [["研发", 120, 122, 3, 4]],
};

const render = (model: TableModel, options: { allRows?: boolean; scene?: ViewScene } = {}) =>
  renderToStaticMarkup(
    <DataTable model={model} scene={options.scene ?? "card"} allRows={options.allRows ?? true} />,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;
const countTag = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;

test("单层表头：每列一个 th，数值列头与体都右对齐", () => {
  const html = render(flat);
  expect(countTag("<thead><th>a</th><th>b</th></thead>", "th")).toBe(2);
  expect(countTag(html, "th")).toBe(2);
  expect(html).toContain("组织");
  expect(html).toContain("在职人数");
  expect(count(html, "text-right")).toBe(flat.rows.length + 1);
  expect(count(html, "flex-row-reverse")).toBe(1);
});

test("换模型后旧排序列必须仍指向同一语义列才保留", () => {
  const active = {
    column: 1,
    columnKey: JSON.stringify([
      flat.columns[1].formatKey,
      flat.columns[1].headerPath.map(({ key }) => key),
    ]),
    dir: 1 as const,
  };
  expect(resolveTableSort(active, flat.columns)).toEqual(active);
  expect(resolveTableSort(active, flat.columns.slice(0, 1))).toBeNull();
  expect(
    resolveTableSort(active, [flat.columns[0], column("离职人数", "hr.turnover_count", true)]),
  ).toBeNull();
});

test("表体语言：明细常规字重、空值出破折号、文本列带截断上限", () => {
  const withNull: TableModel = {
    columns: flat.columns,
    rows: [
      ["研发", 120],
      [null, null],
    ],
  };
  const html = render(withNull);
  expect(count(html, "font-normal")).toBeGreaterThanOrEqual(4);
  expect(html).not.toContain("font-bold");
  expect(html).not.toContain("font-semibold");
  expect(count(html, "—")).toBe(2);
  expect(html).toContain('class="text-pa-faint">—');
  expect(count(html, 'class="truncate" style="max-width:')).toBe(1);
});

test("两层表头：分组行 colSpan 覆盖组宽，独立列 rowSpan 跨两行", () => {
  const html = render(grouped);
  expect(html).toContain('colSpan="2"');
  expect(html).toContain('rowSpan="2"');
  expect(countTag(html, "th")).toBe(3 + 4);
  expect(count(html, ">组织<")).toBe(1);
});

test("三层表头：按完整路径逐层合并，行轴表头跨越全部层级", () => {
  const threeLevels: TableModel = {
    columns: [
      column("组织", "hr.organization_name", false),
      {
        ...column("实际", "hr.active_employee_count", true),
        headerPath: [
          { key: "year:2025", label: "2025" },
          { key: "metric:active_employee_count", label: "在职人数" },
          { key: "scenario:actual", label: "实际" },
        ],
      },
      {
        ...column("计划", "hr.active_employee_count", true),
        headerPath: [
          { key: "year:2025", label: "2025" },
          { key: "metric:active_employee_count", label: "在职人数" },
          { key: "scenario:plan", label: "计划" },
        ],
      },
      {
        ...column("实际", "hr.turnover_rate", true),
        headerPath: [
          { key: "year:2025", label: "2025" },
          { key: "metric:turnover_rate", label: "离职率" },
          { key: "scenario:actual", label: "实际" },
        ],
      },
    ],
    rows: [["研发", 120, 125, 0.04]],
  };
  const html = render(threeLevels);
  expect(countTag(html, "th")).toBe(7);
  expect(html).toContain('colSpan="3"');
  expect(html).toContain('colSpan="2"');
  expect(html).toContain('rowSpan="3"');
});

test("独立组含多列（组织维度带父级列）：每列各自跨两行，表头与表体列数对齐", () => {
  const twoLabelCols: TableModel = {
    columns: [
      column("组织", "hr.organization_name", false),
      column("部门", "hr.department_name", false),
      column("2025", "hr.ytd_rate", true, "YTD事件率"),
      column("2026", "hr.ytd_rate", true, "YTD事件率"),
      column("2025", "hr.turnover_count", true, "离职人数"),
      column("2026", "hr.turnover_count", true, "离职人数"),
    ],
    rows: [["Aurora Labs", "Product", 0.5, 0.4, 3, 4]],
  };
  const html = render(twoLabelCols);
  expect(countTag(html, "th")).toBe(4 + 4);
  expect(count(html, 'rowSpan="2"')).toBe(2);
  expect(count(html, ">组织<")).toBe(1);
  expect(count(html, ">部门<")).toBe(1);
});

test("组首列的左分隔线贯穿表体：组边界由 formatKey 变化推出，只画在组的第一列上", () => {
  const html = render(grouped);
  const bands = new Set(grouped.columns.filter((c) => c.numeric).map((c) => c.headerPath[0]?.key));
  expect(bands.size).toBe(2);
  expect(count(html, "border-l-pa-line")).toBe(bands.size * (2 + grouped.rows.length));
  expect(render(flat)).not.toContain("border-l");
});

test("组标签偶然同名不并带：组边界认 formatKey，不认标签相等", () => {
  const collide: TableModel = {
    columns: [
      column("组织", "hr.organization_name", false),
      column("2025", "hr.rate_a", true, "离职率"),
      column("2026", "hr.rate_a", true, "离职率"),
      column("2025", "hr.rate_b", true, "离职率"),
      column("2026", "hr.rate_b", true, "离职率"),
    ],
    rows: [["研发", 0.1, 0.2, 0.3, 0.4]],
  };
  const html = render(collide);
  expect(count(html, 'colSpan="2"')).toBe(2);
  expect(count(html, "border-l-pa-line")).toBe(2 * (2 + collide.rows.length));
});

test("记录格按 sourceRows 回指原始结果行；无来源的空格不出记录入口", () => {
  const pivot: TableModel = {
    columns: [
      column("组织", "hr.organization_name", false),
      column("2025", "hr.active_employee_count", true),
      column("2026", "hr.active_employee_count", true),
    ],
    rows: [
      ["研发", 120, 130],
      ["市场", null, 45],
    ],
    sourceRows: [
      [null, 2, 0],
      [null, null, 1],
    ],
  };
  const asked: [number, number][] = [];
  const html = renderToStaticMarkup(
    <DataTable
      model={pivot}
      scene="card"
      allRows
      canOpenCell={(row, column) => {
        asked.push([row, column]);
        return true;
      }}
    />,
  );
  expect(countTag(html, "button")).toBe(3 + 3);
  const recordCells = html.match(/<button aria-label="查看明细[^>]*/g) ?? [];
  expect(recordCells).toHaveLength(3);
  for (const cell of recordCells) {
    expect(cell).toContain("hover:text-pa-accent");
    expect(cell.replace(/(hover|focus-visible):\S+/g, "")).not.toContain("text-pa-accent");
  }
  const sortHeads = html.match(/<button type="button" title="[^>]*/g) ?? [];
  expect(sortHeads).toHaveLength(3);
  for (const head of sortHeads) {
    expect(head).toContain("bg-transparent");
    expect(head).toContain("hover:bg-pa-surface");
    expect(head).toContain("text-pa-muted");
    expect(head).not.toContain("pa-accent");
  }
  expect(asked).toEqual([
    [2, 1],
    [0, 2],
    [1, 2],
  ]);
});

test("可点性由列决定：零值照样出记录入口，空格没有数字可点", () => {
  const withZero: TableModel = {
    columns: [
      column("组织", "hr.organization_name", false),
      column("事件数", "example.event_count", true),
      column("平均周期", "example.average_duration", true),
    ],
    rows: [
      ["研发", 0, 3.4],
      ["市场", 12, null],
    ],
  };
  const html = renderToStaticMarkup(
    <DataTable
      model={withZero}
      scene="card"
      allRows
      canOpenCell={(_row, column) => column === 1}
    />,
  );
  const recordCells = html.match(/<button aria-label="查看明细[^>]*/g) ?? [];
  expect(recordCells).toHaveLength(2);
  expect(recordCells[0]).toContain("事件数 0");
  expect(html).not.toContain("平均周期 ");
});

test("无 sourceRows 的长表：记录投影行号即模型行序", () => {
  const asked: number[] = [];
  renderToStaticMarkup(
    <DataTable
      model={flat}
      scene="card"
      allRows
      canOpenCell={(row) => {
        asked.push(row);
        return true;
      }}
    />,
  );
  expect(asked).toEqual([0, 1]);
});

test("行数条常驻：全量陈述总行数，截行时陈述已显示行数", () => {
  expect(render(flat)).toContain(`共 ${flat.rows.length} 行`);
  const many: TableModel = {
    columns: flat.columns,
    rows: Array.from({ length: INLINE_ROWS + 5 }, (_, i) => [`组织${i}`, i]),
  };
  expect(render(many, { allRows: false })).toContain(
    `已显示前 ${INLINE_ROWS} 行 · 共 ${many.rows.length} 行`,
  );
});

test("总体成带吸在表头下沿，不计入明细行数与记录投影", () => {
  const asked: number[] = [];
  const html = renderToStaticMarkup(
    <DataTable
      model={{ ...flat, summaryRows: [["总体", 165]] }}
      scene="page"
      allRows
      canOpenCell={(row) => {
        asked.push(row);
        return true;
      }}
    />,
  );
  const band = html.match(/<tbody aria-label="总体"[\s\S]*?<\/tbody>/)?.[0] ?? "";
  expect(band).not.toBe("");
  expect(html.indexOf(band)).toBeLessThan(html.indexOf("研发"));
  expect(band).toContain("border-b-pa-line");
  expect(band).not.toContain("border-b-2");
  expect(html.slice(html.indexOf(band) + band.length)).toContain("border-pa-line border-b");
  expect(band).toContain("border-b-pa-line");
  expect(html).toContain("<button");
  expect(band).not.toContain("<button");
  expect(html).toContain("总体");
  expect(asked).toEqual([0, 1]);
});

test("字色分两档：维度格取 muted，数值格与总体行取本色", () => {
  const html = renderToStaticMarkup(
    <DataTable model={{ ...flat, summaryRows: [["总体", 165]] }} scene="card" allRows />,
  );
  const cellOf = (text: string) =>
    html.match(new RegExp(`<td[^>]*>(?:(?!</td>).)*?${text}`))?.[0] ?? "";
  expect(cellOf("研发")).toContain("text-pa-muted");
  expect(cellOf("120")).not.toContain("text-pa-muted");
  expect(cellOf("总体")).not.toContain("text-pa-muted");
});

test("表尾不封口：末行不留行线，下边界由行数条交代", () => {
  const html = render(flat, { allRows: true });
  const body = html.match(/<tbody class="[^"]*">[\s\S]*$/)?.[0] ?? "";
  expect(body).toContain("[&amp;&gt;tr:last-child&gt;td]:border-b-0");
  expect(body).toContain("border-pa-line border-b");
});

test("总体带不吸顶时不占位：非 fill 表格无 sticky 与偏移", () => {
  const html = renderToStaticMarkup(
    <DataTable model={{ ...flat, summaryRows: [["总体", 165]] }} scene="card" allRows />,
  );
  const band = html.match(/<tbody aria-label="总体"[\s\S]*?<\/tbody>/)?.[0] ?? "";
  expect(html.match(/<tbody aria-label="总体"[^>]*>/)?.[0]).not.toContain("sticky");
  expect(band).not.toContain("top:");
  const valueCell = band.match(/<td class="([^"]*)"[^>]*>165/)?.[1] ?? "";
  expect(valueCell, "总体值格没匹配到——选择器过期").not.toBe("");
  expect(valueCell).toContain("font-medium");
  expect(valueCell).toContain("bg-pa-bg");
});

test("非全屏截断到 INLINE_ROWS，全屏渲染全部行", () => {
  const many: TableModel = {
    columns: flat.columns,
    rows: Array.from({ length: INLINE_ROWS + 5 }, (_, i) => [`组织${i}`, i]),
  };
  expect(countTag(render(many, { allRows: false }), "tr")).toBe(1 + INLINE_ROWS);
  expect(countTag(render(many, { allRows: true }), "tr")).toBe(1 + many.rows.length);
});

test("fill 时表格自带内滚且表头吸顶；非 fill 时都不挂", () => {
  const head = (html: string) => html.match(/<thead class="[^"]*"/)?.[0] ?? "";
  const filled = render(flat, { scene: "page" });
  expect(filled).toContain("overflow-auto");
  expect(head(filled)).toContain("sticky");

  const plain = render(flat, { scene: "card" });
  expect(plain).not.toContain("overflow-auto");
  expect(head(plain)).not.toContain("sticky");
});

test("右缘渐隐只在可横向滚动时显示", () => {
  expect(render(flat, { scene: "page" })).not.toContain("bg-linear-to-r");
  expect(render(flat, { scene: "card" })).not.toContain("bg-linear-to-r");
});

test("坐标列横向冻结：首列是维度才冻，数值打头的表不冻", () => {
  const html = render(flat, { scene: "page" });
  const cells = [...html.matchAll(/<t[dh] class="([^"]*)"/g)].map((match) => match[1]);
  expect(cells.filter((cls) => cls.includes("sticky left-0")).length).toBe(1 + flat.rows.length);
  const frozen = cells.find((cls) => cls.includes("sticky left-0")) ?? "";
  expect(frozen).toContain("bg-pa-bg");
  expect(frozen).toContain("group-hover:bg-pa-wash-solid");

  const numericFirst = renderToStaticMarkup(
    <DataTable
      scene="page"
      allRows
      model={{
        columns: [flat.columns[1], flat.columns[0]],
        rows: flat.rows.map(([name, value]) => [value, name]),
      }}
    />,
  );
  expect(numericFirst).not.toContain("sticky left-0");
});

const SPACING_CLASS = /^(?:p|px|py|pt|pb|pl|pr|h|min-h|max-h)-/;
const nonSpacing = (className: string) =>
  className
    .split(/\s+/)
    .filter((name) => name && !SPACING_CLASS.test(name))
    .sort();

const renderDensity = (scene: ViewScene) =>
  renderToStaticMarkup(
    <DataTable allRows model={{ ...flat, summaryRows: [["总体", 165]] }} scene={scene} />,
  );

const classOf = (html: string, pattern: RegExp) => html.match(pattern)?.[1] ?? "";

test("瓦片密度档只改内衬：字级、线色、底色三样与默认档同值", () => {
  expect(nonSpacing("px-2 py-1.5 text-sm border-pa-line-subtle"), "spacing filter is stale") //
    .toEqual(["border-pa-line-subtle", "text-sm"]);
  expect(
    nonSpacing("px-2 py-1.5 border-pa-line-subtle/80"),
    "spacing filter would pass a re-tinted row line",
  ).not.toEqual(nonSpacing("px-2.5 py-2 border-pa-line-subtle"));

  const tile = renderDensity("tile");
  const wide = renderDensity("page");
  const sites: Array<[string, RegExp]> = [
    ["表头格", /<th class="([^"]*)"/],
    ["总体格", /aria-label="总体"[\s\S]*?<td class="([^"]*)"/],
    ["明细格", /<td class="([^"]*)"[^>]*><div[^>]*>研发/],
  ];
  for (const [site, pattern] of sites) {
    const a = classOf(tile, pattern);
    const b = classOf(wide, pattern);
    expect(a, `${site} 没匹配到——选择器过期`).not.toBe("");
    expect(nonSpacing(a), `瓦片档的${site}写成 "${a}"，默认档是 "${b}"——密度只许由内衬分`).toEqual(
      nonSpacing(b),
    );
  }
});

test("吸顶的带铺实体底：表头与总体格都取卡面/带底色，不留透明", () => {
  for (const scene of ["tile", "page"] as const) {
    const html = renderDensity(scene);
    expect(classOf(html, /<th class="([^"]*)"/), `${scene} 表头透明会让明细透出来`) //
      .toContain("bg-pa-bg");
    expect(html).toContain('aria-label="总体" class="sticky z-10 bg-pa-bg"');
    expect(classOf(html, /aria-label="总体"[\s\S]*?<td class="([^"]*)"/)).toContain("bg-pa-bg");
  }
});

test("行数条不另立字级：两档同为 text-xs，差别只在高度与字色", () => {
  const bar = (html: string) =>
    html.match(/<div class="(flex shrink-0 items-center justify-end[^"]*)"/)?.[1] ?? "";
  const tile = bar(renderDensity("tile"));
  const wide = bar(renderDensity("card"));
  expect(tile, "行数条没匹配到——选择器过期").not.toBe("");
  expect(tile).toContain("text-xs");
  expect(wide).toContain("text-xs");
  expect(tile).not.toContain("text-2xs");
});
