import { expect, test } from "bun:test";
import type { Principal } from "../contracts/principal.js";
import type { CubeGateway, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import type { AnalysisSpec } from "../semantic_core/analysis_spec.js";
import { planExecution, type ExecutionPlan } from "../semantic_core/execution_plan.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { authorizeTestAnalysisPlan } from "../test_support/dashboard.js";
import { createQueryExecutionService } from "./query_execution_service.js";

const principal: Principal = {
  email: "viewer@example.com",
  roles: ["user"],
  orgScope: ["研发"],
};
const TABLE_PRESENTATION: PresentationSpec = {
  type: "table",
  y: [],
  tableLayout: { rows: [], columns: [] },
};

const publicView: CubeView = {
  name: "test_people_metrics",
  title: "人员总览",
  meta: {
    time_source: "workforce",
    default_population_scope: "测试人群口径。",
  },
  measures: [
    {
      name: "test_people_metrics.active_employee_count",
      title: "在职人数",
      type: "number",
      aggType: "count",
      meta: { time_contract: { aggregation: "last", window: "selected" } },
    },
    {
      name: "test_people_metrics.ytd_event_rate",
      title: "YTD事件率",
      type: "number",
      format: "percent",
      meta: { time_contract: { aggregation: "recompute", window: "year_to_date" } },
    },
    {
      name: "test_people_metrics.ytd_secondary_event_rate",
      title: "YTD次要事件率",
      type: "number",
      format: "percent",
      meta: { time_contract: { aggregation: "recompute", window: "year_to_date" } },
    },
    {
      name: "test_people_metrics.turnover_count",
      title: "离职人数",
      type: "number",
      aggType: "countDistinct",
      meta: { time_contract: { aggregation: "sum", window: "selected" } },
    },
  ],
  dimensions: [
    {
      name: "test_people_metrics.organization_name",
      title: "组织",
      type: "string",
    },
    {
      name: "test_people_metrics.category_level",
      title: "分类层级",
      type: "string",
    },
  ],
  internalMeasures: [
    {
      name: "test_people_metrics.raw_headcount",
      title: "基础在职人数",
      type: "number",
      aggType: "countDistinct",
      meta: {
        internal: true,
        time_contract: { aggregation: "last", window: "selected" },
      },
    },
  ],
  internalDimensions: [
    {
      name: "test_people_metrics.employee_name",
      title: "姓名",
      type: "string",
      meta: { internal: true, dimension_kind: "individual" },
    },
  ],
};

const timeContext = {
  dataAsOf: "2026-07",
  sources: {
    workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
  },
};

function planned(
  plan: ExecutionPlan,
  presentation: PresentationSpec = TABLE_PRESENTATION,
  views: CubeView[] = [publicView],
) {
  return authorizeTestAnalysisPlan({ principal, plan, presentation, views, timeContext });
}

test("Agent 指标域拒绝手写技术维度与计算辅助指标，且不会向 Cube 发起查询", async () => {
  let loads = 0;
  const cube = {
    meta: async () => [publicView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load: async () => {
      loads += 1;
      throw new Error("技术字段不应到达 Cube");
    },
    loadMulti: async () => {
      loads += 1;
      throw new Error("技术字段不应到达 Cube");
    },
  } as unknown as CubeGateway;
  const service = createQueryExecutionService({
    cube,
    exports: {
      createDelivery: async () => Promise.reject(new Error("不应导出")),
    },
  });
  for (const query of [
    {
      measures: ["test_people_metrics.active_employee_count"],
      dimensions: ["test_people_metrics.employee_name"],
    },
    {
      measures: ["test_people_metrics.raw_headcount"],
      dimensions: ["test_people_metrics.organization_name"],
    },
  ]) {
    const spec: AnalysisSpec = {
      views: [{ id: "result", ...query, time: { cutoff: "2026-07" } }],
    };
    await expect(service.execute(planned(planExecution(spec)))).rejects.toThrow(
      "所选字段不在当前可用的数据目录中",
    );
  }
  expect(loads).toBe(0);
});

test("交付边界把执行成员一次性投影为语义列与语义口径引用", async () => {
  const METRIC = "measure:active_employee_count";
  const DIMENSION = "dimension:organization_name";
  const PIVOT_DIMENSION = "dimension:category_level";
  const projectionView: CubeView = {
    ...publicView,
    dimensions: [...publicView.dimensions],
  };
  const cube = {
    meta: async () => [projectionView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load: async () => ({
      data: [
        {
          "test_people_metrics.organization_name": "研发",
          "test_people_metrics.category_level": "Band B",
          "test_people_metrics.active_employee_count": 12,
        },
      ],
      annotation: {
        measures: {
          "test_people_metrics.active_employee_count": {
            title: "在职人数",
            description: "月末在职人数。",
          },
        },
        dimensions: {
          "test_people_metrics.organization_name": {
            title: "组织",
            description: "公司一级组织。",
          },
          "test_people_metrics.category_level": {
            title: "分类层级",
            description: "记录所属的分类层级。",
          },
        },
      },
    }),
    loadMulti: async () => {
      throw new Error("单窗查询不应调用 loadMulti");
    },
  } as unknown as CubeGateway;
  const service = createQueryExecutionService({
    cube,
    exports: {
      createDelivery: async () => Promise.reject(new Error("不应导出")),
    },
  });
  const spec: AnalysisSpec = {
    views: [
      {
        id: "result",
        measures: ["test_people_metrics.active_employee_count"],
        dimensions: ["test_people_metrics.organization_name", "test_people_metrics.category_level"],
        time: { cutoff: "2026-07" },
      },
    ],
  };
  const plan = planExecution(spec, {
    delivery: {
      columns: {
        active_employee_count: METRIC,
        organization_name: DIMENSION,
        category_level: PIVOT_DIMENSION,
      },
    },
  });
  const result = await service.execute(
    planned(
      plan,
      {
        type: "table",
        y: [],
        tableLayout: {
          rows: [{ kind: "field", column: "test_people_metrics.organization_name" }],
          columns: [
            { kind: "field", column: "test_people_metrics.category_level" },
            { kind: "metrics" },
          ],
        },
      },
      [projectionView],
    ),
  );
  expect(result.payload.view.columns).toEqual([DIMENSION, PIVOT_DIMENSION, METRIC]);
  expect(result.decl).toEqual({
    type: "table",
    y: [],
    tableLayout: {
      rows: [{ kind: "field", column: DIMENSION }],
      columns: [{ kind: "field", column: PIVOT_DIMENSION }, { kind: "metrics" }],
    },
  });
  const noteMembers = result.payload.view.query_notes.map((note) => note.member);
  expect(noteMembers).toEqual(expect.arrayContaining([METRIC, DIMENSION]));
  expect(
    noteMembers.every(
      (member) =>
        member === METRIC ||
        member === DIMENSION ||
        member === PIVOT_DIMENSION ||
        /^notice:\d+$/.test(member),
    ),
  ).toBe(true);
  const publicIdentifiers = [...result.payload.view.columns, ...noteMembers];
  expect(publicIdentifiers).not.toContain("test_people_metrics.active_employee_count");
  expect(publicIdentifiers).not.toContain("test_people_metrics.organization_name");
  expect(publicIdentifiers).not.toContain("test_people_metrics.category_level");
});

test("分组 Top-N 按正式指标在最新逻辑时间桶排名，并保留选中分组的全部时间桶", async () => {
  const loads: Array<{ kind: "single" | "multi"; query: unknown }> = [];
  const annotation = {
    measures: {
      "test_people_metrics.active_employee_count": {
        title: "在职人数",
        description: "月末在职人数。",
      },
    },
    dimensions: {
      "test_people_metrics.organization_name": {
        title: "组织",
        description: "公司一级组织。",
      },
    },
  };
  const cube = {
    meta: async () => [publicView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: {
          actualThrough: "2026-07",
          availableThrough: "2026-07",
        },
      },
    }),
    load: async (query: unknown) => {
      loads.push({ kind: "single", query });
      if (!(query as CubeQuery).dimensions?.length) {
        return { data: [{ "test_people_metrics.active_employee_count": 53 }], annotation };
      }
      return {
        data: [
          {
            "test_people_metrics.organization_name": "A",
            "test_people_metrics.active_employee_count": 30,
          },
          {
            "test_people_metrics.organization_name": "B",
            "test_people_metrics.active_employee_count": 20,
          },
          {
            "test_people_metrics.organization_name": "C",
            "test_people_metrics.active_employee_count": 10,
          },
        ],
        annotation,
      };
    },
    loadMulti: async (query: unknown) => {
      loads.push({ kind: "multi", query });
      const grouped = (query as CubeQuery).dimensions?.includes(
        "test_people_metrics.organization_name",
      );
      if (!grouped) {
        return [
          {
            data: [
              {
                "test_people_metrics.period_month.month": "2026-07-01T00:00:00.000",
                "test_people_metrics.active_employee_count": 53,
              },
            ],
            annotation,
          },
          {
            data: [
              {
                "test_people_metrics.period_month.month": "2025-07-01T00:00:00.000",
                "test_people_metrics.active_employee_count": 50,
              },
            ],
            annotation,
          },
        ];
      }
      return [
        {
          data: [
            {
              "test_people_metrics.organization_name": "B",
              "test_people_metrics.period_month.month": "2026-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 22,
            },
            {
              "test_people_metrics.organization_name": "A",
              "test_people_metrics.period_month.month": "2026-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 31,
            },
            {
              "test_people_metrics.organization_name": "C",
              "test_people_metrics.period_month.month": "2026-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 10,
            },
          ],
          annotation,
        },
        {
          data: [
            {
              "test_people_metrics.organization_name": "A",
              "test_people_metrics.period_month.month": "2025-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 30,
            },
            {
              "test_people_metrics.organization_name": "B",
              "test_people_metrics.period_month.month": "2025-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 20,
            },
            {
              "test_people_metrics.organization_name": "C",
              "test_people_metrics.period_month.month": "2025-07-01T00:00:00.000",
              "test_people_metrics.active_employee_count": 9,
            },
          ],
          annotation,
        },
      ];
    },
  } as unknown as CubeGateway;
  const service = createQueryExecutionService({
    cube,
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: ["test_people_metrics.active_employee_count"],
            dimensions: ["test_people_metrics.organization_name"],
            time: { cutoff: "2026-07", compare: [{ cutoff: "2025-07" }] },
            selection: {
              type: "top_n",
              dimensions: ["test_people_metrics.organization_name"],
              by: "test_people_metrics.active_employee_count",
              window: "anchor",
              count: 2,
              direction: "desc",
            },
            summary: { mode: "grand_total" },
          },
        ],
      }),
    ),
  );

  // 明细与总体各带两个对照窗口走 loadMulti；合计位逐期间求值，故各自是单窗查询。
  const shown = loads.filter(({ kind }) => kind === "multi");
  expect(loads.filter(({ kind }) => kind === "single")).toHaveLength(2);
  expect(shown).toHaveLength(2);
  expect(shown[0]).toMatchObject({
    kind: "multi",
    query: {
      dimensions: ["test_people_metrics.organization_name"],
    },
  });
  expect(
    (shown[0].query as CubeQuery).filters?.some(
      (filter) =>
        "member" in filter && filter.member === "test_people_metrics.active_employee_count",
    ),
  ).toBe(false);
  expect(shown[1]).toMatchObject({
    kind: "multi",
    query: {
      filters: expect.arrayContaining([
        expect.objectContaining({
          or: expect.any(Array),
        }),
      ]),
    },
  });
  expect((shown[1].query as CubeQuery).dimensions ?? []).toEqual([]);
  expect(result.fullRowViewBlock.rows).toEqual([
    ["A", "2025", 30],
    ["A", "2026", 31],
    ["B", "2025", 20],
    ["B", "2026", 22],
  ]);
  expect(result.fullRowViewBlock.row_count).toBe(4);
  expect(result.fullRowViewBlock.has_more).toBe(false);
  expect(result.fullRowViewBlock.summary).toEqual({
    kind: "grand_total",
    label: "所选分组总体",
    scope: "selected_groups",
    rows: [
      [null, "2025", 50],
      [null, "2026", 53],
    ],
  });
  expect(result.fullRowViewBlock.selection_scope).toEqual({
    type: "top_n",
    grain: ["organization_name"],
    by: "active_employee_count",
    window: "anchor",
    direction: "desc",
    requested_count: 2,
    selected_count: 2,
    has_more_groups: true,
  });
  expect(result.fullRowViewBlock.query_notes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ member: expect.stringMatching(/^notice:/), title: "分组选择" }),
    ]),
  );
});

test("Top-N 先按选择粒度排名，再展开选中分组的完整展示粒度", async () => {
  const queries: CubeQuery[] = [];
  const cube = {
    meta: async () => [publicView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load: async (query: CubeQuery) => {
      queries.push(query);
      const expanded = query.dimensions?.includes("test_people_metrics.category_level");
      if (!query.dimensions?.length) {
        return {
          data: [{ "test_people_metrics.active_employee_count": 50 }],
          annotation: {
            measures: { "test_people_metrics.active_employee_count": { title: "在职人数" } },
            dimensions: {},
          },
        };
      }
      return {
        data: expanded
          ? [
              {
                "test_people_metrics.organization_name": "A",
                "test_people_metrics.category_level": "Band C",
                "test_people_metrics.active_employee_count": 10,
              },
              {
                "test_people_metrics.organization_name": "A",
                "test_people_metrics.category_level": "Band D",
                "test_people_metrics.active_employee_count": 20,
              },
              {
                "test_people_metrics.organization_name": "B",
                "test_people_metrics.category_level": "Band C",
                "test_people_metrics.active_employee_count": 8,
              },
              {
                "test_people_metrics.organization_name": "B",
                "test_people_metrics.category_level": "Band D",
                "test_people_metrics.active_employee_count": 12,
              },
            ]
          : [
              {
                "test_people_metrics.organization_name": "A",
                "test_people_metrics.active_employee_count": 30,
              },
              {
                "test_people_metrics.organization_name": "B",
                "test_people_metrics.active_employee_count": 20,
              },
              {
                "test_people_metrics.organization_name": "C",
                "test_people_metrics.active_employee_count": 10,
              },
            ],
        annotation: {
          measures: {
            "test_people_metrics.active_employee_count": { title: "在职人数" },
          },
          dimensions: {
            "test_people_metrics.organization_name": { title: "组织" },
            ...(expanded ? { "test_people_metrics.category_level": { title: "分类层级" } } : {}),
          },
        },
      };
    },
    loadMulti: async () => {
      throw new Error("单窗查询不应调用 loadMulti");
    },
  } as unknown as CubeGateway;
  const service = createQueryExecutionService({
    cube,
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: ["test_people_metrics.active_employee_count"],
            dimensions: [
              "test_people_metrics.organization_name",
              "test_people_metrics.category_level",
            ],
            time: { cutoff: "2026-07" },
            selection: {
              type: "top_n",
              dimensions: ["test_people_metrics.organization_name"],
              by: "test_people_metrics.active_employee_count",
              window: "anchor",
              count: 2,
              direction: "desc",
            },
          },
        ],
      }),
    ),
  );

  // 合计位是无分组腿，排名与展示两条粒度腿仍各只发一次。
  const grouped = queries.filter((query) => query.dimensions?.length);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]?.dimensions).toEqual(["test_people_metrics.organization_name"]);
  expect(grouped[1]?.dimensions).toEqual([
    "test_people_metrics.organization_name",
    "test_people_metrics.category_level",
  ]);
  expect(grouped[1]?.filters).toEqual(
    expect.arrayContaining([expect.objectContaining({ or: expect.any(Array) })]),
  );
  expect(result.fullRowViewBlock.rows).toEqual([
    ["A", "Band C", 10],
    ["A", "Band D", 20],
    ["B", "Band C", 8],
    ["B", "Band D", 12],
  ]);
  expect(result.fullRowViewBlock.selection_scope?.selected_count).toBe(2);
});

test("年度连续区间把端点、YTD 与流量指标自动拆腿后按组织和年份完整组合", async () => {
  const calls: CubeQuery[] = [];
  const dimensions = {
    "test_people_metrics.organization_name": {
      title: "组织",
      description: "公司一级组织。",
    },
  };
  const measureAnnotation = Object.fromEntries(
    publicView.measures.map((measure) => [
      measure.name,
      { title: measure.title, description: `${measure.title}口径。` },
    ]),
  );
  const cube = {
    meta: async () => [publicView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: {
          actualThrough: "2026-07",
          availableThrough: "2026-07",
        },
      },
    }),
    load: async (query: CubeQuery) => {
      calls.push(query);
      const annotation = {
        measures: Object.fromEntries(
          (query.measures ?? []).map((measure) => [measure, measureAnnotation[measure]]),
        ),
        dimensions,
      };
      if (!query.dimensions?.length) {
        return {
          data: [Object.fromEntries((query.measures ?? []).map((measure) => [measure, 1]))],
          annotation,
        };
      }
      return {
        data: [2024, 2025, 2026].map((year) => ({
          "test_people_metrics.organization_name": "示例组织甲",
          "test_people_metrics.period_month.year": `${year}-01-01T00:00:00.000`,
          "test_people_metrics.turnover_count": year - 1900,
        })),
        annotation,
      };
    },
    loadMulti: async (query: CubeQuery) => {
      calls.push(query);
      const endpoint = query.measures?.includes("test_people_metrics.active_employee_count");
      return [2024, 2025, 2026].map((year) => ({
        data: [
          {
            "test_people_metrics.organization_name": "示例组织甲",
            [`test_people_metrics.period_month.${endpoint ? "month" : "year"}`]: `${year}-${endpoint && year < 2026 ? "12" : endpoint ? "07" : "01"}-01T00:00:00.000`,
            ...(endpoint
              ? {
                  "test_people_metrics.ytd_event_rate": year / 100_000,
                  "test_people_metrics.active_employee_count": year * 10,
                  "test_people_metrics.ytd_secondary_event_rate": year / 50_000,
                }
              : { "test_people_metrics.turnover_count": year - 1900 }),
          },
        ],
        annotation: {
          measures: Object.fromEntries(
            (query.measures ?? []).map((measure) => [measure, measureAnnotation[measure]]),
          ),
          dimensions,
        },
      }));
    },
  } as unknown as CubeGateway;
  const service = createQueryExecutionService({
    cube,
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: [
              "test_people_metrics.ytd_event_rate",
              "test_people_metrics.active_employee_count",
              "test_people_metrics.ytd_secondary_event_rate",
              "test_people_metrics.turnover_count",
            ],
            dimensions: ["test_people_metrics.organization_name"],
            time: { cutoff: "2026-07", last: { years: 3 }, grain: "year" },
          },
        ],
      }),
    ),
  );

  // 合计位另走无分组腿；按年展示的拆腿仍是这两条。
  const grouped = calls.filter((query) => query.dimensions?.length);
  expect(grouped).toHaveLength(2);
  expect(grouped.map((query) => query.measures)).toEqual([
    [
      "test_people_metrics.ytd_event_rate",
      "test_people_metrics.active_employee_count",
      "test_people_metrics.ytd_secondary_event_rate",
    ],
    ["test_people_metrics.turnover_count"],
  ]);
  expect(grouped[0].timeDimensions?.[0]?.compareDateRange).toEqual([
    ["2024-12-01", "2024-12-31"],
    ["2025-12-01", "2025-12-31"],
    ["2026-07-01", "2026-07-31"],
  ]);
  expect(grouped[1].timeDimensions?.[0]).toMatchObject({
    granularity: "year",
    dateRange: ["2024-01-01", "2026-07-31"],
  });
  expect(result.fullRowViewBlock.columns).toEqual([
    "organization_name",
    "year",
    "ytd_event_rate",
    "active_employee_count",
    "ytd_secondary_event_rate",
    "turnover_count",
  ]);
  expect(result.fullRowViewBlock.rows).toEqual([
    ["示例组织甲", "2024", 0.02024, 20240, 0.04048, 124],
    ["示例组织甲", "2025", 0.02025, 20250, 0.0405, 125],
    ["示例组织甲", "2026", 0.02026, 20260, 0.04052, 126],
  ]);
  expect(result.fullRowViewBlock.time).toEqual({
    grain: "year",
    coordinates: [{ role: "primary", from: "2024-01", to: "2026-07" }],
    buckets: [
      { key: { year: 2024 }, from: "2024-01", to: "2024-12" },
      { key: { year: 2025 }, from: "2025-01", to: "2025-12" },
      { key: { year: 2026 }, from: "2026-01", to: "2026-07" },
    ],
  });
});

function resultCube(rowCount: number): CubeGateway {
  return {
    meta: async () => [publicView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load: async (query: CubeQuery) => ({
      data: query.dimensions?.includes("test_people_metrics.organization_name")
        ? Array.from({ length: rowCount }, (_, index) => ({
            "test_people_metrics.organization_name": `组织 ${index + 1}`,
            "test_people_metrics.active_employee_count": index + 1,
          }))
        : [
            {
              "test_people_metrics.active_employee_count": (rowCount * (rowCount + 1)) / 2,
            },
          ],
      annotation: {
        measures: {
          "test_people_metrics.active_employee_count": {
            title: "在职人数",
            description: "月末在职人数。",
          },
        },
        dimensions: {
          "test_people_metrics.organization_name": {
            title: "组织",
            description: "公司一级组织。",
          },
        },
      },
    }),
    loadMulti: async () => {
      throw new Error("单窗查询不应调用 loadMulti");
    },
  } as unknown as CubeGateway;
}

test("截断的直查结果交付导出能力与资源", async () => {
  const deliveryQueries: unknown[] = [];
  const delivery = {
    link: {
      url: "https://pa.example/export/ticket",
      expires_at: "2026-07-31T00:00:00.000Z",
    },
    resource: {
      type: "resource_link",
      uri: "pa://export/ticket",
      name: "pa_export.csv",
      mimeType: "text/csv; charset=utf-8",
    },
  } as const;
  const service = createQueryExecutionService({
    cube: resultCube(2001),
    exports: {
      createDelivery: async (query) => {
        deliveryQueries.push(query);
        return delivery;
      },
    },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: ["test_people_metrics.active_employee_count"],
            dimensions: ["test_people_metrics.organization_name"],
            time: { cutoff: "2026-07" },
          },
        ],
      }),
    ),
  );

  expect(result.payload.capabilities).toEqual({ export: delivery.link });
  expect(result.exportResource).toEqual(delivery.resource);
  expect(deliveryQueries).toHaveLength(1);
  expect(
    (deliveryQueries[0] as { legs: Array<{ plan: { query: { limit?: number } } }> }).legs[0].plan
      .query.limit,
  ).toBeUndefined();
});

test("派生结果不创建导出能力或资源", async () => {
  let deliveries = 0;
  const service = createQueryExecutionService({
    cube: resultCube(2),
    exports: {
      createDelivery: async () => {
        deliveries += 1;
        throw new Error("派生结果不应创建导出");
      },
    },
  });
  const result = await service.execute(
    planned(
      planExecution(
        {
          views: [
            {
              id: "source",
              view_title: "组织在职人数数据",
              measures: ["test_people_metrics.active_employee_count"],
              dimensions: ["test_people_metrics.organization_name"],
              time: { cutoff: "2026-07" },
            },
            {
              id: "result",
              view_title: "在职人数",
              from: ["source"],
              columns: [
                { col: "organization_name", source: "source" },
                { col: "active_employee_count", source: "source" },
              ],
              summary: { mode: "grand_total" },
            },
          ],
        },
        {
          delivery: {
            columns: {
              organization_name: "organization_name",
              active_employee_count: "active_employee_count",
            },
            provenance: { sources: [{ title: "人员总览" }], join_keys: [] },
          },
        },
      ),
    ),
  );

  expect(result.payload.view.id).toBe("result");
  expect(result.payload.view.summary).toEqual({
    kind: "grand_total",
    label: "总体",
    scope: "filtered_population",
    rows: [[null, 3]],
  });
  expect(result.payload.capabilities).toBeUndefined();
  expect(result.exportResource).toBeUndefined();
  expect(deliveries).toBe(0);
});

const monthlyRateView: CubeView = {
  ...publicView,
  measures: [
    ...publicView.measures,
    {
      name: "test_people_metrics.monthly_turnover_rate",
      title: "本月离职率",
      type: "number",
      format: "percent",
      meta: {
        time_contract: { aggregation: "recompute", window: "selected", grain: "month" },
      },
    },
  ],
};

function totalsCube(calls: CubeQuery[], cellOf: (query: CubeQuery, measure: string) => number) {
  const annotationOf = (query: CubeQuery) => ({
    measures: Object.fromEntries(
      (query.measures ?? []).map((measure) => [measure, { title: measure }]),
    ),
    dimensions: { "test_people_metrics.organization_name": { title: "组织" } },
  });
  const answer = (query: CubeQuery) => {
    calls.push(query);
    // 明细腿只用来占位：本用例断言的是合计供给，不是明细行。
    if (query.dimensions?.length) return { data: [], annotation: annotationOf(query) };
    return {
      data: [
        Object.fromEntries(
          (query.measures ?? []).map((measure) => [measure, cellOf(query, measure)]),
        ),
      ],
      annotation: annotationOf(query),
    };
  };
  return {
    meta: async () => [monthlyRateView],
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: { workforce: { actualThrough: "2026-07", availableThrough: "2026-07" } },
    }),
    load: async (query: CubeQuery) => answer(query),
    loadMulti: async (query: CubeQuery) => [answer(query)],
  } as unknown as CubeGateway;
}

test("不能整窗合并的指标退到期间终点求值，并写实其真实覆盖期间", async () => {
  const calls: CubeQuery[] = [];
  const values: Record<string, number> = {
    "test_people_metrics.active_employee_count": 100,
    "test_people_metrics.ytd_event_rate": 0.05,
    "test_people_metrics.monthly_turnover_rate": 0.01,
  };
  const service = createQueryExecutionService({
    cube: totalsCube(calls, (_query, measure) => values[measure]),
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: [
              "test_people_metrics.active_employee_count",
              "test_people_metrics.ytd_event_rate",
              "test_people_metrics.monthly_turnover_rate",
            ],
            dimensions: ["test_people_metrics.organization_name"],
            time: { range: { from: "2025-06", to: "2026-07" }, grain: "month" },
          },
        ],
      }),
      TABLE_PRESENTATION,
      [monthlyRateView],
    ),
  );

  expect(result.payload.view.totals).toEqual({
    metrics: [
      {
        column: "active_employee_count",
        periods: [{ from: "2025-06", to: "2026-07", value: 100, coverage: "window" }],
      },
      {
        column: "ytd_event_rate",
        periods: [{ from: "2026-01", to: "2026-07", value: 0.05, coverage: "endpoint" }],
      },
      {
        column: "monthly_turnover_rate",
        periods: [{ from: "2026-07", to: "2026-07", value: 0.01, coverage: "endpoint" }],
      },
    ],
  });
  // 合计恒经查询编译点独立求值：无分组、整段单桶，绝不由明细行加总而来。
  const totalLegs = calls.filter((query) => !query.dimensions?.length);
  expect(totalLegs.length).toBeGreaterThan(0);
  expect(totalLegs.every((query) => !query.timeDimensions?.[0]?.compareDateRange)).toBe(true);
});

test("带对照时每个指标逐期间给出合计", async () => {
  const calls: CubeQuery[] = [];
  const service = createQueryExecutionService({
    cube: totalsCube(calls, (query) =>
      Number(query.timeDimensions?.[0]?.dateRange?.[0]?.slice(0, 4) ?? 0),
    ),
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution({
        views: [
          {
            id: "result",
            measures: ["test_people_metrics.active_employee_count"],
            dimensions: ["test_people_metrics.organization_name"],
            time: { cutoff: "2026-07", compare: [{ cutoff: "2025-07" }] },
          },
        ],
      }),
    ),
  );

  expect(result.payload.view.totals).toEqual({
    metrics: [
      {
        column: "active_employee_count",
        periods: [
          { from: "2026-07", to: "2026-07", value: 2026, coverage: "window" },
          { from: "2025-07", to: "2025-07", value: 2025, coverage: "window" },
        ],
      },
    ],
  });
});

test("派生结果没有单一业务时间轴，因而没有整窗合计", async () => {
  const calls: CubeQuery[] = [];
  const service = createQueryExecutionService({
    cube: totalsCube(calls, () => 7),
    exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
  });
  const result = await service.execute(
    planned(
      planExecution(
        {
          views: [
            {
              id: "base",
              view_title: "在职",
              measures: ["test_people_metrics.active_employee_count"],
              time: { cutoff: "2026-07" },
            },
            {
              id: "result",
              view_title: "在职翻倍",
              from: ["base"],
              columns: [
                {
                  as: "double_headcount",
                  expr: {
                    op: "+",
                    left: { col: "active_employee_count", source: "base" },
                    right: { col: "active_employee_count", source: "base" },
                  },
                },
              ],
            },
          ],
        },
        {
          delivery: {
            columns: { double_headcount: "double_headcount" },
            provenance: { sources: [{ title: "在职" }], join_keys: [] },
          },
        },
      ),
    ),
  );

  expect(result.payload.view.totals).toBeUndefined();
  // 来源查询也不白算一遍合计：只发了来源查询本身这一次，没有多出的合计腿。
  expect(calls).toHaveLength(1);
});

test("模型成员的 meta.decimals 随列进入载荷 column_decimals，且按公共列 id 键控", async () => {
  const METRIC = "measure:organization_recommendation_index";
  const DIMENSION = "dimension:organization_name";
  const surveyView: CubeView = {
    ...publicView,
    measures: [
      {
        name: "test_people_metrics.organization_recommendation_index",
        title: "组织推荐指数",
        type: "number",
        format: "percent",
        meta: { decimals: 0, time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
  };
  const gateway = (view: CubeView) =>
    ({
      meta: async () => [view],
      timeContext: async () => ({
        dataAsOf: "2026-07",
        sources: { workforce: { actualThrough: "2026-07", availableThrough: "2026-07" } },
      }),
      load: async () => ({
        data: [
          {
            "test_people_metrics.organization_name": "研发",
            "test_people_metrics.organization_recommendation_index": 0.2349,
          },
        ],
        annotation: {
          measures: {
            "test_people_metrics.organization_recommendation_index": {
              title: "组织推荐指数",
              description: "",
            },
          },
          dimensions: {
            "test_people_metrics.organization_name": { title: "组织", description: "" },
          },
        },
      }),
      loadMulti: async () => {
        throw new Error("单窗查询不应调用 loadMulti");
      },
    }) as unknown as CubeGateway;
  const run = (view: CubeView) =>
    createQueryExecutionService({
      cube: gateway(view),
      exports: { createDelivery: async () => Promise.reject(new Error("不应导出")) },
    }).execute(
      planned(
        planExecution(
          {
            views: [
              {
                id: "result",
                measures: ["test_people_metrics.organization_recommendation_index"],
                dimensions: ["test_people_metrics.organization_name"],
                time: { cutoff: "2026-07" },
              },
            ],
          },
          {
            delivery: {
              columns: {
                organization_recommendation_index: METRIC,
                organization_name: DIMENSION,
              },
            },
          },
        ),
        TABLE_PRESENTATION,
        [view],
      ),
    );
  const result = await run(surveyView);
  expect(result.payload.view.column_formats).toEqual({ [METRIC]: "percent" });
  expect(result.payload.view.column_decimals).toEqual({ [METRIC]: 0 });

  const undeclared: CubeView = {
    ...surveyView,
    measures: [
      {
        ...surveyView.measures[0],
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
  };
  expect((await run(undeclared)).payload.view.column_decimals).toBeUndefined();

  const invalid: CubeView = {
    ...surveyView,
    measures: [
      { ...surveyView.measures[0], meta: { ...surveyView.measures[0].meta, decimals: 7 } },
    ],
  };
  await expect(run(invalid)).rejects.toThrow("meta.decimals 必须是 0–4 的整数");
});
