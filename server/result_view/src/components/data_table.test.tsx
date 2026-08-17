/**
 * 表格渲染单测：TableModel → DOM 结构。shape 层已充分验证"该产出什么模型"，
 * 这里验证"模型摆成了什么"：两层表头的 rowSpan/colSpan/组边框无法仅由 shape 测试覆盖，
 * 错位时通常只能在最终 DOM 结构中发现。
 * renderToStaticMarkup 直渲，不引 DOM：本文件断言的都是一次渲染的产物，不涉及交互。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, INLINE_ROWS } from "./data_table.js";
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

/** 两层表头：无组的列（分类列）跨两行，带组的值列按指标名并带、组内是时间点。 */
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

const render = (model: TableModel, options: { fullscreen?: boolean; fill?: boolean } = {}) =>
  renderToStaticMarkup(
    <DataTable
      model={model}
      fullscreen={options.fullscreen ?? true}
      fill={options.fill ?? false}
    />,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** 数标签用正则：朴素 indexOf 数 "<th" 会把 "<thead" 也算进去。 */
const countTag = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;

test("单层表头：每列一个 th，数值列头与体都右对齐", () => {
  const html = render(flat);
  expect(countTag("<thead><th>a</th><th>b</th></thead>", "th")).toBe(2);
  expect(countTag(html, "th")).toBe(2);
  expect(html).toContain("组织");
  expect(html).toContain("在职人数");
  // 数值列右对齐：表体每行一处 + 数值列头一处；分类列不加
  expect(count(html, "text-right")).toBe(flat.rows.length + 1);
  // 右对齐列的排序 Chevron 反位到文字左侧：仅数值列头
  expect(count(html, "flex-row-reverse")).toBe(1);
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
  // 明细恒为 400；数据网格靠 tabular-nums 与行距立密度，不靠把所有值加粗。
  expect(count(html, "font-normal")).toBeGreaterThanOrEqual(4);
  expect(html).not.toContain("font-bold");
  expect(html).not.toContain("font-semibold");
  // 空值的写法见 ui_spec「结果网格」
  expect(count(html, "—")).toBe(2);
  expect(html).toContain('class="text-pa-faint">—');
  // 文本列内容包在截断包装里，数值列裸渲染；空格没有内容可截，不进包装
  expect(count(html, "max-w-[780px]")).toBe(1);
});

test("两层表头：分组行 colSpan 覆盖组宽，独立列 rowSpan 跨两行", () => {
  const html = render(grouped);
  expect(html).toContain('colSpan="2"');
  expect(html).toContain('rowSpan="2"');
  // 上行 3 个 th（独立列 + 两个指标组），下行 4 个（组内列，独立列已跨行）
  expect(countTag(html, "th")).toBe(3 + 4);
  // 独立列只出现一次，确保表头与表体列数一致。
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
  // 上行 4 个 th（两个独立列各自跨两行 + 两个指标组），下行 4 个（组内年份列）
  expect(countTag(html, "th")).toBe(4 + 4);
  expect(count(html, 'rowSpan="2"')).toBe(2);
  expect(count(html, ">组织<")).toBe(1);
  expect(count(html, ">部门<")).toBe(1);
});

test("组首列的左分隔线贯穿表体：组边界由 formatKey 变化推出，只画在组的第一列上", () => {
  const html = render(grouped);
  const bands = new Set(grouped.columns.filter((c) => c.numeric).map((c) => c.headerPath[0]?.key));
  expect(bands.size).toBe(2);
  // 每个组首画三处：分组标签 th、组内首列 th、表体每行首格——三段连起来才是贯穿的组边界线
  expect(count(html, "border-l-pa-line")).toBe(bands.size * (2 + grouped.rows.length));
  // 单层表没有「组」可分，逐列画就成了网格
  expect(render(flat)).not.toContain("border-l");
});

test("组标签偶然同名不并带：组边界认 formatKey，不认标签相等", () => {
  // 两个不同指标恰好同标题（模型标题撞车）：结构上仍是两组，各画各的分隔线
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
      fullscreen
      fill={false}
      canOpenCell={(row, column) => {
        asked.push([row, column]);
        return true;
      }}
    />,
  );
  // 3 个表头排序钮 + 3 个有来源的值格记录入口；(市场, 2025) 无来源不问也不出钮
  expect(countTag(html, "button")).toBe(3 + 3);
  // 记录可点性只在悬停/聚焦时现形：静息态染色会让同列数字一半蓝一半黑，被读成值有名堂。
  const recordCells = html.match(/<button aria-label="查看明细[^>]*/g) ?? [];
  expect(recordCells).toHaveLength(3);
  for (const cell of recordCells) {
    expect(cell).toContain("hover:text-pa-accent");
    expect(cell.replace(/(hover|focus-visible):\S+/g, "")).not.toContain("text-pa-accent");
  }
  // 排序钮是 chrome：静息透明，hover/激活才显中性底；染蓝会与记录入口抢信号。
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
      fullscreen
      fill={false}
      // 平均周期无记录明细绑定；事件数有——判据只看列，不看格里的数
      canOpenCell={(_row, column) => column === 1}
    />,
  );
  const recordCells = html.match(/<button aria-label="查看明细[^>]*/g) ?? [];
  // 事件数两格全可点（0 也可点：空记录是对零值的诚实回答）；平均周期整列不可点
  expect(recordCells).toHaveLength(2);
  expect(recordCells[0]).toContain("事件数 0");
  // 空值格连数字都没有，钮无从谈起
  expect(html).not.toContain("平均周期 ");
});

test("无 sourceRows 的长表：记录投影行号即模型行序", () => {
  const asked: number[] = [];
  renderToStaticMarkup(
    <DataTable
      model={flat}
      fullscreen
      fill={false}
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
  expect(render(many, { fullscreen: false })).toContain(
    `已显示前 ${INLINE_ROWS} 行 · 共 ${many.rows.length} 行`,
  );
  // 名单等按人计数的调用方可覆盖总量文案
  const custom = renderToStaticMarkup(
    <DataTable model={flat} fullscreen fill={false} countLabel="共 2 人" />,
  );
  expect(custom).toContain("共 2 人");
  expect(custom).not.toContain("共 2 行");
});

test("总体成带吸在表头下沿，不计入明细行数与记录投影", () => {
  const asked: number[] = [];
  const html = renderToStaticMarkup(
    <DataTable
      model={{ ...flat, summaryRows: [["总体", 165]] }}
      fullscreen
      fill
      canOpenCell={(row) => {
        asked.push(row);
        return true;
      }}
    />,
  );
  const band = html.match(/<tbody aria-label="总体"[\s\S]*?<\/tbody>/)?.[0] ?? "";
  expect(band).not.toBe("");
  // 总体带在明细之前：吸顶偏移只有排在表头之后、明细之前才成立
  expect(html.indexOf(band)).toBeLessThan(html.indexOf("研发"));
  expect(band).toContain("border-b-pa-line");
  expect(band).not.toContain("border-b-2");
  expect(html.slice(html.indexOf(band) + band.length)).toContain("border-pa-line border-b");
  // 总体格只用单边工具类：两个 border-color 落在同一元素上时胜者由样式表顺序决定
  expect(band).toContain("border-b-pa-line");
  // 总体是 chrome 不是明细：带内既不排序也不提供记录入口，一个钮都不该有
  expect(html).toContain("<button");
  expect(band).not.toContain("<button");
  expect(html).toContain("总体");
  expect(html).toContain("共 2 行");
  expect(asked).toEqual([0, 1]);
});

test("字色分两档：维度格取 muted，数值格与总体行取本色", () => {
  const html = renderToStaticMarkup(
    <DataTable model={{ ...flat, summaryRows: [["总体", 165]] }} fullscreen fill={false} />,
  );
  const cellOf = (text: string) =>
    html.match(new RegExp(`<td[^>]*>(?:(?!</td>).)*?${text}`))?.[0] ?? "";
  // 维度取值是坐标
  expect(cellOf("研发")).toContain("text-pa-muted");
  expect(cellOf("120")).not.toContain("text-pa-muted");
  // 总体行的标签标的是口径不是维度取值，跟着数走
  expect(cellOf("总体")).not.toContain("text-pa-muted");
});

test("表尾不封口：末行不留行线，下边界由行数条交代", () => {
  const html = render(flat, { fullscreen: true });
  const body = html.match(/<tbody class="[^"]*">[\s\S]*$/)?.[0] ?? "";
  expect(body).toContain("[&amp;&gt;tr:last-child&gt;td]:border-b-0");
  expect(body).toContain("border-pa-line border-b");
});

test("总体带不吸顶时不占位：非 fill 表格无 sticky 与偏移", () => {
  const html = renderToStaticMarkup(
    <DataTable model={{ ...flat, summaryRows: [["总体", 165]] }} fullscreen fill={false} />,
  );
  const band = html.match(/<tbody aria-label="总体"[\s\S]*?<\/tbody>/)?.[0] ?? "";
  // 吸顶与否只看带本身：格里的 sticky 是冻结的坐标列，与纵向无关
  expect(html.match(/<tbody aria-label="总体"[^>]*>/)?.[0]).not.toContain("sticky");
  expect(band).not.toContain("top:");
  // 合计与明细的分别只由字重交代：格底取卡面色，不给它专属色片
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
  expect(countTag(render(many, { fullscreen: false }), "tr")).toBe(1 + INLINE_ROWS);
  expect(countTag(render(many, { fullscreen: true }), "tr")).toBe(1 + many.rows.length);
});

test("fill 时表格自带内滚且表头吸顶；非 fill 时都不挂", () => {
  // 吸顶挂在 thead 上；格里的 sticky 是横向冻结的坐标列，两档都有，不参与这条判定
  const head = (html: string) => html.match(/<thead class="[^"]*"/)?.[0] ?? "";
  const filled = render(flat, { fill: true });
  expect(filled).toContain("overflow-auto");
  expect(head(filled)).toContain("sticky");

  const plain = render(flat, { fill: false });
  expect(plain).not.toContain("overflow-auto");
  expect(head(plain)).not.toContain("sticky");
});

test("右缘渐隐只在可横向滚动时显示", () => {
  // 恒亮的遮罩会被当成表格自己的一道浅边；服务端渲染时容器尺寸未知，此时一律不出
  expect(render(flat, { fill: true })).not.toContain("bg-linear-to-r");
  expect(render(flat, { fill: false })).not.toContain("bg-linear-to-r");
});

test("坐标列横向冻结：首列是维度才冻，数值打头的表不冻", () => {
  const html = render(flat, { fill: true });
  const cells = [...html.matchAll(/<t[dh] class="([^"]*)"/g)].map((match) => match[1]);
  // 表头、明细两处的首列都冻，其余列一个不冻
  expect(cells.filter((cls) => cls.includes("sticky left-0")).length).toBe(1 + flat.rows.length);
  // 冻结格必须实底，且行 hover 在它上面换成实色 wash，否则染色的行里会留白斑
  const frozen = cells.find((cls) => cls.includes("sticky left-0")) ?? "";
  expect(frozen).toContain("bg-pa-bg");
  expect(frozen).toContain("group-hover:bg-pa-wash-solid");

  const numericFirst = renderToStaticMarkup(
    <DataTable
      fill
      fullscreen
      model={{
        columns: [flat.columns[1], flat.columns[0]],
        rows: flat.rows.map(([name, value]) => [value, name]),
      }}
    />,
  );
  expect(numericFirst).not.toContain("sticky left-0");
});

/** 内衬与行高类：密度档只许动这些。 */
const SPACING_CLASS = /^(?:p|px|py|pt|pb|pl|pr|h|min-h|max-h)-/;
/** 一条 className 里非间距的部分——字级、线色、底色都落在这里。 */
const nonSpacing = (className: string) =>
  className
    .split(/\s+/)
    .filter((name) => name && !SPACING_CLASS.test(name))
    .sort();

const renderDensity = (tile: boolean) =>
  renderToStaticMarkup(
    <DataTable fill fullscreen model={{ ...flat, summaryRows: [["总体", 165]] }} tile={tile} />,
  );

const classOf = (html: string, pattern: RegExp) => html.match(pattern)?.[1] ?? "";

test("瓦片密度档只改内衬：字级、线色、底色三样与默认档同值", () => {
  expect(nonSpacing("px-2 py-1.5 text-sm border-pa-line-subtle"), "spacing filter is stale") //
    .toEqual(["border-pa-line-subtle", "text-sm"]);
  expect(
    nonSpacing("px-2 py-1.5 border-pa-line-subtle/80"),
    "spacing filter would pass a re-tinted row line",
  ).not.toEqual(nonSpacing("px-2.5 py-2 border-pa-line-subtle"));

  const tile = renderDensity(true);
  const wide = renderDensity(false);
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
  for (const tile of [true, false]) {
    const html = renderDensity(tile);
    expect(classOf(html, /<th class="([^"]*)"/), `tile=${tile} 表头透明会让明细透出来`) //
      .toContain("bg-pa-bg");
    // tbody 与每个 td 都铺卡面色：滚动内容不得从任一处透出
    expect(html).toContain('aria-label="总体" class="sticky z-10 bg-pa-bg"');
    expect(classOf(html, /aria-label="总体"[\s\S]*?<td class="([^"]*)"/)).toContain("bg-pa-bg");
  }
});

test("行数条不另立字级：两档同为 text-xs，差别只在高度与字色", () => {
  const bar = (html: string) => html.match(/<div class="(flex h-[^"]*)"/)?.[1] ?? "";
  const tile = bar(renderDensity(true));
  const wide = bar(renderDensity(false));
  expect(tile, "行数条没匹配到——选择器过期").not.toBe("");
  expect(tile).toContain("text-xs");
  expect(wide).toContain("text-xs");
  expect(tile).not.toContain("text-2xs");
});
