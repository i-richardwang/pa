import { describe, expect, test } from "bun:test";
import type { ViewBlock } from "../semantic_core/query_payload.js";
import type { DerivedViewSpec } from "../semantic_core/analysis_spec.js";
import {
  transformDerivedView as executeDerivedView,
  type DerivedSourceSemantics,
  type EngineViewBlock,
  type SourceColumnSemantics,
} from "./transform.js";
import type { MetricTimeEvaluation } from "./metric_time.js";
import { timeBuckets, type TimeOutputGrain } from "../semantic_core/time_contract.js";
import type { BusinessTimeResolution } from "./time_plan.js";

/** 截止月份坐标：单月桶，与结果粒度无关。 */
const atCutoffs = (grain: TimeOutputGrain, ...months: string[]): BusinessTimeResolution => ({
  outputGrain: grain,
  coordinates: months.map((month) => ({
    kind: "cutoff" as const,
    from: month,
    to: month,
    buckets: [{ from: month, to: month }],
  })),
});

/** 连续期间坐标：桶由唯一枚举规则按结果粒度切出。 */
const overRanges = (
  grain: TimeOutputGrain,
  ...ranges: { from: string; to: string }[]
): BusinessTimeResolution => ({
  outputGrain: grain,
  coordinates: ranges.map(({ from, to }) => ({
    kind: "range" as const,
    from,
    to,
    buckets: timeBuckets({ kind: "range", from, to }, grain),
  })),
});

const resultTime = (from: string, to: string): NonNullable<ViewBlock["time"]> => ({
  grain: "total",
  coordinates: [{ role: "primary", from, to }],
  buckets: [{ key: null, from, to }],
});

function view(title: string, rows: ViewBlock["rows"], opts: Partial<ViewBlock> = {}): ViewBlock {
  const columns = opts.columns ?? ["organization_name", "ytd_primary_event_rate"];
  const defaultRoles = Object.fromEntries(
    columns.map((column) => [
      column,
      column === "organization_name" || column === "department_name" ? "dimension" : "measure",
    ]),
  ) as ViewBlock["column_roles"];
  return {
    id: opts.id ?? "v0",
    view_title: title,
    columns,
    column_roles: opts.column_roles ?? defaultRoles,
    column_formats: { ytd_primary_event_rate: "percent" },
    rows,
    row_count: rows.length,
    has_more: false,
    time: resultTime("2026-01", "2026-06"),
    query_notes: [
      {
        member: "test_people_metrics.organization_name",
        title: "组织",
        text: "组织口径",
      },
      {
        member: "test_people_metrics.ytd_primary_event_rate",
        title: "YTD主要事件率",
        text: "率口径",
      },
    ],
    display_notes: [
      {
        member: "test_people_metrics.ytd_primary_event_rate",
        title: "YTD主要事件率",
        text: "用户口径",
      },
    ],
    ...opts,
  };
}

function sourceSemantics(
  sources: ReadonlyMap<string, ViewBlock>,
  overrides: Partial<Record<string, Partial<Record<string, Partial<SourceColumnSemantics>>>>> = {},
): Map<string, DerivedSourceSemantics> {
  return new Map(
    [...sources].map(([source, block]) => {
      const cutoff = block.time?.buckets[0]?.to ?? "2026-06";
      const columns = new Map(
        block.columns.map((column) => {
          const base: SourceColumnSemantics =
            column === "organization_name"
              ? {
                  member: `test_people_metrics.${column}`,
                  alias: "test_people_metrics.organization_name",
                  kind: "dimension",
                  valueType: "string",
                  semanticId: "dimension:organization_name",
                }
              : {
                  member: `test_people_metrics.${column}`,
                  alias: `test_people_metrics.${column}`,
                  kind: "measure",
                  valueType: "number",
                  timeEvaluation: "year_to_date" as MetricTimeEvaluation,
                };
          return [column, { ...base, ...(overrides[source]?.[column] ?? {}) }] as const;
        }),
      );
      return [source, { columns, time: atCutoffs("total", cutoff) }] as const;
    }),
  );
}

function transformDerivedView(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, ViewBlock>,
  standardMeasureTitles: ReadonlySet<string>,
  semantics = sourceSemantics(sources),
): EngineViewBlock {
  return executeDerivedView(spec, sources, standardMeasureTitles, semantics);
}

const YOY: DerivedViewSpec = {
  id: "yoy",
  view_title: "同比差异",
  from: ["v0", "v1"],
  join: { on: [{ left: "organization_name", right: "organization_name" }], how: "left" },
  columns: [
    { col: "organization_name", source: "v0" },
    {
      expr: {
        op: "-",
        left: { col: "ytd_primary_event_rate", source: "v0" },
        right: { col: "ytd_primary_event_rate", source: "v1" },
      },
      as: "YTD主要事件率同比变化",
      format: "percentage_point",
    },
  ],
  order: [{ by: "YTD主要事件率同比变化", direction: "desc" }],
};

describe("transformDerivedView", () => {
  test("重命名两侧同名搬运列，生成单张同比宽表并继承格式与口径", () => {
    const sources = new Map<string, ViewBlock>([
      [
        "v1",
        view("2026年", [
          ["A", 0.12],
          ["B", 0.08],
        ]),
      ],
      [
        "v2",
        view("2025年", [["A", 0.1]], {
          time: resultTime("2025-01", "2025-06"),
        }),
      ],
    ]);
    const result = transformDerivedView(
      {
        id: "summary",
        view_title: "同比汇总",
        from: ["v1", "v2"],
        join: { on: [{ left: "organization_name", right: "organization_name" }], how: "left" },
        columns: [
          { col: "organization_name", source: "v1" },
          { col: "ytd_primary_event_rate", source: "v1", as: "2026年YTD主要事件率" },
          { col: "ytd_primary_event_rate", source: "v2", as: "2025年YTD主要事件率" },
          {
            expr: {
              op: "-",
              left: { col: "ytd_primary_event_rate", source: "v1" },
              right: { col: "ytd_primary_event_rate", source: "v2" },
            },
            as: "YTD主要事件率同比变化（百分点）",
            format: "percentage_point",
          },
        ],
      },
      sources,
      new Set(["YTD主要事件率"]),
    );

    expect(result.columns).toEqual([
      "organization_name",
      "2026年YTD主要事件率",
      "2025年YTD主要事件率",
      "YTD主要事件率同比变化（百分点）",
    ]);
    expect(result.rows).toEqual([
      ["A", 0.12, 0.1, 0.01999999999999999],
      ["B", 0.08, null, null],
    ]);
    expect(result.column_formats).toEqual({
      "2026年YTD主要事件率": "percent",
      "2025年YTD主要事件率": "percent",
      "YTD主要事件率同比变化（百分点）": "percentage_point",
    });
    expect(
      result.query_notes.find(({ member }) => member === "2026年YTD主要事件率")?.text,
    ).toContain("来源 2026年；业务期间 2026年1月至6月（YTD）");
    expect(
      result.display_notes?.find(({ member }) => member === "2025年YTD主要事件率")?.text,
    ).toContain("来源 2025年；业务期间 2025年1月至6月（YTD）");
  });

  test("按唯一同名键 left join，逐行算式、空侧 null、格式与口径合成", () => {
    const sources = new Map<string, ViewBlock>([
      [
        "v0",
        view("2026年", [
          ["A", 0.12],
          ["B", 0.08],
        ]),
      ],
      [
        "v1",
        view("2025年", [["A", 0.1]], {
          time: resultTime("2025-01", "2025-06"),
        }),
      ],
    ]);
    const result = transformDerivedView(YOY, sources, new Set(["YTD主要事件率"]));
    expect(result.columns).toEqual(["organization_name", "YTD主要事件率同比变化"]);
    expect(result.rows).toEqual([
      ["A", 0.01999999999999999],
      ["B", null],
    ]);
    expect(result.column_formats).toEqual({
      YTD主要事件率同比变化: "percentage_point",
    });
    expect(result.time).toBeUndefined();
    expect(result.derived?.formula).toBe(
      "YTD主要事件率同比变化 = YTD主要事件率(2026年) − YTD主要事件率(2025年)",
    );
    expect(
      result.query_notes.find(({ member }) => member === "YTD主要事件率同比变化")?.text,
    ).toContain("跨期比较：2026年1月至6月（YTD） 对比 2025年1月至6月（YTD）");
    expect(result.display_notes?.[0]?.text).toContain("跨期比较");
  });

  test("左右不同物理列名可按同一语义维度关联", () => {
    const sources = new Map<string, ViewBlock>([
      ["v0", view("人员", [["A", 10]])],
      [
        "v1",
        view("编制", [["A", 0.8]], {
          columns: ["department_name", "ytd_primary_event_rate"],
        }),
      ],
    ]);
    const semantics = sourceSemantics(sources, {
      v1: {
        department_name: {
          member: "headcount_plan.department_name",
          alias: "hc_plan.department_name",
          kind: "dimension",
          valueType: "string",
          semanticId: "dimension:organization_name",
        },
      },
    });
    const result = transformDerivedView(
      {
        id: "combined",
        view_title: "人员与编制",
        from: ["v0", "v1"],
        join: {
          on: [{ left: "organization_name", right: "department_name" }],
          how: "left",
        },
        columns: [
          { col: "organization_name", source: "v0" },
          { col: "ytd_primary_event_rate", source: "v1", as: "编制完成率" },
        ],
      },
      sources,
      new Set(),
      semantics,
    );
    expect(result.rows).toEqual([["A", 0.8]]);
    expect(result.derived?.formula).toContain("organization_name = department_name");
  });

  test("inner join 只保留匹配行；limit 对派生结果记录 has_more", () => {
    const sources = new Map<string, ViewBlock>([
      [
        "v0",
        view("本期", [
          ["A", 4],
          ["B", 2],
          ["C", 1],
        ]),
      ],
      [
        "v1",
        view("上期", [
          ["A", 2],
          ["B", 1],
        ]),
      ],
    ]);
    const result = transformDerivedView(
      {
        ...YOY,
        join: { on: [{ left: "organization_name", right: "organization_name" }], how: "inner" },
        limit: 1,
      },
      sources,
      new Set(),
    );
    expect(result.rows).toEqual([["A", 2]]);
    expect(result.row_count).toBe(1);
    expect(result.has_more).toBe(true);
  });

  test("full join 保留两侧独有组织，关联键回填且缺失指标保持 null", () => {
    const sources = new Map<string, ViewBlock>([
      [
        "v0",
        view(
          "人员",
          [
            ["A", 10],
            ["B", 8],
            [null, 2],
          ],
          {
            query_notes: [
              {
                member: "org_scope",
                title: "数据范围",
                text: "仅限 Aurora Labs",
              },
            ],
            display_notes: [
              {
                member: "org_scope",
                title: "数据范围",
                text: "仅含有权组织",
              },
            ],
          },
        ),
      ],
      [
        "v1",
        view("编制", [
          ["A", 0.9],
          ["C", 0.7],
          [null, 0.5],
        ]),
      ],
    ]);
    const result = transformDerivedView(
      {
        id: "combined",
        view_title: "人员与编制",
        from: ["v0", "v1"],
        join: { on: [{ left: "organization_name", right: "organization_name" }], how: "full" },
        columns: [
          { col: "organization_name", source: "v0" },
          { col: "ytd_primary_event_rate", source: "v0", as: "在职人数" },
          { col: "ytd_primary_event_rate", source: "v1", as: "编制完成率" },
        ],
      },
      sources,
      new Set(),
    );
    expect(result.rows).toEqual([
      ["A", 10, 0.9],
      ["B", 8, null],
      [null, 2, 0.5],
      ["C", null, 0.7],
    ]);
    expect(result.query_notes).toContainEqual({
      member: "join_key_nulls",
      title: "组合维度空值",
      text: "组合维度中的空值按空值参与对齐；只有其余组合维度也一致时才合并。",
    });
    expect(result.display_notes).toContainEqual({
      member: "join_key_nulls",
      title: "组合维度空值",
      text: "组合维度中的空值按空值参与对齐；只有其余组合维度也一致时才合并。",
    });
    expect(result.query_notes.filter((note) => note.member === "org_scope")).toEqual([
      { member: "org_scope", title: "数据范围", text: "仅限 Aurora Labs" },
    ]);
    expect(result.display_notes?.filter((note) => note.member === "org_scope")).toEqual([
      { member: "org_scope", title: "数据范围", text: "仅含有权组织" },
    ]);
  });

  test("除零、null 与非有限结果归 null，数值字符串可参与算式", () => {
    const source = view("输入", [
      ["A", "4"],
      ["B", 0],
      ["C", null],
    ]);
    const spec: DerivedViewSpec = {
      id: "ratio",
      view_title: "比值",
      from: ["v0"],
      columns: [
        { col: "organization_name", source: "v0" },
        {
          expr: {
            op: "/",
            left: { lit: 8 },
            right: { col: "ytd_primary_event_rate", source: "v0" },
          },
          as: "比值",
        },
      ],
    };
    expect(transformDerivedView(spec, new Map([["v0", source]]), new Set()).rows).toEqual([
      ["A", 2],
      ["B", null],
      ["C", null],
    ]);
  });

  test("join 任一侧键重复即拒绝并给出收窄方式", () => {
    const duplicate = view("重复侧", [
      ["A", 1],
      ["A", 2],
    ]);
    const unique = view("唯一侧", [["A", 1]]);
    expect(() =>
      transformDerivedView(
        YOY,
        new Map([
          ["v0", duplicate],
          ["v1", unique],
        ]),
        new Set(),
      ),
    ).toThrow(/join 键.*重复.*唯一分组/);
    expect(() =>
      transformDerivedView(
        YOY,
        new Map([
          ["v0", unique],
          ["v1", duplicate],
        ]),
        new Set(),
      ),
    ).toThrow(/join 键.*重复.*唯一分组/);
    expect(() =>
      transformDerivedView(
        {
          ...YOY,
          join: { on: [{ left: "organization_name", right: "organization_name" }], how: "full" },
        },
        new Map([
          ["v0", unique],
          ["v1", duplicate],
        ]),
        new Set(),
      ),
    ).toThrow(/join 键.*重复.*唯一分组/);
  });

  test("many_to_one 将 Cube 已聚合的分区合计广播到分类行，不在 transform 跨行求和", () => {
    const numerator = view(
      "职级人数",
      [
        ["Band C", 20],
        ["Band D", 30],
        ["Band B", 50],
      ],
      {
        columns: ["job_level_band", "active_employee_count"],
        column_roles: { job_level_band: "dimension", active_employee_count: "measure" },
      },
    );
    const denominator = view("在职总人数", [[100]], {
      columns: ["active_employee_count"],
      column_roles: { active_employee_count: "measure" },
    });
    const result = transformDerivedView(
      {
        id: "structure",
        view_title: "职级结构",
        from: ["numerator", "denominator"],
        join: { on: [], how: "left", cardinality: "many_to_one" },
        columns: [
          { source: "numerator", col: "job_level_band" },
          { source: "numerator", col: "active_employee_count" },
          {
            expr: {
              op: "/",
              left: { source: "numerator", col: "active_employee_count" },
              right: { source: "denominator", col: "active_employee_count" },
            },
            as: "职级结构",
            format: "percent",
          },
        ],
        structure_shares: [{ measure: "职级结构", numerator: "active_employee_count" }],
      },
      new Map([
        ["numerator", numerator],
        ["denominator", denominator],
      ]),
      new Set(),
    );
    expect(result.rows).toEqual([
      ["Band C", 20, 0.2],
      ["Band D", 30, 0.3],
      ["Band B", 50, 0.5],
    ]);
    expect(result.structure_shares).toEqual([
      { measure: "职级结构", numerator: "active_employee_count" },
    ]);
  });

  test("输入 has_more 即拒绝；sampled 标记本身不影响完整行变换", () => {
    const complete = view("完整", [["A", 2]], { sampled: "模型只见样本" });
    const other = view("对照", [["A", 1]]);
    expect(
      transformDerivedView(
        YOY,
        new Map([
          ["v0", complete],
          ["v1", other],
        ]),
        new Set(),
      ).rows,
    ).toEqual([["A", 1]]);
    const incomplete = view("不完整", [["A", 2]], { has_more: true });
    expect(() =>
      transformDerivedView(
        YOY,
        new Map([
          ["v0", incomplete],
          ["v1", other],
        ]),
        new Set(),
      ),
    ).toThrow(/输入结果不完整.*收窄查询/);
  });

  test("派生列不得冒用标准指标展示名，非数值列不可进入算式", () => {
    const source = view("输入", [["A", 2]]);
    const named: DerivedViewSpec = {
      id: "named",
      view_title: "冒名",
      from: ["v0"],
      columns: [
        {
          expr: { op: "+", left: { lit: 1 }, right: { lit: 2 } },
          as: "在职人数",
        },
      ],
    };
    expect(() =>
      transformDerivedView(named, new Map([["v0", source]]), new Set(["在职人数"])),
    ).toThrow(/与 catalog 标准指标同名/);
    const carriedAlias: DerivedViewSpec = {
      id: "carried_alias",
      view_title: "搬运冒名",
      from: ["v0"],
      columns: [{ col: "ytd_primary_event_rate", source: "v0", as: "YTD主要事件率" }],
    };
    expect(() =>
      transformDerivedView(carriedAlias, new Map([["v0", source]]), new Set(["YTD主要事件率"])),
    ).toThrow(/带时间窗.*明确名称/);
    const textMath: DerivedViewSpec = {
      id: "text_math",
      view_title: "文本算式",
      from: ["v0"],
      columns: [
        {
          expr: {
            op: "+",
            left: { col: "organization_name", source: "v0" },
            right: { lit: 1 },
          },
          as: "错误",
        },
      ],
    };
    expect(() => transformDerivedView(textMath, new Map([["v0", source]]), new Set())).toThrow(
      /不是标准度量.*数值维度/,
    );
  });

  test("空输入也校验算式引用列，拼错列名不能因无行而静默放过", () => {
    const empty = view("空输入", []);
    const spec: DerivedViewSpec = {
      id: "invalid_column",
      view_title: "错误列",
      from: ["v0"],
      columns: [
        {
          expr: {
            op: "+",
            left: { col: "missing", source: "v0" },
            right: { lit: 1 },
          },
          as: "结果",
        },
      ],
    };
    expect(() => transformDerivedView(spec, new Map([["v0", empty]]), new Set())).toThrow(
      /不存在的列.*missing/,
    );
  });

  test("跨事实维度凭规范同名身份 join；不同身份与 measure 键 fail-closed", () => {
    const sources = new Map<string, ViewBlock>([
      ["v0", view("人员", [["A", 0.12]])],
      [
        "v1",
        view("编制", [["A", 0.1]], {
          time: resultTime("2025-01", "2025-06"),
        }),
      ],
    ]);
    const conformed = sourceSemantics(sources, {
      v1: {
        organization_name: {
          alias: "department_headcount_plan_fact.organization_name",
          semanticId: "dimension:organization_name",
        },
      },
    });
    expect(transformDerivedView(YOY, sources, new Set(), conformed).rows[0]?.[1]).toBeCloseTo(0.02);

    const unrelated = sourceSemantics(sources, {
      v1: {
        organization_name: {
          alias: "department_headcount_plan_fact.organization_name",
          semanticId: "dimension:department_name",
        },
      },
    });
    expect(() => transformDerivedView(YOY, sources, new Set(), unrelated)).toThrow(
      /不是同一个一致性维度/,
    );
    expect(() =>
      transformDerivedView(
        {
          ...YOY,
          join: {
            on: [{ left: "ytd_primary_event_rate", right: "ytd_primary_event_rate" }],
            how: "left",
          },
        },
        sources,
        new Set(),
        conformed,
      ),
    ).toThrow(/不是同一个一致性维度/);
  });

  test("异窗 carry 可并排且逐列注记；数值维度与跨时间语义算式拒绝", () => {
    const sources = new Map<string, ViewBlock>([
      ["v0", view("当前快照", [["A", 10]])],
      [
        "v1",
        view("年度流量", [["A", 4]], {
          time: resultTime("2025-01", "2025-12"),
        }),
      ],
    ]);
    const semantics = sourceSemantics(sources, {
      v0: {
        ytd_primary_event_rate: {
          alias: "snapshot.active_employee_count",
          timeEvaluation: "endpoint",
        },
      },
      v1: {
        ytd_primary_event_rate: {
          alias: "flow.new_hire_count",
          timeEvaluation: "interval",
        },
      },
    });
    semantics.get("v0")!.time = atCutoffs("total", "2026-06");
    semantics.get("v1")!.time = overRanges("total", { from: "2025-01", to: "2025-12" });
    const carry: DerivedViewSpec = {
      id: "carry",
      view_title: "并排",
      from: ["v0", "v1"],
      join: { on: [{ left: "organization_name", right: "organization_name" }], how: "left" },
      columns: [
        { col: "organization_name", source: "v0" },
        { col: "ytd_primary_event_rate", source: "v0" },
        { col: "ytd_primary_event_rate", source: "v1", as: "年度入职" },
      ],
    };
    const result = transformDerivedView(carry, sources, new Set(), semantics);
    expect(result.rows).toEqual([["A", 10, 4]]);
    expect(
      result.display_notes?.find(({ member }) => member === "ytd_primary_event_rate"),
    ).toMatchObject({
      title: "YTD主要事件率",
      text: expect.stringContaining("业务期间 2026年6月月末时点"),
    });
    expect(result.display_notes?.find(({ member }) => member === "年度入职")?.text).toContain(
      "业务期间 2025年1月至2025年12月期间",
    );

    const crossSemantics: DerivedViewSpec = {
      ...carry,
      columns: [
        {
          expr: {
            op: "-",
            left: { col: "ytd_primary_event_rate", source: "v0" },
            right: { col: "ytd_primary_event_rate", source: "v1" },
          },
          as: "错误差值",
        },
      ],
    };
    expect(() => transformDerivedView(crossSemantics, sources, new Set(), semantics)).toThrow(
      /混用了 endpoint 与 interval.*模型层/,
    );

    const numericDimension = sourceSemantics(new Map([["v0", sources.get("v0")!]]), {
      v0: { ytd_primary_event_rate: { kind: "dimension", timeEvaluation: undefined } },
    });
    expect(() =>
      transformDerivedView(
        {
          id: "dimension_math",
          view_title: "数值维度算术",
          from: ["v0"],
          columns: [
            {
              expr: {
                op: "+",
                left: { col: "ytd_primary_event_rate", source: "v0" },
                right: { lit: 1 },
              },
              as: "错误",
            },
          ],
        },
        new Map([["v0", sources.get("v0")!]]),
        new Set(),
        numericDimension,
      ),
    ).toThrow(/不是标准度量/);
  });

  test("可比矩阵只放行期末值时点差、区间指标同长期间与两类 YTD 比较", () => {
    const sources = new Map<string, ViewBlock>([
      ["v0", view("本期", [["A", 12]])],
      [
        "v1",
        view("上期", [["A", 10]], {
          time: resultTime("2025-01", "2025-06"),
        }),
      ],
    ]);

    const point = sourceSemantics(sources, {
      v0: { ytd_primary_event_rate: { timeEvaluation: "endpoint" } },
      v1: { ytd_primary_event_rate: { timeEvaluation: "endpoint" } },
    });
    point.get("v0")!.time = atCutoffs("total", "2026-06");
    point.get("v1")!.time = atCutoffs("total", "2025-06");
    expect(transformDerivedView(YOY, sources, new Set(), point).rows[0]?.[1]).toBe(2);

    const differentMeasures = sourceSemantics(sources, {
      v0: {
        ytd_primary_event_rate: {
          timeEvaluation: "endpoint",
          alias: "test_people_metrics.active_employee_count",
        },
      },
      v1: {
        ytd_primary_event_rate: {
          timeEvaluation: "endpoint",
          alias: "test_people_metrics.attrition_count",
        },
      },
    });
    differentMeasures.get("v0")!.time = atCutoffs("total", "2026-06");
    differentMeasures.get("v1")!.time = atCutoffs("total", "2025-06");
    expect(() => transformDerivedView(YOY, sources, new Set(), differentMeasures)).toThrow(
      /混用了不同标准度量.*test_people_metrics\.active_employee_count.*test_people_metrics\.attrition_count/,
    );

    const flow = sourceSemantics(sources, {
      v0: { ytd_primary_event_rate: { timeEvaluation: "interval" } },
      v1: { ytd_primary_event_rate: { timeEvaluation: "interval" } },
    });
    flow.get("v0")!.time = overRanges("total", { from: "2026-01", to: "2026-06" });
    flow.get("v1")!.time = overRanges("total", { from: "2025-01", to: "2025-06" });
    expect(transformDerivedView(YOY, sources, new Set(), flow).rows[0]?.[1]).toBe(2);
    flow.get("v1")!.time = overRanges("total", { from: "2025-01", to: "2025-05" });
    expect(() => transformDerivedView(YOY, sources, new Set(), flow)).toThrow(/时间不可比/);

    const ptd = sourceSemantics(sources);
    ptd.get("v0")!.time = atCutoffs("total", "2026-06");
    ptd.get("v1")!.time = atCutoffs("total", "2026-05");
    expect(transformDerivedView(YOY, sources, new Set(), ptd).rows[0]?.[1]).toBe(2);
    ptd.get("v1")!.time = atCutoffs("total", "2025-12");
    expect(() => transformDerivedView(YOY, sources, new Set(), ptd)).toThrow(/时间不可比/);
  });
});
