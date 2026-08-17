import { describe, expect, test } from "bun:test";
import { parseSemanticAnalysisSpec } from "./semantic_analysis.js";

const specWithFilters = (filters: unknown[]) => ({
  version: 2,
  analysis: {
    views: [
      {
        id: "result",
        measures: ["measure:active_employee_count"],
        filters,
        time: { window: { kind: "current_month" } },
      },
    ],
  },
  presentation: { type: "table" },
});

describe("semantic analysis filters", () => {
  test("多值按集合在输入边界去空、去重并稳定排序", () => {
    const parsed = parseSemanticAnalysisSpec(
      specWithFilters([
        {
          member: "dimension:organization_name",
          relation: "one_of",
          values: [" 部门乙 ", "部门甲", "部门乙"],
        },
      ]),
    );
    const view = parsed.analysis.views[0];
    expect(view && !("from" in view) ? view.filters?.[0]?.values : undefined).toEqual([
      "部门乙",
      "部门甲",
    ]);
  });

  test("筛选必须有非空值，且同一维度只能出现一次", () => {
    for (const values of [undefined, [], [" "]]) {
      expect(() =>
        parseSemanticAnalysisSpec(
          specWithFilters([
            {
              member: "dimension:organization_name",
              relation: "one_of",
              ...(values === undefined ? {} : { values }),
            },
          ]),
        ),
      ).toThrow("语义分析规格无效");
    }
    expect(() =>
      parseSemanticAnalysisSpec(
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

  test("公共规格拒绝物理 operator 和非当前版本", () => {
    expect(() =>
      parseSemanticAnalysisSpec(
        specWithFilters([
          {
            member: "dimension:organization_name",
            operator: "equals",
            values: ["部门甲"],
          },
        ]),
      ),
    ).toThrow("语义分析规格无效");
    expect(() => parseSemanticAnalysisSpec({ ...specWithFilters([]), version: 1 })).toThrow(
      "语义分析规格无效",
    );
  });
});

describe("semantic analysis group sort", () => {
  const grouped = (groupSort?: unknown) => ({
    version: 2,
    analysis: {
      views: [
        {
          id: "result",
          measures: ["measure:active_employee_count"],
          dimensions: ["dimension:organization_name"],
          time: { window: { kind: "current_month" } },
          ...(groupSort === undefined ? {} : { group_sort: groupSort }),
        },
      ],
    },
    presentation: { type: "table" },
  });

  test("省略分组排序即展示全部，不自动产生 Top 10", () => {
    const parsed = parseSemanticAnalysisSpec(grouped());
    const view = parsed.analysis.views[0];
    expect(view && !("from" in view) ? view.group_sort : undefined).toBeUndefined();
  });

  test("最大项数是维度上下文的可选配置，上限为 20", () => {
    expect(() =>
      parseSemanticAnalysisSpec(
        grouped({
          dimension: "dimension:organization_name",
          by: "measure:active_employee_count",
          direction: "desc",
          max_items: 20,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      parseSemanticAnalysisSpec(
        grouped({
          dimension: "dimension:organization_name",
          by: "measure:active_employee_count",
          direction: "desc",
          max_items: 21,
        }),
      ),
    ).toThrow("语义分析规格无效");
  });

  test('名称排序使用 "name" 并拒绝未登记的 order 与 selection', () => {
    expect(() =>
      parseSemanticAnalysisSpec(
        grouped({
          dimension: "dimension:organization_name",
          by: "name",
          direction: "asc",
        }),
      ),
    ).not.toThrow();
    const base = grouped();
    expect(() =>
      parseSemanticAnalysisSpec({
        ...base,
        analysis: {
          views: [
            {
              ...base.analysis.views[0],
              order: [{ member: "measure:active_employee_count", direction: "desc" }],
            },
          ],
        },
      }),
    ).toThrow("语义分析规格无效");
    expect(() =>
      parseSemanticAnalysisSpec({
        ...base,
        analysis: {
          views: [
            {
              ...base.analysis.views[0],
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
        },
      }),
    ).toThrow("语义分析规格无效");
  });
});

describe("semantic analysis report calculations", () => {
  const calculated = (overrides: Record<string, unknown> = {}) => ({
    version: 2,
    analysis: {
      views: [
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
    },
    presentation: { type: "table" },
  });

  test("构成占比必须引用同一查询中的正式指标和分类分组", () => {
    expect(() => parseSemanticAnalysisSpec(calculated())).not.toThrow();
    expect(() =>
      parseSemanticAnalysisSpec(calculated({ measures: ["measure:average_entity_count"] })),
    ).toThrow("基础指标必须同时出现在 measures");
    expect(() =>
      parseSemanticAnalysisSpec(calculated({ dimensions: ["dimension:organization_name"] })),
    ).toThrow("分类维度必须同时出现在 dimensions");
  });

  test("构成占比与总体行、Top-N 互斥，避免分母与可见分类集合背离", () => {
    expect(() =>
      parseSemanticAnalysisSpec(calculated({ summary: { mode: "grand_total" } })),
    ).toThrow("不能同时声明总体行");
    expect(() =>
      parseSemanticAnalysisSpec(
        calculated({
          group_sort: {
            dimension: "dimension:job_level_band",
            by: "measure:active_employee_count",
            direction: "desc",
            max_items: 5,
          },
        }),
      ),
    ).toThrow("暂不支持 Top-N");
  });
});
