import { describe, expect, test } from "bun:test";
import { PRESENTATION_TYPE_SCHEMA } from "./presentation_type.js";
import {
  MAX_SEMANTIC_QUERIES,
  parseAnalysisDefinition,
  SEMANTIC_VIEW_INTENT_INPUT,
} from "./semantic_analysis.js";

const specWithFilters = (filters: unknown[]) => ({
  queries: [
    {
      id: "result",
      measures: ["measure:active_employee_count"],
      filters,
      time: { window: { kind: "current_month" } },
    },
  ],
});

test("查询预算只约束用户声明的来源查询", () => {
  expect(() =>
    parseAnalysisDefinition({
      queries: Array.from({ length: MAX_SEMANTIC_QUERIES + 1 }, (_, index) => ({
        id: `source_${index}`,
        measures: ["measure:active_employee_count"],
        time: { window: { kind: "current_month" } },
      })),
    }),
  ).toThrow("分析定义无效");
});

describe("semantic analysis filters", () => {
  test("语义成员必须携带种类前缀", () => {
    expect(() =>
      parseAnalysisDefinition({
        queries: [
          {
            id: "result",
            measures: ["active_employee_count"],
            dimensions: ["organization_name"],
            time: { window: { kind: "current_month" } },
          },
        ],
      }),
    ).toThrow("分析定义无效");
  });

  test("多值按集合在输入边界去空、去重并稳定排序", () => {
    const parsed = parseAnalysisDefinition(
      specWithFilters([
        {
          member: "dimension:organization_name",
          relation: "one_of",
          values: [" 部门乙 ", "部门甲", "部门乙"],
        },
      ]),
    );
    const view = parsed.queries[0];
    expect(view && !("from" in view) ? view.filters?.[0]?.values : undefined).toEqual([
      "部门乙",
      "部门甲",
    ]);
  });

  test("筛选必须有非空值，且同一维度只能出现一次", () => {
    for (const values of [undefined, [], [" "]]) {
      expect(() =>
        parseAnalysisDefinition(
          specWithFilters([
            {
              member: "dimension:organization_name",
              relation: "one_of",
              ...(values === undefined ? {} : { values }),
            },
          ]),
        ),
      ).toThrow("分析定义无效");
    }
    expect(() =>
      parseAnalysisDefinition(
        specWithFilters([
          {
            member: "dimension:organization_name",
            relation: "one_of",
            values: ["部门甲"],
          },
          {
            member: "dimension:organization_name",
            relation: "none_of",
            values: ["部门乙"],
          },
        ]),
      ),
    ).toThrow("同一维度只能声明一条筛选");
  });

  test("公共定义拒绝物理筛选 operator", () => {
    expect(() =>
      parseAnalysisDefinition(
        specWithFilters([
          {
            member: "dimension:organization_name",
            operator: "equals",
            values: ["部门甲"],
          },
        ]),
      ),
    ).toThrow("分析定义无效");
  });
});

describe("semantic analysis group sort", () => {
  const grouped = (groupSort?: unknown) => ({
    queries: [
      {
        id: "result",
        measures: ["measure:active_employee_count"],
        dimensions: ["dimension:organization_name"],
        time: { window: { kind: "current_month" } },
        ...(groupSort === undefined ? {} : { group_sort: groupSort }),
      },
    ],
  });

  test("省略分组排序即展示全部，不自动产生 Top 10", () => {
    const parsed = parseAnalysisDefinition(grouped());
    const view = parsed.queries[0];
    expect(view && !("from" in view) ? view.group_sort : undefined).toBeUndefined();
  });

  test("最大项数是维度上下文的可选配置，上限为 20", () => {
    expect(() =>
      parseAnalysisDefinition(
        grouped({
          dimension: "dimension:organization_name",
          by: "measure:active_employee_count",
          direction: "desc",
          max_items: 20,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      parseAnalysisDefinition(
        grouped({
          dimension: "dimension:organization_name",
          by: "measure:active_employee_count",
          direction: "desc",
          max_items: 21,
        }),
      ),
    ).toThrow("分析定义无效");
  });

  test('名称排序使用 "name" 并拒绝未登记的 order 与 selection', () => {
    expect(() =>
      parseAnalysisDefinition(
        grouped({
          dimension: "dimension:organization_name",
          by: "name",
          direction: "asc",
        }),
      ),
    ).not.toThrow();
    const base = grouped();
    expect(() =>
      parseAnalysisDefinition({
        ...base,
        queries: [
          {
            ...base.queries[0],
            order: [{ member: "measure:active_employee_count", direction: "desc" }],
          },
        ],
      }),
    ).toThrow("分析定义无效");
    expect(() =>
      parseAnalysisDefinition({
        ...base,
        queries: [
          {
            ...base.queries[0],
            selection: {
              type: "top_n",
              grain: ["dimension:organization_name"],
              by: "measure:active_employee_count",
              window: "anchor",
              count: 10,
              direction: "desc",
            },
          },
        ],
      }),
    ).toThrow("分析定义无效");
  });
});

describe("semantic analysis report calculations", () => {
  const calculated = (overrides: Record<string, unknown> = {}) => ({
    queries: [
      {
        id: "result",
        measures: ["measure:active_employee_count"],
        dimensions: ["dimension:organization_name", "dimension:job_level_band"],
        calculations: [
          {
            id: "calculation:active_employee_job_level_share",
            title: "职级结构",
            kind: "percent_of_total",
            measure: "measure:active_employee_count",
            category_dimension: "dimension:job_level_band",
          },
        ],
        time: { window: { kind: "current_month" } },
        ...overrides,
      },
    ],
  });

  test("构成占比必须引用同一查询中的正式指标和分类分组", () => {
    expect(() => parseAnalysisDefinition(calculated())).not.toThrow();
    expect(() =>
      parseAnalysisDefinition(calculated({ measures: ["measure:average_entity_count"] })),
    ).toThrow("基础指标必须同时出现在 measures");
    expect(() =>
      parseAnalysisDefinition(calculated({ dimensions: ["dimension:organization_name"] })),
    ).toThrow("分类维度必须同时出现在 dimensions");
  });

  test("构成占比、总体与分组选择是结构上独立的查询声明", () => {
    expect(() =>
      parseAnalysisDefinition(calculated({ summary: { mode: "grand_total" } })),
    ).not.toThrow();
    expect(() =>
      parseAnalysisDefinition(
        calculated({
          group_sort: {
            dimension: "dimension:job_level_band",
            by: "measure:active_employee_count",
            direction: "desc",
            max_items: 5,
          },
        }),
      ),
    ).not.toThrow();
  });
});

describe("语义呈现意图边界", () => {
  test("只接受数据通道，不接受人类视觉设置", () => {
    expect(
      SEMANTIC_VIEW_INTENT_INPUT.safeParse({
        type: "bar",
        category: "dimension:organization_name",
        series: ["measure:active_employee_count"],
      }).success,
    ).toBe(true);
    for (const visual of [
      { value_labels: "all" },
      { display: { series: {} } },
      { shading: { palette: "red_blue" } },
    ]) {
      expect(SEMANTIC_VIEW_INTENT_INPUT.safeParse({ type: "table", ...visual }).success).toBe(
        false,
      );
    }
  });

  test("图型全集逐个有变体：新增呈现形态不能漏写通道声明", () => {
    for (const type of PRESENTATION_TYPE_SCHEMA.options) {
      expect(SEMANTIC_VIEW_INTENT_INPUT.safeParse({ type }).success).toBe(true);
    }
  });

  test("通道只属于声明了它的图型", () => {
    const rejected = [
      { type: "table", category: "dimension:organization_name" },
      { type: "kpi", series: ["measure:active_employee_count"] },
      { type: "line", category: "dimension:organization_name" },
      { type: "pie", group_by: "dimension:organization_name" },
      { type: "line", annotations: ["measure:active_employee_count"] },
      { type: "line", stack: true },
      { type: "line", columns: ["metrics"] },
      { type: "pie", secondary_series: ["measure:active_employee_count"] },
    ];
    for (const intent of rejected) {
      expect(SEMANTIC_VIEW_INTENT_INPUT.safeParse(intent).success).toBe(false);
    }
  });

  test("副轴系列是值通道的第二把尺子：不与主系列重复，拆分在场时没有它", () => {
    const rate = "measure:ytd_primary_event_rate";
    const count = "measure:active_employee_count";
    expect(
      SEMANTIC_VIEW_INTENT_INPUT.safeParse({
        type: "line",
        series: [count],
        secondary_series: [rate],
      }).success,
    ).toBe(true);
    expect(
      SEMANTIC_VIEW_INTENT_INPUT.safeParse({ type: "bar", secondary_series: [rate] }).success,
    ).toBe(true);
    const rejected = [
      { type: "line", series: [count, rate], secondary_series: [rate] },
      { type: "bar", secondary_series: [rate], group_by: "dimension:organization_name" },
      { type: "line", secondary_series: [] },
    ];
    for (const intent of rejected) {
      expect(SEMANTIC_VIEW_INTENT_INPUT.safeParse(intent).success).toBe(false);
    }
  });
});
