import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CubeGateway } from "./ports/cube_gateway.js";
import { parseAnalysisSpec } from "./semantic_core/analysis_spec.js";
import {
  parseAnalysisDefinition,
  type SemanticViewIntent,
} from "./semantic_core/semantic_analysis.js";
import { ExportIncompleteError } from "./application/export_service.js";
import { semanticAnalysisOf } from "./test_support/report.js";
import { createTestAppDatabase } from "./test_support/app_database.js";
import { TEST_SEMANTIC_TAXONOMY } from "./test_support/semantic_taxonomy.js";
import { canonicalModelFixture } from "./test_support/canonical_semantic_model.js";

type JsonObject = Record<string, unknown>;

function findJsonObject(
  value: unknown,
  predicate: (candidate: JsonObject) => boolean,
): JsonObject | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonObject(item, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as JsonObject;
  if (predicate(candidate)) return candidate;
  for (const child of Object.values(candidate)) {
    const found = findJsonObject(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function mcpToolError(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("MCP 工具错误缺少 content");
  }
  const toolResult = result as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  expect(toolResult.isError).toBe(true);
  const content = toolResult.content[0];
  if (content?.type !== "text" || content.text === undefined) {
    throw new Error("MCP 工具错误必须以 JSON 文本交付");
  }
  return JSON.parse(content.text) as Record<string, unknown>;
}

const query = (id: string, at = "2026-07") => ({
  id,
  view_title: `查询结果 ${id}`,
  measures: ["test_people_metrics.active_employee_count"],
  dimensions: ["test_people_metrics.organization_name"],
  time: { cutoff: at },
});

describe("AnalysisSpec", () => {
  test("使用稳定 view id 表达查询与派生关系", () => {
    const spec = parseAnalysisSpec({
      title: "同比分析",
      views: [
        query("current"),
        query("previous", "2025-07"),
        {
          id: "comparison",
          view_title: "同比变化",
          from: ["current", "previous"],
          join: { on: [{ left: "organization_name", right: "organization_name" }], how: "left" },
          columns: [
            { col: "organization_name", source: "current" },
            {
              expr: {
                op: "-",
                left: { col: "active_employee_count", source: "current" },
                right: { col: "active_employee_count", source: "previous" },
              },
              as: "同比变化",
            },
          ],
        },
      ],
    });
    expect(spec.views.map((view) => view.id)).toEqual(["current", "previous", "comparison"]);
  });

  test("拒绝重复、位置引用、派生串联和无效 join", () => {
    expect(() => parseAnalysisSpec({ views: [query("same"), query("same")] })).toThrow(/重复/);
    expect(() =>
      parseAnalysisSpec({
        views: [query("current"), { id: "derived", view_title: "派生", from: [0], columns: [] }],
      }),
    ).toThrow(/分析规格无效/);
    const derived = {
      id: "first",
      view_title: "一层派生",
      from: ["current"],
      columns: [{ col: "active_employee_count", source: "current" }],
    };
    expect(() =>
      parseAnalysisSpec({
        views: [
          query("current"),
          derived,
          {
            id: "second",
            view_title: "二层派生",
            from: ["first"],
            columns: [{ col: "active_employee_count", source: "first" }],
          },
        ],
      }),
    ).toThrow(/只能直接引用查询视图/);
    expect(() =>
      parseAnalysisSpec({
        views: [
          query("current"),
          {
            ...derived,
            join: {
              on: [{ left: "organization_name", right: "organization_name" }],
              how: "left",
            },
          },
        ],
      }),
    ).toThrow(/不能声明 join/);
  });

  test("只有被派生结果引用的查询才强制业务标题，且不允许以内部 id 兜底", () => {
    expect(() =>
      parseAnalysisSpec({
        views: [
          {
            id: "source",
            measures: ["test_people_metrics.active_employee_count"],
            time: { cutoff: "2026-07" },
          },
          {
            id: "result",
            view_title: "结果",
            from: ["source"],
            columns: [{ col: "active_employee_count", source: "source" }],
          },
        ],
      }),
    ).toThrow(/来源查询.*业务标题/);
    expect(() =>
      parseAnalysisSpec({
        views: [
          {
            id: "standalone",
            measures: ["test_people_metrics.active_employee_count"],
            time: { cutoff: "2026-07" },
          },
        ],
      }),
    ).not.toThrow();
  });

  test("执行图必须恰好收敛到一个结果，多余顶层字段一律拒绝", () => {
    expect(() =>
      parseAnalysisSpec({
        views: [query("current"), query("previous", "2025-07")],
      }),
    ).toThrow(/执行图必须恰好收敛到一个结果/);
    expect(() => parseAnalysisSpec({ views: [query("current")], outputs: ["current"] })).toThrow(
      /分析规格无效/,
    );
  });

  test("grouping-set 的语义绑定只能引用查询自身的维度与指标", () => {
    const base = {
      ...query("shares"),
      grouping_sets: {
        base: [
          {
            id: "dimension:organization_name",
            member: "test_people_metrics.unknown_dimension",
          },
        ],
      },
    };
    expect(() => parseAnalysisSpec({ views: [base] })).toThrow(
      /基础分组集的物理绑定必须属于查询 dimensions/,
    );
    expect(() =>
      parseAnalysisSpec({
        views: [
          {
            ...base,
            grouping_sets: {
              base: [
                {
                  id: "dimension:organization_name",
                  member: "test_people_metrics.organization_name",
                },
              ],
              calculations: [
                {
                  kind: "grouping_share",
                  id: "calculation:organization_share",
                  title: "组织占比",
                  measure: "test_people_metrics.unknown_measure",
                  category_dimension: "dimension:organization_name",
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(/grouping-set 计算的基础指标必须属于查询 measures/);
  });
});

test("MCP 暴露完整工具面和首版 Apps 资源", async () => {
  const [
    { Client },
    { InMemoryTransport },
    { createApplication },
    { buildServer },
    {
      SERVER_INSTRUCTIONS,
      TOOL_DESCRIPTIONS,
      OPENAI_WIDGET_CSP,
      UI_RESOURCE_META,
      UI_RESOURCE_URI,
      RECORDS_UI_RESOURCE_URI,
    },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
    import("./composition/application.js"),
    import("./server.js"),
    import("./mcp/contracts.js"),
  ]);
  const client = new Client({
    name: "pa-tool-metadata-test",
    version: "0.1.0",
  });
  const baseAnalysisId = "22222222-2222-4222-8222-222222222222";
  const rerunViewId = "33333333-3333-4333-8333-333333333333";
  const appliedPivotAnalysisId = "44444444-4444-4444-8444-444444444444";
  const appliedPivotViewId = "44444444-4444-4444-9444-444444444444";
  const unavailablePivotAnalysisId = "55555555-5555-4555-8555-555555555555";
  const unavailablePivotViewId = "55555555-5555-4555-9555-555555555555";
  const rendered = semanticAnalysisOf({ views: [query("result")] });
  // 执行器解析出的物理呈现（声明一张 bar 图）：驱动 rerun_analysis 的降级说明。
  const renderedPresentation = {
    type: "bar" as const,
    x: "organization_name",
    y: ["active_employee_count"],
  };
  const db = createTestAppDatabase(join(tmpdir(), `pa_server_${randomUUID()}.db`));
  const cube: CubeGateway = {
    meta: async () => [],
    load: async () => ({
      data: [],
      annotation: { measures: {}, dimensions: {} },
    }),
    loadMulti: async () => [],
    sql: async () => [],
    timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
  };
  const canonical = canonicalModelFixture(
    [
      {
        name: "test_metrics",
        title: "测试指标执行面",
        meta: {
          query_surface: "metric_source",
          time_source: "workforce",
          observation_scope: "统计范围：测试。",
        },
        measures: [],
        dimensions: [],
      },
    ],
    TEST_SEMANTIC_TAXONOMY,
  );
  const application = createApplication({
    db,
    cube,
    visibilityCube: cube,
    canonical,
    baseUrl: "http://127.0.0.1:8788",
  });
  const executedAnalysis = (viewId: string, analysisId = baseAnalysisId) => {
    const view = {
      id: "result",
      columns: ["organization_name", "active_employee_count"],
      column_roles: {
        organization_name: "dimension" as const,
        active_employee_count: "measure" as const,
      },
      column_time_basis: { active_employee_count: "bucket_end" as const },
      column_formats: { active_employee_count: "number" as const },
      rows: [],
      row_count: 0,
      time: {
        grain: "total" as const,
        coordinates: [{ role: "primary" as const, from: "2026-07", to: "2026-07" }],
        buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
      },
      query_notes: [
        {
          member: "test_people_metrics.organization_name",
          title: "组织",
          text: "组织口径",
        },
        {
          member: "test_people_metrics.active_employee_count",
          title: "在职人数",
          text: "在职口径",
        },
      ],
    };
    return {
      analysis_id: analysisId,
      view_id: viewId,
      definition: rendered.analysis,
      intent: rendered.view,
      preferences: {},
      presentation: renderedPresentation,
      payload: {
        analysis_id: analysisId,
        view_id: viewId,
        observation_scopes: ["统计范围"],
        data_as_of: "2026-07",
        time_context: [],
        view,
      },
      fullRowViewBlock: view,
      decl: renderedPresentation,
      record_projection_bindings: { views: [] },
    };
  };
  const pivotDefinition = {
    query: {
      measures: ["measure:active_employee_count"],
      dimensions: ["dimension:organization_name", "dimension:department_name"],
      time: { window: { kind: "current_month" as const, month: "2026-07" } },
    },
  };
  const pivotIntent = (columnAxis: string) => ({
    type: "table" as const,
    columns: [columnAxis],
  });
  const executedPivot = (analysisId: string, viewId: string, intent: SemanticViewIntent) => {
    const declaredAxis = intent.type === "table" ? intent.columns?.[0] : undefined;
    const columnAxis =
      declaredAxis === "dimension:organization_name" ? "organization_name" : "department_name";
    const view = {
      id: "result",
      columns: ["organization_name", "department_name", "active_employee_count"],
      column_formats: { active_employee_count: "number" as const },
      column_time_basis: { active_employee_count: "bucket_end" as const },
      column_roles: {
        organization_name: "dimension" as const,
        department_name: "dimension" as const,
        active_employee_count: "measure" as const,
      },
      rows:
        columnAxis === "organization_name"
          ? [
              ["公司", "研发", 10],
              ["公司", "研发", 8],
            ]
          : [
              ["公司", "研发", 10],
              ["公司", "销售", 8],
            ],
      row_count: 2,
      time: {
        grain: "total" as const,
        coordinates: [{ role: "primary" as const, from: "2026-07", to: "2026-07" }],
        buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
      },
      query_notes: [
        { member: "dimension:organization_name", title: "一级组织", text: "一级组织。" },
        { member: "dimension:department_name", title: "二级组织", text: "二级组织。" },
        { member: "measure:active_employee_count", title: "在职人数", text: "在职人数。" },
      ],
    };
    const tableColumns = [
      { kind: "field" as const, column: columnAxis },
      { kind: "metrics" as const },
    ];
    return {
      analysis_id: analysisId,
      view_id: viewId,
      definition: pivotDefinition,
      intent,
      preferences: {},
      presentation: { type: "table" as const, tableColumns },
      payload: {
        analysis_id: analysisId,
        view_id: viewId,
        observation_scopes: ["统计范围"],
        data_as_of: "2026-07",
        time_context: [],
        view,
      },
      fullRowViewBlock: view,
      decl: { type: "table" as const, tableColumns },
      record_projection_bindings: { views: [] },
    };
  };
  const ownershipChecks: string[] = [];
  const replayed: string[] = [];
  const projected: { analysisId: string; metricId?: string; offset?: number }[] = [];
  application.recordProjection.runAnalysis = async (_principal, id, options = {}) => {
    projected.push({
      analysisId: id,
      ...(options.metricId ? { metricId: options.metricId } : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
    });
    return {
      metric_id: options.metricId ?? "measure:active_employee_count",
      metric_title: "在职人数",
      record_set_title: "在职员工",
      record_set_description: "所选业务时点构成在职人数的员工快照记录。",
      columns: ["员工编号", "姓名"],
      column_keys: ["employee_id", "employee_name"],
      rows: [["e_001", "张三"]],
      offset: options.offset ?? 0,
      page_size: options.limit ?? 20,
      has_more: false,
      data_as_of: "2026-07",
      data_changed: false,
    };
  };
  const server = buildServer({
    principal: { email: "test@x", roles: ["admin"], accessScope: { kind: "all" } },
    dependencies: {
      analysis: {
        run: async (_principal, definition, intent) => {
          parseAnalysisDefinition(definition);
          if (intent.type !== "table") throw new Error("本测试桩只执行表格呈现");
          const declared = intent.columns?.[0];
          return executedPivot(
            declared === "dimension:organization_name"
              ? unavailablePivotAnalysisId
              : appliedPivotAnalysisId,
            declared === "dimension:organization_name"
              ? unavailablePivotViewId
              : appliedPivotViewId,
            intent,
          );
        },
        rerun: async () => executedAnalysis(rerunViewId),
        replay: async (_principal, id) => {
          replayed.push(id);
          return executedAnalysis(id);
        },
        ensureOwned: async (_principal, id) => {
          ownershipChecks.push(id);
        },
      },
      presentation: application.presentation,
      catalog: application.catalog,
      records: application.recordProjection,
      reports: application.report,
      exports: application.export,
      feedback: application.feedback,
      usage: application.usage,
      baseUrl: "http://127.0.0.1:8788",
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "catalog",
        "export_result",
        "feedback",
        "find_report",
        "load_analysis_card",
        "load_analysis_result",
        "load_records_page",
        "rerun_analysis",
        "run_analysis",
        "save_report",
        "show_analysis",
        "show_records",
        "update_report",
        "values_of",
      ].sort(),
    );
    for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
      expect(listed.tools.find((candidate) => candidate.name === name)?.description).toBe(
        description,
      );
      expect(description.length).toBeLessThanOrEqual(100);
    }
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(260);
    expect(SERVER_INSTRUCTIONS).toContain("time.constraints");
    expect(SERVER_INSTRUCTIONS).toContain("query_capabilities");
    expect(TOOL_DESCRIPTIONS.run_analysis).toContain("code/details");
    expect(TOOL_DESCRIPTIONS.run_analysis).toContain("错误 JSON");
    // 客户端只按 input schema 组装参数，把 view 嵌进 analysis 是实测中最常见的错法，
    // 平级这件事必须写在两个属性的描述里才到得了模型。
    const runSchema = listed.tools.find((candidate) => candidate.name === "run_analysis")
      ?.inputSchema as { properties: Record<string, { description?: string }> };
    expect(runSchema.properties.analysis.description).toContain("与 view 平级");
    expect(runSchema.properties.view.description).toContain("不嵌在 analysis 内");
    expect(UI_RESOURCE_URI).toBe("ui://pa/result.html");
    expect(RECORDS_UI_RESOURCE_URI).toBe("ui://pa/records.html");
    expect(UI_RESOURCE_META).toEqual({
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: [] },
    });
    expect(OPENAI_WIDGET_CSP).toEqual({
      connect_domains: [],
      resource_domains: [],
    });
    const tools = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
    const runAnalysisInput = JSON.stringify(tools.run_analysis?.inputSchema);
    expect(runAnalysisInput).toContain('"previous_period"');
    expect(runAnalysisInput).toContain('"previous_year"');
    expect(runAnalysisInput).toContain('"custom"');
    expect(runAnalysisInput).not.toContain('"previous_years"');
    expect(runAnalysisInput).not.toContain('"years_ago"');
    expect(runAnalysisInput).not.toContain('"alignment"');
    expect(runAnalysisInput).not.toContain('"windows"');
    // 客户端只拿得到这份 JSON Schema：形状表达不出的约束，调用方在本地就无法自愈。
    const analysisSchema = findJsonObject(tools.run_analysis?.inputSchema, (candidate) => {
      const properties = candidate.properties;
      return typeof properties === "object" && properties !== null && "derived" in properties;
    });
    const analysisProperties = analysisSchema?.properties as JsonObject;
    // 结果只有一个，所以只有一个查询字段；第二个查询只长在 derived.joined 上。
    expect(Object.keys(analysisProperties).sort()).toEqual(["derived", "query", "title"]);
    expect(analysisSchema?.required).toEqual(["query"]);
    expect(analysisSchema?.additionalProperties).toBe(false);
    // 查询节点不是联合：客户端报错能落到具体字段，而不是「不匹配任何分支」。
    expect(analysisProperties.query).not.toHaveProperty("anyOf");
    const derivedProperties = (analysisProperties.derived as JsonObject).properties as JsonObject;
    const joinedSchema = derivedProperties.joined as JsonObject;
    // 第二个查询与它的关联合同同生共死：joined 三个键一起必填。
    expect((joinedSchema.required as string[]).sort()).toEqual(["how", "on", "query"]);
    // 来源角色是闭集：写错来源名在客户端本地就能判定。
    const operandSchema = findJsonObject(tools.run_analysis?.inputSchema, (candidate) => {
      const properties = candidate.properties;
      return (
        typeof properties === "object" &&
        properties !== null &&
        "member" in properties &&
        "source" in properties
      );
    });
    const operandProperties = operandSchema?.properties as JsonObject;
    expect(operandProperties.source).toMatchObject({ enum: ["query", "joined"] });
    const tableColumnsSchema = findJsonObject(tools.run_analysis?.inputSchema, (candidate) => {
      const items = candidate.items;
      return (
        typeof candidate.description === "string" &&
        candidate.description.startsWith("table 专用有序列轴") &&
        typeof items === "object" &&
        items !== null
      );
    });
    const columnItems = tableColumnsSchema?.items as JsonObject;
    const columnPattern = new RegExp(columnItems.pattern as string);
    expect(columnPattern.test("time")).toBe(true);
    expect(columnPattern.test("dimension:organization_name")).toBe(true);
    expect(columnPattern.test("measure:active_employee_count")).toBe(false);

    const filterSchema = findJsonObject(tools.run_analysis?.inputSchema, (candidate) => {
      const properties = candidate.properties;
      return (
        typeof properties === "object" &&
        properties !== null &&
        "member" in properties &&
        "relation" in properties &&
        "values" in properties
      );
    });
    expect(filterSchema?.required).toEqual(["member", "relation", "values"]);
    const filterProperties = filterSchema?.properties as JsonObject;
    expect(filterProperties.relation).toMatchObject({
      enum: ["one_of", "none_of"],
      description: "one_of 保留值属于给定集合的记录；none_of 排除值属于给定集合的记录",
    });
    expect(filterProperties.values).toMatchObject({
      minItems: 1,
      description: "要包含或排除的真实分类值；至少一项，多项按集合处理",
    });
    expect(filterSchema).not.toHaveProperty("properties.operator");
    const groupSortSchema = findJsonObject(tools.run_analysis?.inputSchema, (candidate) => {
      const properties = candidate.properties;
      return (
        typeof properties === "object" &&
        properties !== null &&
        "dimension" in properties &&
        "by" in properties &&
        "direction" in properties &&
        "max_items" in properties
      );
    });
    expect(groupSortSchema?.required).toEqual(["dimension", "by", "direction"]);
    const groupSortProperties = groupSortSchema?.properties as JsonObject;
    expect(groupSortProperties.by).toMatchObject({
      description: "排序依据；name 表示按分组名称，指标 id 表示按该指标数值",
    });
    expect(groupSortProperties.max_items).toMatchObject({
      maximum: 20,
      description: "最多保留的完整分组数量；省略即展示全部分组，不做 Top-N 截取",
    });
    expect(runAnalysisInput).toContain('"group_sort"');
    expect(runAnalysisInput).not.toContain('"selection"');
    const rerunAnalysisInput = JSON.stringify(tools.rerun_analysis?.inputSchema);
    for (const humanOnlyField of [
      "color",
      "mark",
      "axis",
      "value_labels",
      "table_shading",
      "shading",
      "palette",
    ]) {
      expect(runAnalysisInput).not.toContain(`"${humanOnlyField}"`);
      expect(rerunAnalysisInput).not.toContain(`"${humanOnlyField}"`);
    }
    for (const name of ["run_analysis", "rerun_analysis"]) {
      expect(tools[name]?._meta?.ui).toBeUndefined();
      expect(tools[name]?._meta?.["openai/outputTemplate"]).toBeUndefined();
      expect(tools[name]?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
    expect(tools.show_analysis?.annotations?.readOnlyHint).toBe(true);
    expect(tools.show_analysis?._meta?.ui).toEqual({
      resourceUri: UI_RESOURCE_URI,
      visibility: ["model"],
    });
    expect(tools.show_analysis?._meta?.["openai/outputTemplate"]).toBe(UI_RESOURCE_URI);
    expect(tools.load_analysis_result?._meta?.ui).toEqual({ visibility: ["model"] });
    expect(tools.load_analysis_card?._meta?.ui).toEqual({ visibility: ["app"] });
    expect(tools.load_analysis_result?._meta?.["ui/resourceUri"]).toBeUndefined();
    expect(tools.show_records?._meta?.ui).toEqual({
      resourceUri: RECORDS_UI_RESOURCE_URI,
      visibility: ["model"],
    });
    expect(tools.show_records?._meta?.["openai/outputTemplate"]).toBe(RECORDS_UI_RESOURCE_URI);
    expect(tools.load_records_page?._meta?.ui).toEqual({ visibility: ["app"] });
    const appliedPivot = await client.callTool({
      name: "run_analysis",
      arguments: {
        analysis: pivotDefinition,
        view: pivotIntent("dimension:department_name"),
      },
    });
    expect(appliedPivot.structuredContent).toMatchObject({
      analysis_id: appliedPivotAnalysisId,
      view_id: appliedPivotViewId,
    });
    expect(appliedPivot.structuredContent).not.toHaveProperty("presentation_notes");
    expect(appliedPivot._meta?.["ai.pa/presentation"]).toMatchObject({
      type: "table",
    });

    const unavailablePivot = await client.callTool({
      name: "run_analysis",
      arguments: {
        analysis: pivotDefinition,
        view: pivotIntent("dimension:organization_name"),
      },
    });
    expect(unavailablePivot.structuredContent).toMatchObject({
      analysis_id: unavailablePivotAnalysisId,
      view_id: unavailablePivotViewId,
      presentation_notes: [
        {
          result_view_id: "result",
          kind: "unsupported_shape",
          note: expect.stringContaining("表格布局未生效"),
        },
      ],
    });
    expect(unavailablePivot._meta?.["ai.pa/presentation"]).toMatchObject({
      type: "table",
    });

    const rendered = await client.callTool({
      name: "rerun_analysis",
      arguments: {
        analysis_id: baseAnalysisId,
        view: {
          type: "bar",
          category: "dimension:organization_name",
        },
      },
    });
    expect(rendered.structuredContent).toMatchObject({
      analysis_id: baseAnalysisId,
      view_id: rerunViewId,
      presentation_notes: [
        {
          result_view_id: "result",
          kind: "empty_result",
          note: expect.stringContaining("结果为空"),
        },
      ],
    });
    const shown = await client.callTool({
      name: "show_analysis",
      arguments: { view_id: rerunViewId },
    });
    expect(shown.structuredContent).toEqual({ view_id: rerunViewId });
    expect(ownershipChecks).toEqual([rerunViewId]);
    const loaded = await client.callTool({
      name: "load_analysis_result",
      arguments: { view_id: rerunViewId },
    });
    expect(loaded.structuredContent).toMatchObject({
      analysis_id: baseAnalysisId,
      view_id: rerunViewId,
      analysis: executedAnalysis(rerunViewId).definition,
      view_intent: executedAnalysis(rerunViewId).intent,
    });
    expect(replayed).toEqual([rerunViewId]);
    const records = await client.callTool({
      name: "show_records",
      arguments: { view_id: rerunViewId, metric_id: "measure:active_employee_count" },
    });
    expect(records.content).toEqual([{ type: "text", text: "构成记录已打开。" }]);
    expect(records.structuredContent).toEqual({
      view_id: rerunViewId,
      metric_id: "measure:active_employee_count",
      metric_title: "在职人数",
      record_set_title: "在职员工",
      record_set_description: "所选业务时点构成在职人数的员工快照记录。",
      offset: 0,
      displayed_records: 1,
      has_more: false,
      data_as_of: "2026-07",
      data_changed: false,
    });
    expect(JSON.stringify(records.structuredContent)).not.toContain("张三");
    expect(records._meta?.["ai.pa/record-projection"]).toMatchObject({
      rows: [["e_001", "张三"]],
    });
    expect(projected).toEqual([
      { analysisId: rerunViewId, metricId: "measure:active_employee_count" },
    ]);
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual(
      [UI_RESOURCE_URI, RECORDS_UI_RESOURCE_URI].sort(),
    );
    const templates = await client.listResourceTemplates();
    expect(
      templates.resourceTemplates.find(
        (candidate) => candidate.uriTemplate === "pa://export/{ticket}",
      )?.mimeType,
    ).toBe("text/csv; charset=utf-8");

    const invalidAnalysis = await client.callTool({
      name: "run_analysis",
      arguments: {
        analysis: { queries: [pivotDefinition.query, pivotDefinition.query] },
        view: { type: "table" },
      },
    });
    // 并列查询在工具协议层就被拒：这层的文案也必须指路，服务端根本收不到这次调用。
    expect(invalidAnalysis).not.toHaveProperty("structuredContent");
    expect(invalidAnalysis).toMatchObject({ isError: true });
    expect(JSON.stringify(invalidAnalysis)).toContain("query.measures");
    expect(JSON.stringify(invalidAnalysis)).toContain("derived.joined");

    // 形状之内、语义之外的错法仍由服务端拒绝，并保持 isError + JSON 错误信封。
    const danglingSource = await client.callTool({
      name: "run_analysis",
      arguments: {
        analysis: {
          query: { ...pivotDefinition.query, view_title: "来源" },
          derived: {
            view_title: "结果",
            columns: [
              { source: "joined", member: "measure:active_employee_count", as: "headcount" },
            ],
          },
        },
        view: { type: "table" },
      },
    });
    expect(danglingSource).not.toHaveProperty("structuredContent");
    expect(mcpToolError(danglingSource)).toEqual({
      error: {
        code: "invalid_request",
        message: expect.stringContaining("没有声明 derived.joined"),
      },
    });

    application.export.readResource = async () => {
      throw new ExportIncompleteError(100_000);
    };
    await expect(client.readResource({ uri: "pa://export/test-ticket" })).rejects.toThrow(
      "请增加过滤条件后重新导出",
    );
  } finally {
    await client.close();
  }
});
