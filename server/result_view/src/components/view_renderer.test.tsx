/**
 * 统一渲染器单测：三个宿主场景（card / tile / page）与它们的呈现一致性。
 * 本文件守的不变量是"容器身份只改 chrome，不改数据"：三个宿主共用同一渲染器，
 * 本断言防止呈现产物随容器分叉。场景枚举既是入参也是断言口径——断言直接说 scene="tile"。
 * renderToStaticMarkup 直渲、不引 DOM：断言只覆盖一次渲染的产物，
 * 图/表切换、排序、悬浮层等需要真实 DOM，不在此处覆盖。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PageFooterBand,
  ViewPageFooter,
  ViewRenderer,
  VIEW_SCENES,
  type ViewRendererProps,
} from "./view_renderer.js";
import { compilePresentationBlock } from "../../../src/presentation_core/chart_config.js";
import type { QueryPayload, ViewBlock } from "../../../src/semantic_core/query_payload.js";

const NO_ACTIONS = {};

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
    default_population_scope: "口径：在职含试用期",
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
        props.presentation ??
        compilePresentationBlock(renderedPayload.view, { type: "table", y: [] })
      }
      actions={NO_ACTIONS}
      {...props}
    />,
  );
};

/** 去掉标签与空白，只留可读文本——比较两个容器时要比的是数据，不是 chrome。 */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 表体单元格的文本序列：数据内容的最小充分表示（剥掉截断包装等格内标签）。 */
const cells = (html: string) => {
  const body = html.slice(html.indexOf("<tbody"));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));
};

test("三个宿主场景各自的 chrome 取舍就是 VIEW_SCENES 表本身", () => {
  const shapes = Object.values(VIEW_SCENES).map(
    (t) => `${t.title}${t.scopeBand}${t.inlineChrome}${t.inlineToggle}`,
  );
  expect(new Set(shapes).size).toBe(3);
});

test("两个宿主渲染同一份载荷：数据内容逐格一致，差别只在 chrome", () => {
  const same = payload();
  const card = render({ payload: same, scene: "card" });
  const tile = render({ payload: same, scene: "tile" });

  expect(cells(card)).toEqual(["研发", "120", "市场", "45"]);
  expect(cells(tile)).toEqual(cells(card));

  // chrome 才是两者的差别：答数态挂标题与常驻口径带，概览态都不挂
  expect(text(card)).toContain("各组织在职人数");
  expect(text(card)).toContain("口径：在职含试用期");
  expect(text(tile)).not.toContain("各组织在职人数");
  expect(text(tile)).not.toContain("口径：在职含试用期");
});

test("查看面旗标：数据与答数态逐格一致；标题归页头，元信息归框外底栏", () => {
  const same = payload();
  const page = render({ payload: same, scene: "page" });
  expect(cells(page)).toEqual(cells(render({ payload: same, scene: "card" })));
  // 标题由查看面页头承载，内容栈只渲染数据区
  expect(text(page)).not.toContain("各组织在职人数");
  // 行数、新鲜度与图/表切换全部归底栏——它住在结果框之外，因而不在本组件版面
  expect(text(page)).not.toContain("共 2 行");
  expect(text(page)).not.toContain("数据截至");
  // 整页不挂口径带
  expect(text(page)).not.toContain("口径：在职含试用期");
  // 表格自身的行数条同样让位给底栏
  expect(page).not.toContain("flex h-[30px]");
  // fill：高度取容器，表格转为自带内滚
  expect(page).toContain("overflow-auto");
});

test("瓦片态不渲染标题带与口径带；两者都不吃掉数据", () => {
  const card = render({ scene: "card" });
  const tile = render({ scene: "tile" });
  expect(cells(tile)).toEqual(cells(card));
  // 答数态自带标题与新鲜度副行，概览态整条让位给瓦片题条
  expect(text(card)).toContain("数据截至");
  expect(text(tile)).not.toContain("数据截至");
  // 行数条属于表格内容而非 chrome：两种容器都陈述行数
  expect(text(card)).toContain("共 2 行");
  expect(text(tile)).toContain("共 2 行");
});

test("fill 只改布局类，不改内容：表格转为自带内滚", () => {
  const fixed = render({ scene: "card", fullscreen: true });
  const filled = render({ scene: "tile" });
  expect(cells(filled)).toEqual(cells(fixed));
  expect(filled).toContain("overflow-auto");
  expect(fixed).not.toContain("overflow-auto");
});

test("唯一结果直接铺开，不产生结果切换导航", () => {
  const html = render({ payload: payload({ view: view({ view_title: "在职" }) }) });
  expect(html).not.toContain('role="tablist"');
  expect(cells(html)).toEqual(["研发", "120", "市场", "45"]);
});

/** 指标卡标签块的类名签名（kpis.tsx）：位置断言据此定位，不与页面其他次级灰文字混淆 */
const KPI_LABEL = "mb-2 text-pa-muted text-xs leading-4";

test("KPI：双居中大数、单指标无标签、多指标标签在值上方", () => {
  const kpiView = (columns: string[], row: (number | null)[]) =>
    view({ columns, rows: [row], row_count: 1 });
  const singlePayload = payload({ view: kpiView(["hr.active_employee_count"], [120]) });
  const single = render({
    payload: singlePayload,
    presentation: compilePresentationBlock(singlePayload.view, { type: "kpi", y: [] }),
    scene: "tile",
  });
  // 值的排印签名：字号按容器分档（不量、不内联 style），等宽数字，格宽由父容器均分
  expect(single).toContain("@container");
  expect(single).toContain("flex-1");
  expect(single).toContain("text-[24px]");
  expect(single).toContain("@sm:text-[48px]");
  expect(single).toContain("tabular-nums");
  expect(single).not.toContain("font-size:");
  // 单指标不出标签（标题在容器题头）
  expect(single).not.toContain(KPI_LABEL);

  const multiPayload = payload({
    view: kpiView(["hr.active_employee_count", "hr.new_hire_count"], [120, 45]),
  });
  const multi = render({
    payload: multiPayload,
    presentation: compilePresentationBlock(multiPayload.view, { type: "kpi", y: [] }),
    scene: "tile",
  });
  expect(multi).toContain(KPI_LABEL);
  expect(multi.indexOf(KPI_LABEL)).toBeLessThan(multi.indexOf("120"));
});

test("底栏是页面 chrome：任何 scene 的内容栈都不渲染它，行数与时间栏都归宿主摆", () => {
  const leading = <span data-testid="time-bar-probe">时间栏占位</span>;
  // 内容栈没有底栏这个槽——三个场景一律不出行数陈述，也无从接住时间栏
  for (const scene of ["card", "tile", "page"] as const) {
    expect(render({ scene })).not.toContain("time-bar-probe");
  }
  const footer = renderToStaticMarkup(
    <ViewPageFooter
      actions={NO_ACTIONS}
      leading={leading}
      mode="chart"
      onModeChange={() => {}}
      payload={payload()}
      presentation={compilePresentationBlock(payload().view, { type: "table", y: [] })}
    />,
  );
  expect(footer).toContain("time-bar-probe");
  const footerText = footer.replace(/<[^>]*>/g, " ");
  expect(footerText).toContain("共 2 行");
  // 数据截至归时间栏的 Tooltip：底栏与常驻时间栏挨着，两处都报时间会被读成互相矛盾
  expect(footerText).not.toContain("数据截至");
});

test("底栏外壳可独立渲染：无结果的宿主态用它承接同一条时间栏，几何与真底栏一致", () => {
  const html = renderToStaticMarkup(
    <PageFooterBand leading={<span data-testid="time-bar-probe">时间栏占位</span>} />,
  );
  expect(html).toContain("time-bar-probe");
  // 底栏通栏，不吃结果框的 inset
  for (const cls of ["border-t", "py-3", "px-3"]) {
    expect(html).toContain(cls);
  }
  expect(html).not.toContain("px-4");
});

test("空态与错误态同规：给定高度的场景里居中，撑内容的场景里只给呼吸", () => {
  const empty = { rows: [], row_count: 0 };
  const filled = render({ payload: payload({ view: view(empty) }), scene: "tile" });
  const card = render({ payload: payload({ view: view(empty) }), scene: "card" });
  expect(text(filled), "空态那句话没了，下面几条落空").toContain("没有找到符合这些条件的数据");

  const box = (html: string) => html.match(/<div class="flex flex-col[^"]*"/)?.[0] ?? "";
  expect(box(filled), "瓦片的空态贴在了正文顶端").toContain("justify-center");
  expect(box(filled)).toContain("flex-1");
  // 答数卡高度由内容撑，没有可居中的余量：那一档靠 emptyPad 给呼吸
  expect(box(card), "答数卡里没有余量可居中，不该写 justify-center").not.toContain(
    "justify-center",
  );
  expect(box(card)).toContain(VIEW_SCENES.card.emptyPad);
});

test("空结果不出空表壳，给一句人话", () => {
  const html = render({ payload: payload({ view: view({ rows: [], row_count: 0 }) }) });
  expect(html).not.toContain("<tbody>");
  expect(text(html)).toContain("没有找到符合这些条件的数据");
});

/** 带整窗合计与对照的时间序列结果：整窗读数的完整素材。 */
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
              { from: "2026-01", to: "2026-02", value: 22, coverage: "window" },
              { from: "2025-01", to: "2025-02", value: 20, coverage: "window" },
            ],
          },
        ],
      },
    }),
  });
}

test("图与表之上不摆读数条：整窗合计只属于指标卡这一位", () => {
  const same = totalsPayload();
  const presentation = compilePresentationBlock(same.view, { type: "table", y: [] });
  const page = render({ payload: same, presentation, scene: "page" });
  const card = render({ payload: same, presentation, scene: "card" });
  const tile = render({ payload: same, presentation, scene: "tile" });

  // 三个宿主一致地不出整窗读数；同一份数据仍逐格在册，读数经悬停浮层给出
  for (const html of [page, card, tile]) {
    expect(text(html)).not.toContain("2026年1—2月");
    expect(text(html)).not.toContain("较2025年");
  }
  expect(cells(card)).toEqual(cells(page));
});

test("指标卡是整窗读数的唯一形态：大数读整窗合计而非某一行", () => {
  const same = totalsPayload();
  const kpi = compilePresentationBlock(same.view, { type: "kpi", y: [] });
  expect(kpi.type).toBe("kpi");
  const page = render({ payload: same, presentation: kpi, scene: "page" });
  // 大数读的是整窗合计而非某一行（末月 12 不出现），且期间与差值只出现一次
  expect(text(page)).toContain("22");
  expect(text(page)).not.toContain("12");
  expect(text(page).match(/2026年1—2月/g)).toHaveLength(1);
});

test("空结果的查看面只有空态：不摆一排破折号", () => {
  const empty = totalsPayload();
  const emptyView = { ...empty.view, rows: [], row_count: 0 };
  const page = render({
    payload: { ...empty, view: emptyView },
    presentation: compilePresentationBlock(emptyView, { type: "table", y: [] }),
    scene: "page",
  });
  expect(text(page)).toContain("没有找到符合这些条件的数据");
  expect(text(page)).not.toContain("2026年1—2月");
});

test("整窗读数随形态在场：同一份数据声明为表看不到期间，声明为指标卡才读得到", () => {
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
            periods: [{ from: "2026-08", to: "2026-08", value: 19873, coverage: "window" }],
          },
        ],
      },
    }),
  });
  const table = render({
    payload: single,
    presentation: compilePresentationBlock(single.view, { type: "table", y: [] }),
    scene: "page",
  });
  expect(text(table)).not.toContain("2026年8月");
  expect(cells(table)).toEqual(["19,873"]);
  const kpi = render({
    payload: single,
    presentation: compilePresentationBlock(single.view, { type: "kpi", y: [] }),
    scene: "page",
  });
  expect(text(kpi)).toContain("2026年8月");
});

/**
 * 图/表切换的宿主之一：查看面底栏。它渲染同一件分段控件却不带画布，
 * 因而不需要 DOM——读数条的版式断言另在 echart.test.tsx（那里才要主题存根）。
 */
function chartView(): ViewBlock {
  return view({
    columns: ["hr.organization_name", "hr.active_employee_count", "hr.new_hire_count"],
    column_roles: {
      "hr.organization_name": "dimension",
      "hr.active_employee_count": "measure",
      "hr.new_hire_count": "measure",
    },
    rows: [
      ["研发", 120, 12],
      ["市场", 45, 6],
    ],
    row_count: 2,
  });
}

const barChart = (source: ViewBlock) =>
  compilePresentationBlock(source, {
    type: "bar",
    x: "organization_name",
    y: ["active_employee_count", "new_hire_count"],
  });

function footerWithChart(mode: "chart" | "table"): string {
  const source = chartView();
  return renderToStaticMarkup(
    <ViewPageFooter
      actions={NO_ACTIONS}
      mode={mode}
      onModeChange={() => {}}
      payload={payload({ view: source })}
      presentation={barChart(source)}
    />,
  );
}

/**
 * 同一份带图结果落进三个场景。锁 `mode="table"` 是为了不引 DOM：
 * 出图那一路要问宿主主题（见 echart.test.tsx），而这里要看的是切换钮在不在，与出不出图无关。
 */
function sceneWithChart(scene: "card" | "tile" | "page"): string {
  const source = chartView();
  return renderToStaticMarkup(
    <ViewRenderer
      actions={NO_ACTIONS}
      mode="table"
      onModeChange={() => {}}
      payload={payload({ view: source })}
      presentation={barChart(source)}
      scene={scene}
    />,
  );
}

/** class 串里所有画面的类（含 hover 态）——分段控件的两条铁律都落在这一组上。 */
const paintedClasses = (tag: string) =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .split(/\s+/)
    .filter((name) => /^(?:hover:)?bg-/.test(name));

test("图/表切换是分段控件：选中面是一枚滑块，档位自己不画背景、hover 不铺面", () => {
  const html = footerWithChart("chart");
  expect([...html.matchAll(/data-slot="view-mode-slider"/g)], "全条只有一枚罩层").toHaveLength(1);

  const segments = [...html.matchAll(/<button[^>]*aria-pressed[^>]*>/g)].map((m) => m[0]);
  expect(segments.length, "分段控件没渲染出来，下面几条落空").toBe(2);
  for (const segment of segments) {
    // 档位本身自始至终不画任何背景：选中面归滑块，hover 只改字色
    expect(paintedClasses(segment), `档位自己铺了面：${segment}`).toEqual([]);
  }

  const table = footerWithChart("table");
  const segmentsOf = (page: string) =>
    [...page.matchAll(/<button[^>]*aria-pressed[^>]*>/g)].map((m) =>
      (m[0].match(/class="([^"]*)"/)?.[1] ?? "").replace(/\s+/g, " "),
    );
  expect(new Set(segmentsOf(table)).size, "两档段的类名不该有第三种取值").toBeLessThanOrEqual(2);
  expect(html).not.toContain("translateX(100%)");
  expect(table, "选中态换档后罩层没有移动").toContain("translateX(100%)");

  for (const sample of ['class="bg-pa-selected text-pa-fg"', 'class="hover:bg-pa-surface"']) {
    expect(paintedClasses(sample).length).toBeGreaterThan(0);
  }
});

test("切换钮住哪由场景定：只有答数卡留在中段，瓦片与整页交给框外的宿主 chrome", () => {
  const card = sceneWithChart("card");
  expect(card, "答数卡中段没有切换钮，它在这个场景里无处可去").toContain(
    'data-slot="view-mode-slider"',
  );

  for (const scene of ["tile", "page"] as const) {
    const html = sceneWithChart(scene);
    // 内容栈里不留常驻控件带：瓦片归题条动作槽、整页归页面底栏，两处都在结果框之外
    expect(html, `${scene} 的内容栈自己摆了切换钮`).not.toContain("view-mode-slider");
    expect(html, `${scene} 的内容栈自己摆了切换钮`).not.toContain("aria-pressed");
    expect(text(html), `${scene} 什么都没渲染出来`).toContain("研发");
  }

  expect(VIEW_SCENES.card.inlineToggle).toBe(true);
  expect(VIEW_SCENES.tile.inlineToggle).toBe(false);
  expect(VIEW_SCENES.page.inlineToggle).toBe(false);
});

test("答数态题名是这张卡的名字：字号高于正文一档、字重反而更轻", () => {
  const title = render({ scene: "card" }).match(/<h2\s[^>]*>/)?.[0] ?? "";
  expect(title).toContain("text-base");
  expect(title).toContain("font-medium");
  expect(title).not.toContain("font-semibold");
});
