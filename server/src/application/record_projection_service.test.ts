import { expect, test } from "bun:test";
import {
  buildCatalogDocument as buildRawCatalogDocument,
  toCompilerCatalog,
  type CatalogDocument,
} from "../engine/catalog_document.js";
import type { Principal } from "../contracts/principal.js";
import type { CubeGateway, CubeQuery, CubeView, LoadResponse } from "../ports/cube_gateway.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { compileAnalysisView } from "../engine/semantic_analysis_compiler.js";
import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import { createRecordProjectionService } from "./record_projection_service.js";
import {
  TEST_SEMANTIC_TAXONOMY,
  TEST_TIME_SOURCE_REGISTRY,
} from "../test_support/semantic_taxonomy.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import type { CompiledAnalysisView } from "../engine/semantic_analysis_compiler.js";
import type { AuthorizedAnalysisPlan } from "./semantic_planning_service.js";
import { NotFoundError } from "./errors.js";

const buildCatalogDocument = (views: CubeView[]) =>
  buildRawCatalogDocument(views, TEST_SEMANTIC_TAXONOMY, TEST_TIME_SOURCE_REGISTRY, {
    id: "test_scope",
    title: "测试数据范围",
  });

const principal: Principal = {
  email: "viewer@example.com",
  roles: ["user"],
  accessScope: { kind: "limited", values: ["研发"] },
};

const test_people_metrics: CubeView = {
  name: "test_people_metrics",
  title: "人员总览",
  description: "人员总览指标。",
  meta: {
    query_surface: "detail",
    time_source: "workforce",
    observation_scope: "测试人群口径。",
    record_sets: {
      employee: {
        title: "员工记录",
        description: "构成指标结果的员工记录。",
        record_key: "record_key",
        entity_key: "employee_id",
        fields: [
          { member: "employee_id" },
          { member: "employee_name" },
          { member: "record_date", title: "记录日期" },
          { member: "organization_name" },
        ],
        entity_order: [
          { member: "record_date", direction: "desc" },
          { member: "record_key", direction: "desc" },
        ],
      },
    },
  },
  measures: [
    {
      name: "test_people_metrics.active_employee_count",
      title: "在职人数",
      shortTitle: "在职人数",
      description: "所选月末仍在职的员工人数。",
      type: "number",
      aggType: "count",
      meta: {
        metric_domain_id: "metric_domain:workforce_structure",
        time_contract: { aggregation: "last", window: "selected" },
        underlying_records: {
          record_set: "employee",
          selection: { kind: "self" },
        },
      },
    },
    {
      name: "test_people_metrics.ytd_event_count",
      title: "YTD事件数",
      description: "年初至截止月累计事件数。",
      type: "number",
      aggType: "count",
      meta: {
        metric_domain_id: "metric_domain:workforce_movement",
        time_contract: { aggregation: "sum", window: "year_to_date" },
        underlying_records: {
          record_set: "employee",
          selection: { kind: "self" },
        },
      },
    },
    {
      name: "test_people_metrics.unique_event_count",
      title: "YTD去重事件数",
      description: "年初至截止月累计事件数，按员工去重。",
      type: "number",
      aggType: "countDistinct",
      meta: {
        metric_domain_id: "metric_domain:workforce_movement",
        time_contract: { aggregation: "sum", window: "year_to_date" },
        underlying_records: {
          record_set: "employee",
          selection: { kind: "self" },
        },
      },
    },
    {
      name: "test_people_metrics.ytd_average_base",
      title: "YTD月均基数",
      description: "年初至截止月月均基数。",
      type: "number",
      aggType: "number",
      meta: {
        metric_domain_id: "metric_domain:workforce_movement",
        time_contract: { aggregation: "average", window: "year_to_date" },
      },
    },
    {
      name: "test_people_metrics.ytd_event_rate",
      title: "YTD事件率",
      description: "YTD事件数除以YTD月均基数。",
      type: "number",
      aggType: "number",
      format: "percent",
      meta: {
        metric_domain_id: "metric_domain:workforce_movement",
        time_contract: { aggregation: "recompute", window: "year_to_date" },
        components: {
          numerator: "ytd_event_count",
          denominator: "ytd_average_base",
        },
        underlying_records: {
          record_set: "employee",
          selection: { kind: "numerator" },
        },
      },
    },
  ],
  dimensions: [
    {
      name: "test_people_metrics.organization_name",
      title: "组织",
      shortTitle: "组织",
      description: "员工所属组织。",
      type: "string",
      meta: {},
    },
  ],
  internalDimensions: [
    { name: "test_people_metrics.record_key", title: "行键", type: "string" },
    { name: "test_people_metrics.employee_id", title: "员工编号", type: "string" },
    { name: "test_people_metrics.employee_name", title: "姓名", type: "string" },
    { name: "test_people_metrics.record_date", title: "事件日期", type: "time" },
    { name: "test_people_metrics.record_type", title: "事件类型", type: "string" },
  ],
};

const workforce_metrics: CubeView = {
  name: "workforce_metrics",
  title: "人员指标",
  description: "人员总览指标。",
  meta: {
    query_surface: "metric_source",
    time_source: "workforce",
    observation_scope: "测试人群口径。",
  },
  measures: test_people_metrics.measures.map((member) => ({
    ...member,
    name: member.name.replace("test_people_metrics.", "workforce_metrics."),
    ...(member.aliasMember
      ? {
          aliasMember: member.aliasMember.replace("test_people_metrics.", "workforce_metrics."),
        }
      : {}),
  })),
  dimensions: test_people_metrics.dimensions.map((member) => ({
    ...member,
    name: member.name.replace("test_people_metrics.", "workforce_metrics."),
    ...(member.aliasMember
      ? {
          aliasMember: member.aliasMember.replace("test_people_metrics.", "workforce_metrics."),
        }
      : {}),
  })),
  internalDimensions: [],
};

const fixtureViews = [workforce_metrics, test_people_metrics];
const authorizedPlan = (
  compiled: CompiledAnalysisView,
  document: CatalogDocument,
  caller: Principal = principal,
): AuthorizedAnalysisPlan => ({
  ...compiled,
  access: {
    principal: caller,
    cubeContext: cubeSecurityContext(caller),
    views: fixtureViews,
    compiler: toCompilerCatalog(document),
    time_sources: TEST_TIME_SOURCE_REGISTRY,
    timeContext: {
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    },
  },
});
const noBoards = {
  get: async () => {
    throw new NotFoundError("看板不存在");
  },
} as never;
const currentMonth = (anchor: string) => ({
  window: { kind: "current_month" as const, month: anchor },
});

type AnalysisViewFixture = {
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
};

const STORED_VIEW_ID = "stored_view";
function analysisServiceOf(
  fixture: AnalysisViewFixture,
  analysisId = "analysis_1",
  viewId = STORED_VIEW_ID,
) {
  const analysis = {
    id: analysisId,
    owner: principal.email,
    definition: fixture.analysis,
    created_at: "2026-07-01T00:00:00.000Z",
  };
  const view = {
    id: viewId,
    analysis_id: analysisId,
    intent: fixture.view,
    preferences: {},
    created_at: "2026-07-01T00:00:00.000Z",
  };
  return {
    resolveOwnedView: async () => ({ analysis, view }),
  } as never;
}

function reportDocumentOf(fixture: AnalysisViewFixture, revision: number) {
  return {
    revision,
    definition: fixture.analysis,
    intent: fixture.view,
    view_preferences: {},
  } as never;
}

const spec: AnalysisViewFixture = {
  analysis: {
    views: [
      {
        id: "result",
        measures: ["measure:active_employee_count"],
        dimensions: ["dimension:organization_name"],
        time: currentMonth("2026-07"),
      },
    ],
  },
  view: { type: "table" },
};

const rateSpec: AnalysisViewFixture = {
  ...spec,
  analysis: {
    views: [
      {
        ...spec.analysis.views[0],
        measures: ["measure:ytd_event_rate"],
      },
    ],
  },
};

test("记录投影按当前身份重编译，保留格子坐标并在 Cube 内过滤贡献记录", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const compiled = compileAnalysisView(toCompilerCatalog(document), spec);
  const seen: CubeQuery[] = [];
  const load = async (query: CubeQuery): Promise<LoadResponse> => {
    seen.push(query);
    const dimensions = query.dimensions ?? [];
    const employees = [
      ["e_05", "王五"],
      ["e_06", "赵六"],
      ["e_07", "钱七"],
    ];
    return {
      data: employees.map(([id, name]) =>
        Object.fromEntries([
          ...dimensions.map((member) => {
            const short = memberShortName(member);
            const value =
              short === "record_key"
                ? `${id}|snapshot`
                : short === "employee_id"
                  ? id
                  : short === "employee_name"
                    ? name
                    : short === "organization_name"
                      ? "研发"
                      : null;
            return [member, value];
          }),
          ["test_people_metrics.active_employee_count", 1],
        ]),
      ),
      annotation: {
        measures: { "test_people_metrics.active_employee_count": { title: "在职人数" } },
        dimensions: Object.fromEntries(
          dimensions.map((member) => {
            const title =
              {
                record_key: "记录键",
                employee_id: "工号",
                employee_name: "姓名",
                record_date: "记录日期",
                organization_name: "组织",
              }[member.split(".").at(-1) ?? ""] ?? member;
            return [member, { title: `人员总览 ${title}` }];
          }),
        ),
      },
    };
  };
  const cube = {
    meta: async () => fixtureViews,
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load,
    loadMulti: async () => Promise.reject(new Error("不应执行多窗")),
  } as unknown as CubeGateway;
  const audit: unknown[] = [];
  const compiledDefinitions: AnalysisDefinition[] = [];
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(spec, 3),
      get: async () => reportDocumentOf(spec, 3),
    } as never,
    boards: {
      get: async (id: string) =>
        id === "board_1"
          ? { tiles: [{ kind: "report", report_id: "report_1" }] }
          : Promise.reject(new NotFoundError("看板不存在")),
    } as never,
    analyses: analysisServiceOf(spec),
    semanticPlanning: {
      plan: async (_principal: Principal, effectiveDefinition: AnalysisDefinition) => {
        compiledDefinitions.push(effectiveDefinition);
        return authorizedPlan(compiled, document, _principal);
      },
    } as never,
    cube,
    audit: { log: async (event: unknown) => void audit.push(event) },
  });

  const result = await service.runReport(principal, "report_1", {
    revision: 3,
    result_view_id: "result",
    metric_id: "measure:active_employee_count",
    coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
    time_coordinate: { from: "2026-07", to: "2026-07" },
    data_as_of: "2026-06",
    offset: 4,
    limit: 2,
  });

  expect(result.rows).toHaveLength(2);
  expect(result.record_set_title).toBe("员工记录");
  expect(result.rows[0].slice(0, 2)).toEqual(["e_07", "钱七"]);
  expect(result.columns).toEqual(["工号", "姓名", "记录日期", "组织"]);
  expect(result.has_more).toBe(true);
  expect(result.data_changed).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].offset).toBe(4);
  expect(seen[0].limit).toBe(3);
  expect(seen[0].filters).toEqual(
    expect.arrayContaining([
      {
        member: "test_people_metrics.organization_name",
        operator: "equals",
        values: ["研发"],
      },
      { member: "test_people_metrics.active_employee_count", operator: "gt", values: ["0"] },
    ]),
  );
  expect(seen[0].dimensions).toEqual(
    expect.arrayContaining([
      "test_people_metrics.record_key",
      "test_people_metrics.employee_id",
      "test_people_metrics.employee_name",
    ]),
  );
  expect(seen[0].timeDimensions?.[0].dateRange).toEqual(["2026-07-01", "2026-07-31"]);
  expect(audit).toEqual([
    expect.objectContaining({
      outcome: "ok",
      caller: principal.email,
      source: { kind: "report", id: "report_1", revision: 3 },
      row_count: 2,
    }),
  ]);

  const boardResult = await service.runBoard(
    principal,
    "board_1",
    "report_1",
    {
      revision: 3,
      result_view_id: "result",
      metric_id: "measure:active_employee_count",
      coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
      time_coordinate: { from: "2026-06", to: "2026-06" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 1,
    },
    currentMonth("2026-06"),
  );
  expect(boardResult.rows).toHaveLength(1);
  const effectiveView = compiledDefinitions.at(-1)?.views[0];
  expect(effectiveView && "time" in effectiveView ? effectiveView.time : null).toEqual(
    currentMonth("2026-06"),
  );
  expect(seen.at(-1)?.timeDimensions?.[0].dateRange).toEqual(["2026-06-01", "2026-06-30"]);
  expect(audit.at(-1)).toEqual(
    expect.objectContaining({
      source: {
        kind: "board",
        id: "board_1",
        reference_id: "report_1",
        revision: 3,
      },
    }),
  );
  await expect(
    service.runBoard(principal, "missing_board", "report_1", {
      revision: 3,
      result_view_id: "result",
      metric_id: "measure:active_employee_count",
      coordinates: [],
      time_coordinate: { from: "2026-06", to: "2026-06" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 1,
    }),
  ).rejects.toThrow("看板或报告不存在");
});

test("报告修订漂移时 fail-closed，记录失败审计且不执行查询", async () => {
  let loads = 0;
  const audit: unknown[] = [];
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(spec, 4),
    } as never,
    boards: noBoards,
    analyses: analysisServiceOf(spec),
    semanticPlanning: {
      plan: async () => Promise.reject(new Error("不应规划")),
    } as never,
    cube: {
      load: async () => {
        loads += 1;
        throw new Error("不应查询");
      },
    } as never,
    audit: { log: async (event: unknown) => void audit.push(event) },
  });
  await expect(
    service.runReport(principal, "report_1", {
      revision: 3,
      result_view_id: "result",
      metric_id: "measure:active_employee_count",
      coordinates: [],
      time_coordinate: { from: "2026-07", to: "2026-07" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 50,
    }),
  ).rejects.toThrow("报告已更新");
  expect(loads).toBe(0);
  expect(audit).toEqual([expect.objectContaining({ outcome: "error" })]);
});

test("率指标只投影分子名单，YTD 时间仍由指标口径解释", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const compiled = compileAnalysisView(toCompilerCatalog(document), rateSpec);
  const seen: CubeQuery[] = [];
  const cube = {
    meta: async () => fixtureViews,
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load: async (query: CubeQuery) => {
      seen.push(query);
      const dimensions = query.dimensions ?? [];
      return {
        data: [
          Object.fromEntries([
            ...dimensions.map((member) => [
              member,
              member.endsWith("employee_id") ? "e_01" : "张三",
            ]),
            ["test_people_metrics.ytd_event_count", 1],
          ]),
        ],
        annotation: {
          measures: {
            "test_people_metrics.ytd_event_count": { title: "YTD事件数" },
          },
          dimensions: Object.fromEntries(
            dimensions.map((member) => [member, { title: member.split(".").at(-1) ?? member }]),
          ),
        },
      };
    },
    loadMulti: async () => Promise.reject(new Error("不应执行多窗")),
  } as unknown as CubeGateway;
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(rateSpec, 1),
    } as never,
    boards: noBoards,
    analyses: analysisServiceOf(rateSpec, "analysis_rate"),
    semanticPlanning: { plan: async () => authorizedPlan(compiled, document) } as never,
    cube,
    audit: { log: async () => undefined },
  });

  const result = await service.runReport(principal, "report_rate", {
    revision: 1,
    result_view_id: "result",
    metric_id: "measure:ytd_event_rate",
    coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
    time_coordinate: { from: "2026-07", to: "2026-07" },
    data_as_of: "2026-07",
    offset: 0,
    limit: 50,
  });

  expect(result.metric_title).toBe("YTD事件率");
  expect(seen[0].measures).toEqual(["test_people_metrics.ytd_event_count"]);
  expect(seen[0].filters).toContainEqual({
    member: "test_people_metrics.ytd_event_count",
    operator: "gt",
    values: ["0"],
  });
  expect(seen[0].timeDimensions?.[0].dateRange).toEqual(["2026-07-01", "2026-07-31"]);
});

test("去重人数先按实体分页，再从贡献记录中稳定选择每人一行", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const publicCatalog = toCompilerCatalog(document);
  const metric = publicCatalog.measures.find((member) => member.title === "YTD去重事件数");
  expect(metric).toBeDefined();
  const entitySpec: AnalysisViewFixture = {
    analysis: {
      views: [
        {
          id: "result",
          measures: [metric!.id],
          dimensions: ["dimension:organization_name"],
          filters: [
            {
              member: "dimension:organization_name",
              relation: "one_of",
              values: ["研发", "产品"],
            },
          ],
          time: currentMonth("2026-07"),
        },
      ],
    },
    view: { type: "table" },
  };
  const compiled = compileAnalysisView(publicCatalog, entitySpec);
  const seen: CubeQuery[] = [];
  let duplicateMembership = false;
  let excessiveDetail = false;
  const load = async (query: CubeQuery): Promise<LoadResponse> => {
    seen.push(query);
    const dimensions = query.dimensions ?? [];
    const detail = dimensions.includes("test_people_metrics.record_key");
    const data = detail
      ? excessiveDetail
        ? Array.from({ length: 10_001 }, (_, index) => ({
            "test_people_metrics.record_key": `e_01|${index}`,
            "test_people_metrics.employee_id": "e_01",
            "test_people_metrics.employee_name": "张三",
            "test_people_metrics.organization_name": "研发",
            "test_people_metrics.record_date": "2026-06-20",
            "test_people_metrics.unique_event_count": 1,
          }))
        : [
            {
              "test_people_metrics.record_key": "e_01|old",
              "test_people_metrics.employee_id": "e_01",
              "test_people_metrics.employee_name": "张三（旧记录）",
              "test_people_metrics.organization_name": "研发",
              "test_people_metrics.record_date": "2026-02-10",
              "test_people_metrics.unique_event_count": 1,
            },
            {
              "test_people_metrics.record_key": "e_02|only",
              "test_people_metrics.employee_id": "e_02",
              "test_people_metrics.employee_name": "李四",
              "test_people_metrics.organization_name": "研发",
              "test_people_metrics.record_date": "2026-05-08",
              "test_people_metrics.unique_event_count": 1,
            },
            {
              "test_people_metrics.record_key": "e_01|latest",
              "test_people_metrics.employee_id": "e_01",
              "test_people_metrics.employee_name": "张三",
              "test_people_metrics.organization_name": "研发",
              "test_people_metrics.record_date": "2026-06-20",
              "test_people_metrics.unique_event_count": 1,
            },
          ]
      : duplicateMembership
        ? [
            {
              "test_people_metrics.employee_id": "e_01",
              "test_people_metrics.unique_event_count": 1,
            },
            {
              "test_people_metrics.employee_id": "e_01",
              "test_people_metrics.unique_event_count": 1,
            },
          ]
        : [
            {
              "test_people_metrics.employee_id": "e_01",
              "test_people_metrics.unique_event_count": 1,
            },
            {
              "test_people_metrics.employee_id": "e_02",
              "test_people_metrics.unique_event_count": 1,
            },
            {
              "test_people_metrics.employee_id": "e_03",
              "test_people_metrics.unique_event_count": 1,
            },
          ];
    return {
      data,
      annotation: {
        measures: {
          "test_people_metrics.unique_event_count": { title: "YTD去重事件数" },
        },
        dimensions: Object.fromEntries(
          dimensions.map((member) => [member, { title: member.split(".").at(-1) ?? member }]),
        ),
      },
    };
  };
  const cube = {
    meta: async () => fixtureViews,
    timeContext: async () => ({
      dataAsOf: "2026-07",
      sources: {
        workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
      },
    }),
    load,
    loadMulti: async () => Promise.reject(new Error("不应执行多窗")),
  } as unknown as CubeGateway;
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(entitySpec, 1),
    } as never,
    boards: noBoards,
    analyses: analysisServiceOf(entitySpec, "analysis_entities"),
    semanticPlanning: { plan: async () => authorizedPlan(compiled, document) } as never,
    cube,
    audit: { log: async () => undefined },
  });

  const result = await service.runReport(principal, "report_entities", {
    revision: 1,
    result_view_id: "result",
    metric_id: metric!.id,
    coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
    time_coordinate: { from: "2026-07", to: "2026-07" },
    data_as_of: "2026-07",
    offset: 0,
    limit: 2,
  });

  expect(result.rows).toEqual([
    ["e_01", "张三", "2026-06-20", "研发"],
    ["e_02", "李四", "2026-05-08", "研发"],
  ]);
  expect(result.column_keys).toEqual([
    "employee_id",
    "employee_name",
    "record_date",
    "organization_name",
  ]);
  expect(result.columns).toHaveLength(result.column_keys.length);
  expect(result.has_more).toBe(true);
  expect(seen).toHaveLength(2);
  expect(seen[0]).toMatchObject({
    dimensions: ["test_people_metrics.employee_id"],
    offset: 0,
    limit: 3,
  });
  expect(seen[1].offset).toBeUndefined();
  expect(seen[1].filters).toEqual(
    expect.arrayContaining([
      {
        member: "test_people_metrics.organization_name",
        operator: "equals",
        values: ["研发", "产品"],
      },
      {
        member: "test_people_metrics.organization_name",
        operator: "equals",
        values: ["研发"],
      },
      {
        member: "test_people_metrics.employee_id",
        operator: "equals",
        values: ["e_01", "e_02"],
      },
    ]),
  );
  expect(seen[1].order).toEqual([
    ["test_people_metrics.employee_id", "asc"],
    ["test_people_metrics.record_date", "desc"],
    ["test_people_metrics.record_key", "desc"],
  ]);

  duplicateMembership = true;
  await expect(
    service.runReport(principal, "report_entities", {
      revision: 1,
      result_view_id: "result",
      metric_id: metric!.id,
      coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
      time_coordinate: { from: "2026-07", to: "2026-07" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 2,
    }),
  ).rejects.toThrow("实体分页键不唯一");

  duplicateMembership = false;
  excessiveDetail = true;
  await expect(
    service.runReport(principal, "report_entities", {
      revision: 1,
      result_view_id: "result",
      metric_id: metric!.id,
      coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
      time_coordinate: { from: "2026-07", to: "2026-07" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 2,
    }),
  ).rejects.toThrow("候选记录过多");
});

test("分组坐标缺失时不能把单个格子扩大成整份名单", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const compiled = compileAnalysisView(toCompilerCatalog(document), spec);
  let loads = 0;
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(spec, 3),
    } as never,
    boards: noBoards,
    analyses: analysisServiceOf(spec),
    semanticPlanning: { plan: async () => authorizedPlan(compiled, document) } as never,
    cube: {
      load: async () => {
        loads += 1;
        throw new Error("不应查询");
      },
    } as never,
    audit: { log: async () => undefined },
  });

  await expect(
    service.runReport(principal, "report_1", {
      revision: 3,
      result_view_id: "result",
      metric_id: "measure:active_employee_count",
      coordinates: [],
      time_coordinate: { from: "2026-07", to: "2026-07" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 50,
    }),
  ).rejects.toThrow("明细坐标与当前报告不一致");
  expect(loads).toBe(0);
});

test("隐藏 source 不是交付结果，不能通过手写 result_view_id 投影记录", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const derivedSpec: AnalysisViewFixture = {
    analysis: {
      views: [
        {
          id: "source",
          view_title: "组织在职人数数据",
          measures: ["measure:active_employee_count"],
          dimensions: ["dimension:organization_name"],
          time: currentMonth("2026-07"),
        },
        {
          id: "result",
          view_title: "在职人数",
          from: ["source"],
          columns: [
            {
              source: "source",
              member: "dimension:organization_name",
              as: "组织",
            },
            {
              source: "source",
              member: "measure:active_employee_count",
              as: "在职人数",
            },
          ],
        },
      ],
    },
    view: { type: "table" },
  };
  const compiled = compileAnalysisView(toCompilerCatalog(document), derivedSpec);
  expect(compiled.record_projection_bindings.views).toEqual([]);

  let compiles = 0;
  let loads = 0;
  const audit: unknown[] = [];
  const service = createRecordProjectionService({
    reports: {
      resolveOwned: async () => reportDocumentOf(derivedSpec, 1),
    } as never,
    boards: noBoards,
    analyses: analysisServiceOf(derivedSpec, "analysis_derived"),
    semanticPlanning: {
      plan: async () => {
        compiles += 1;
        return authorizedPlan(compiled, document);
      },
    } as never,
    cube: {
      load: async () => {
        loads += 1;
        throw new Error("不应查询");
      },
    } as never,
    audit: { log: async (event: unknown) => void audit.push(event) },
  });

  await expect(
    service.runReport(principal, "report_derived", {
      revision: 1,
      result_view_id: "source",
      metric_id: "measure:active_employee_count",
      coordinates: [{ dimension_id: "dimension:organization_name", value: "研发" }],
      time_coordinate: { from: "2026-07", to: "2026-07" },
      data_as_of: "2026-07",
      offset: 0,
      limit: 50,
    }),
  ).rejects.toThrow("当前结果列没有可追溯的基础指标");
  expect(compiles).toBe(0);
  expect(loads).toBe(0);
  expect(audit).toEqual([expect.objectContaining({ outcome: "error" })]);
});

test("Agent 名单从单一聚合结果格投影记录，分类条件保留在分析筛选中", async () => {
  const document = buildCatalogDocument(fixtureViews);
  const catalog = toCompilerCatalog(document);
  const listSpec: AnalysisViewFixture = {
    analysis: {
      views: [
        {
          id: "result",
          measures: ["measure:active_employee_count"],
          filters: [
            {
              member: "dimension:organization_name",
              relation: "one_of",
              values: ["研发"],
            },
          ],
          time: currentMonth("2026-07"),
        },
      ],
    },
    view: { type: "table" },
  };
  let storedSpec = listSpec;
  let compiles = 0;
  const seen: CubeQuery[] = [];
  const service = createRecordProjectionService({
    reports: {} as never,
    boards: noBoards,
    analyses: {
      resolveOwnedView: async () => {
        const analysis = analysisServiceOf(
          storedSpec,
          "analysis_list",
          "22222222-2222-4222-8222-222222222222",
        ) as unknown as {
          resolveOwnedView: () => Promise<unknown>;
        };
        return analysis.resolveOwnedView();
      },
    } as never,
    semanticPlanning: {
      plan: async (
        _principal: Principal,
        analysis: AnalysisDefinition,
        view: SemanticViewIntent,
      ) => {
        compiles += 1;
        return authorizedPlan(compileAnalysisView(catalog, { analysis, view }), document);
      },
    } as never,
    cube: {
      meta: async () => fixtureViews,
      timeContext: async () => ({
        dataAsOf: "2026-07",
        sources: {
          workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
        },
      }),
      load: async (query: CubeQuery) => {
        seen.push(query);
        const dimensions = query.dimensions ?? [];
        return {
          data: [
            Object.fromEntries(
              dimensions.map((member) => {
                const short = member.split(".").at(-1);
                const value =
                  short === "employee_id"
                    ? "e_01"
                    : short === "employee_name"
                      ? "张三"
                      : short === "record_key"
                        ? "e_01|snapshot"
                        : short === "record_date"
                          ? "2026-07-31"
                          : short === "organization_name"
                            ? "研发"
                            : null;
                return [member, value];
              }),
            ),
          ],
          annotation: {
            measures: { "test_people_metrics.active_employee_count": { title: "在职人数" } },
            dimensions: Object.fromEntries(
              dimensions.map((member) => [member, { title: member.split(".").at(-1) ?? member }]),
            ),
          },
        };
      },
      loadMulti: async () => Promise.reject(new Error("不应执行多窗")),
    } as never,
    audit: { log: async () => undefined },
  });

  const records = await service.runAnalysis(principal, "22222222-2222-4222-8222-222222222222");
  expect(records.record_set_title).toBe("员工记录");
  expect(records.rows[0]?.slice(0, 2)).toEqual(["e_01", "张三"]);
  expect(compiles).toBe(1);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.filters).toEqual(
    expect.arrayContaining([
      {
        member: "test_people_metrics.organization_name",
        operator: "equals",
        values: ["研发"],
      },
    ]),
  );
  expect(seen[0]?.timeDimensions?.[0].dateRange).toEqual(["2026-07-01", "2026-07-31"]);

  const refreshed = await service.runAnalysis(principal, "22222222-2222-4222-8222-222222222222", {
    dataAsOf: "2026-06",
  });
  expect(refreshed.data_changed).toBe(true);

  storedSpec = spec;
  await expect(
    service.runAnalysis(principal, "22222222-2222-4222-8222-222222222222"),
  ).rejects.toThrow("不能声明分组维度");
  expect(seen).toHaveLength(2);
});
