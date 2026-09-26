import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PageFooterBand,
  ViewPageFooter,
  ViewRenderer,
  type ViewRendererProps,
} from "./view_renderer.js";
import { VIEW_SCENES } from "../scene.js";
import { compilePresentationBlock } from "../../../src/presentation_core/chart_config.js";
import type { QueryPayload, ViewBlock } from "../../../src/semantic_core/query_payload.js";

const NO_ACTIONS = {};
const TABLE_DECL = { type: "table" as const };
const KPI_DECL = { type: "kpi" as const };

function view(overrides: Partial<ViewBlock> = {}): ViewBlock {
  const columns = overrides.columns ?? ["hr.organization_name", "hr.active_employee_count"];
  const columnRoles = Object.fromEntries(
    columns.map((column) => [
      column,
      column.endsWith("organization_name") ? "dimension" : "measure",
    ]),
  ) as ViewBlock["column_roles"];
  return {
    columns,
    column_roles: columnRoles,
    rows: [
      ["研发", 120],
      ["市场", 45],
    ],
    row_count: 2,
    query_notes: [],
    ...overrides,
    id: overrides.id ?? "result",
  };
}

function payload(overrides: Partial<QueryPayload> = {}): QueryPayload {
  return {
    title: "各组织在职人数",
    view: view(),
    observation_scopes: ["口径：在职含试用期"],
    data_as_of: "2026-06-30",
    time_context: [],
    ...overrides,
  };
}

const render = (props: Partial<ViewRendererProps> & { payload?: QueryPayload }) => {
  const renderedPayload = props.payload ?? payload();
  return renderToStaticMarkup(
    <ViewRenderer
      payload={renderedPayload}
      presentation={
        props.presentation ?? compilePresentationBlock(renderedPayload.view, TABLE_DECL)
      }
      actions={NO_ACTIONS}
      scene="card"
      {...props}
    />,
  );
};

/** 去掉 HTML 标签和多余空白，只保留可读文本。 */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 表体各单元格的文本（去掉单元格内的包装标签），用于比较数据内容。 */
const cells = (html: string) => {
  const body = html.slice(html.indexOf("<tbody"));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));
};

test("三个宿主场景的显示设置各不相同，均来自 VIEW_SCENES", () => {
  const shapes = Object.values(VIEW_SCENES).map(
    (t) => `${t.title}${t.scopeBand}${t.inlineChrome}${t.cellPad}`,
  );
  expect(new Set(shapes).size).toBe(3);
});

test("结果卡和瓦片渲染同一份结果时，单元格内容一致，只有外围元素不同", () => {
  const same = payload();
  const card = render({ payload: same, scene: "card" });
  const tile = render({ payload: same, scene: "tile" });

  expect(cells(card)).toEqual(["研发", "120", "市场", "45"]);
  expect(cells(tile)).toEqual(cells(card));

  // 结果卡显示标题和口径说明栏，瓦片不显示
  expect(text(card)).toContain("各组织在职人数");
  expect(text(card)).toContain("口径：在职含试用期");
  expect(text(tile)).not.toContain("各组织在职人数");
  expect(text(tile)).not.toContain("口径：在职含试用期");
});

test("整页场景的单元格与结果卡一致；标题由页头显示，行数和数据截至时间由页面底栏显示", () => {
  const same = payload();
  const page = render({ payload: same, scene: "page" });
  expect(cells(page)).toEqual(cells(render({ payload: same, scene: "card" })));
  expect(text(page)).not.toContain("各组织在职人数");
  expect(text(page)).not.toContain("共 2 行");
  expect(text(page)).not.toContain("数据截至");
  expect(text(page)).not.toContain("口径：在职含试用期");
  expect(page).not.toContain(VIEW_SCENES.page.countBar);
  // fill 场景高度取容器高度，表格内部滚动
  expect(page).toContain("overflow-auto");
});

test("瓦片不显示标题栏和口径说明栏，数据内容不受影响", () => {
  const card = render({ scene: "card" });
  const tile = render({ scene: "tile" });
  expect(cells(tile)).toEqual(cells(card));
  // 结果卡显示标题和数据截至时间，瓦片由自己的标题栏显示
  expect(text(card)).toContain("数据截至");
  expect(text(tile)).not.toContain("数据截至");
  // 行数栏属于表格，两种场景都显示
  expect(text(card)).toContain("共 2 行");
  expect(text(tile)).toContain("共 2 行");
});

test("fill 只改变布局，不改变内容：表格改为内部滚动", () => {
  const fixed = render({ scene: "card", allRows: true });
  const filled = render({ scene: "tile" });
  expect(cells(filled)).toEqual(cells(fixed));
  expect(filled).toContain("overflow-auto");
  expect(fixed).not.toContain("overflow-auto");
});

test("只有一个结果时直接显示，不显示结果切换导航", () => {
  const html = render({ payload: payload({ view: view({ view_title: "在职" }) }) });
  expect(html).not.toContain('role="tablist"');
  expect(cells(html)).toEqual(["研发", "120", "市场", "45"]);
});

/** 指标卡标签的 className（见 kpis.tsx），用于定位标签，避免与页面上其他灰色文字混淆 */
const KPI_LABEL = "mb-2 text-pa-muted text-xs leading-4";

test("指标卡：数值水平垂直居中；单个指标不显示标签，多个指标时标签在数值上方", () => {
  const kpiView = (columns: string[], row: (number | null)[]) =>
    view({ columns, rows: [row], row_count: 1 });
  const singlePayload = payload({ view: kpiView(["hr.active_employee_count"], [120]) });
  const single = render({
    payload: singlePayload,
    presentation: compilePresentationBlock(singlePayload.view, KPI_DECL),
    scene: "tile",
  });
  // 数值字号按容器宽度分档（用容器查询，不内联 style），使用等宽数字，宽度由父容器均分
  expect(single).toContain("@container");
  expect(single).toContain("flex-1");
  expect(single).toContain("text-[24px]");
  expect(single).toContain("@sm:text-[48px]");
  expect(single).toContain("tabular-nums");
  expect(single).not.toContain("font-size:");
  // 单个指标不显示标签（标题由容器显示）
  expect(single).not.toContain(KPI_LABEL);

  const multiPayload = payload({
    view: kpiView(["hr.active_employee_count", "hr.new_hire_count"], [120, 45]),
  });
  const multi = render({
    payload: multiPayload,
    presentation: compilePresentationBlock(multiPayload.view, KPI_DECL),
    scene: "tile",
  });
  expect(multi).toContain(KPI_LABEL);
  expect(multi.indexOf(KPI_LABEL)).toBeLessThan(multi.indexOf("120"));
});

test("页面底栏不属于结果内容：任何场景都不渲染它，行数和时间栏由宿主放在底栏里", () => {
  const leading = <span data-testid="time-bar-probe">时间栏占位</span>;
  // 三个场景的结果内容都不包含底栏，也不渲染时间栏
  for (const scene of ["card", "tile", "page"] as const) {
    expect(render({ scene })).not.toContain("time-bar-probe");
  }
  const footer = renderToStaticMarkup(
    <ViewPageFooter
      actions={NO_ACTIONS}
      leading={leading}
      payload={payload()}
      presentation={compilePresentationBlock(payload().view, TABLE_DECL)}
    />,
  );
  expect(footer).toContain("time-bar-probe");
  const footerText = footer.replace(/<[^>]*>/g, " ");
  expect(footerText).toContain("共 2 行");
  // 数据截至时间由时间栏的 Tooltip 显示；底栏紧挨时间栏，两处都显示时间容易让人以为不一致
  expect(footerText).not.toContain("数据截至");
});

test("底栏外框可以单独渲染：没有结果时宿主用它放置时间栏，尺寸与有结果时的底栏一致", () => {
  const html = renderToStaticMarkup(
    <PageFooterBand leading={<span data-testid="time-bar-probe">时间栏占位</span>} />,
  );
  expect(html).toContain("time-bar-probe");
  // 底栏占满宽度，不使用结果区域的内边距
  for (const cls of ["border-t", "py-3", "px-3"]) {
    expect(html).toContain(cls);
  }
  expect(html).not.toContain("px-4");
});

test("空状态和错误状态：固定高度的场景中垂直居中，按内容定高的场景中只加上下留白", () => {
  const empty = { rows: [], row_count: 0 };
  const filled = render({ payload: payload({ view: view(empty) }), scene: "tile" });
  const card = render({ payload: payload({ view: view(empty) }), scene: "card" });
  expect(text(filled), "缺少空状态提示文字").toContain("没有找到符合这些条件的数据");

  const box = (html: string) => html.match(/<div class="flex flex-col[^"]*"/)?.[0] ?? "";
  expect(box(filled), "瓦片中的空状态应垂直居中").toContain("justify-center");
  expect(box(filled)).toContain("flex-1");
  // 结果卡高度由内容决定，没有多余空间可以居中，只用 emptyPad 加留白
  expect(box(card), "结果卡中的空状态不应垂直居中").not.toContain("justify-center");
  expect(box(card)).toContain(VIEW_SCENES.card.emptyPad);
});

test("空结果不渲染空表格，只显示一句说明", () => {
  const html = render({ payload: payload({ view: view({ rows: [], row_count: 0 }) }) });
  expect(html).not.toContain("<tbody>");
  expect(text(html)).toContain("没有找到符合这些条件的数据");
});

/** 带整段合计和对照期的时间序列结果。 */
function totalsPayload(): QueryPayload {
  const columns = ["hr.year", "hr.month", "hr.turnover_count"];
  return payload({
    view: view({
      columns,
      column_roles: {
        "hr.year": "time",
        "hr.month": "time",
        "hr.turnover_count": "measure",
      },
      rows: [
        [2026, 1, 10],
        [2026, 2, 12],
      ],
      row_count: 2,
      time: {
        grain: "month",
        coordinates: [
          { role: "primary", from: "2026-01", to: "2026-02" },
          { role: "comparison", from: "2025-01", to: "2025-02" },
        ],
        buckets: [
          { key: { year: 2026, month: 1 }, from: "2026-01", to: "2026-01" },
          { key: { year: 2026, month: 2 }, from: "2026-02", to: "2026-02" },
        ],
      },
      totals: {
        metrics: [
          {
            column: "hr.turnover_count",
            periods: [
              { from: "2026-01", to: "2026-02", value: 22 },
              { from: "2025-01", to: "2025-02", value: 20 },
            ],
          },
        ],
      },
    }),
  });
}

test("图表和表格上方不显示整段合计，整段合计只在指标卡中显示", () => {
  const same = totalsPayload();
  const presentation = compilePresentationBlock(same.view, TABLE_DECL);
  const page = render({ payload: same, presentation, scene: "page" });
  const card = render({ payload: same, presentation, scene: "card" });
  const tile = render({ payload: same, presentation, scene: "tile" });

  // 三个场景都不显示整段合计；单元格数据保持一致
  for (const html of [page, card, tile]) {
    expect(text(html)).not.toContain("2026年1—2月");
    expect(text(html)).not.toContain("较2025年");
  }
  expect(cells(card)).toEqual(cells(page));
});

test("指标卡显示整段合计，而不是某一行的值", () => {
  const same = totalsPayload();
  const kpi = compilePresentationBlock(same.view, KPI_DECL);
  expect(kpi.type).toBe("kpi");
  const page = render({ payload: same, presentation: kpi, scene: "page" });
  // 显示的是整段合计而非最后一个月的值（12 不出现），期间和差值各只出现一次
  expect(text(page)).toContain("22");
  expect(text(page)).not.toContain("12");
  expect(text(page).match(/2026年1—2月/g)).toHaveLength(1);
});

test("空结果只显示空状态，不显示一排破折号", () => {
  const empty = totalsPayload();
  const emptyView = { ...empty.view, rows: [], row_count: 0 };
  const page = render({
    payload: { ...empty, view: emptyView },
    presentation: compilePresentationBlock(emptyView, TABLE_DECL),
    scene: "page",
  });
  expect(text(page)).toContain("没有找到符合这些条件的数据");
  expect(text(page)).not.toContain("2026年1—2月");
});

test("同一份数据声明为表格时不显示整段期间，声明为指标卡时才显示", () => {
  const columns = ["hr.active_employee_count"];
  const single = payload({
    view: view({
      columns,
      column_roles: { "hr.active_employee_count": "measure" },
      rows: [[19873]],
      row_count: 1,
      time: {
        grain: "total",
        coordinates: [{ role: "primary", from: "2026-08", to: "2026-08" }],
        buckets: [{ key: null, from: "2026-08", to: "2026-08" }],
      },
      totals: {
        metrics: [
          {
            column: "hr.active_employee_count",
            periods: [{ from: "2026-08", to: "2026-08", value: 19873 }],
          },
        ],
      },
    }),
  });
  const table = render({
    payload: single,
    presentation: compilePresentationBlock(single.view, TABLE_DECL),
    scene: "page",
  });
  expect(text(table)).not.toContain("2026年8月");
  expect(cells(table)).toEqual(["19,873"]);
  const kpi = render({
    payload: single,
    presentation: compilePresentationBlock(single.view, KPI_DECL),
    scene: "page",
  });
  expect(text(kpi)).toContain("2026年8月");
});

test("结果卡标题字号比正文大一档，字重为 medium 而非 semibold", () => {
  const title = render({ scene: "card" }).match(/<h2\s[^>]*>/)?.[0] ?? "";
  expect(title).toContain("text-base");
  expect(title).toContain("font-medium");
  expect(title).not.toContain("font-semibold");
});

/** 调用方标题与服务端生成的结构标题的组合：调用方标题作主标题，结构标题作副标题。 */
const structured = payload({
  view: view({
    columns: ["hr.job_level_band", "hr.active_employee_count"],
    column_roles: { "hr.job_level_band": "dimension", "hr.active_employee_count": "measure" },
    rows: [
      ["Band B", 40],
      ["Band C", 30],
    ],
  }),
});

test("有调用方标题时优先显示，结构标题作为副标题", () => {
  const html = render({ payload: { ...structured, title: "Aurora Labs 各职级人员结构" } });
  expect(html).toContain("<h2");
  expect(text(html)).toContain("Aurora Labs 各职级人员结构");
  expect(text(html)).toContain("active_employee_count · 按job_level_band · 数据截至");
});

test("没有调用方标题时用结构标题作主标题，不显示副标题", () => {
  const { title: _declared, ...untitled } = structured;
  const html = render({ payload: untitled });
  expect(html.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1]).toBe("active_employee_count · 按job_level_band");
  expect(text(html)).not.toContain("按job_level_band · 数据截至");
});

test("无法生成结构标题时使用通用标题，副标题只显示数据截至时间", () => {
  const bare = payload({
    view: view({ columns: ["hr.organization_name"], rows: [["研发"]], row_count: 1 }),
  });
  const { title: _declared, ...untitled } = bare;
  expect(text(render({ payload: untitled }))).toContain("查询结果");
  const declared = render({ payload: { ...bare, title: "组织清单" } });
  expect(declared.match(/<p class="mt-0\.5[^"]*">(.*?)<\/p>/)?.[1]).toBe("数据截至 2026-06-30");
});
