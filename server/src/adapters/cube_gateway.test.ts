/** Cube /sql 单窗与多窗原始形态的产品边界归一。 */
import { describe, expect, spyOn, test } from "bun:test";
import { decodeJwt } from "jose";
import {
  createCubeGateway,
  normalizeMetaViews,
  normalizeSqlResponse,
  resolveTimeSourceAnchors,
} from "./cube_gateway.js";
import { CubeGatewayError, type CubeView } from "../ports/cube_gateway.js";
import { buildTimeSourceRegistry } from "../semantic_core/time_source.js";

const GENERIC_TIME_SOURCES = buildTimeSourceRegistry([
  {
    id: "sales_actual",
    title: "Sales actuals",
    role: "actual",
    primary: true,
    comparison_policy: "calendar",
  },
  {
    id: "sales_plan",
    title: "Sales plan",
    role: "plan",
    primary: false,
    reference_source: "sales_actual",
    comparison_policy: "calendar",
  },
  {
    id: "inventory_count",
    title: "Inventory counts",
    role: "actual",
    primary: false,
    comparison_policy: "explicit_only",
  },
]);

const TEST_CONTEXT = {
  subject: "service",
  groups: ["pa_service"],
  accessScope: { kind: "all" as const },
};

const testGateway = (requestTimeoutMs = 30_000) =>
  createCubeGateway({
    cubeUrl: "http://cube.test",
    apiSecret: "test-secret",
    accessScopeId: "region",
    serviceContext: TEST_CONTEXT,
    timeSources: GENERIC_TIME_SOURCES,
    requestTimeoutMs,
  });

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("通用授权范围只以 data_scope 投影到 Cube JWT", async () => {
  const authorizations: string[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
    return new Response(JSON.stringify({ cubes: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch);
  try {
    const gateway = createCubeGateway({
      cubeUrl: "http://cube.test",
      apiSecret: "test-secret",
      accessScopeId: "region",
      serviceContext: { subject: "service", groups: ["pa_service"], accessScope: { kind: "all" } },
      timeSources: GENERIC_TIME_SOURCES,
    });
    await gateway.meta({
      subject: "regional-user",
      groups: ["pa_scoped"],
      accessScope: { kind: "limited", values: ["North", "West"] },
    });
    const token = authorizations[0]?.replace(/^Bearer\s+/, "");
    expect(decodeJwt(token)).toMatchObject({
      email: "regional-user",
      groups: ["pa_scoped"],
      data_scope: { id: "region", values: ["North", "West"] },
    });
  } finally {
    fetchMock.mockRestore();
  }
});

test("内部成员只保留在服务端契约解析面", () => {
  const view = {
    type: "view",
    name: "test_people_metrics",
    title: "人员总览",
    measures: [
      { name: "test_people_metrics.active_employee_count", title: "在职人数", type: "number" },
      {
        name: "test_people_metrics.raw_count",
        title: "基础人数",
        type: "number",
        meta: { internal: true },
      },
    ],
    dimensions: [
      { name: "test_people_metrics.organization_name", title: "组织", type: "string" },
      {
        name: "test_people_metrics.employee_id",
        title: "员工编号",
        type: "string",
        meta: { internal: true },
      },
    ],
  } satisfies CubeView & { type: string };

  const [normalized] = normalizeMetaViews([view]);
  expect(normalized.measures.map(({ name }) => name)).toEqual([
    "test_people_metrics.active_employee_count",
  ]);
  expect(normalized.dimensions.map(({ name }) => name)).toEqual([
    "test_people_metrics.organization_name",
  ]);
  expect(normalized.internalMeasures?.map(({ name }) => name)).toEqual([
    "test_people_metrics.raw_count",
  ]);
  expect(normalized.internalDimensions?.map(({ name }) => name)).toEqual([
    "test_people_metrics.employee_id",
  ]);
});

test("Cube meta 与 load 的内部结构在 HTTP 边界 fail-closed", async () => {
  const fetchMock = spyOn(globalThis, "fetch");
  try {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ cubes: [{ type: "view", name: "broken", title: "Broken" }] }),
    );
    await expect(testGateway().meta(TEST_CONTEXT)).rejects.toBeInstanceOf(CubeGatewayError);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [null], annotation: { measures: {}, dimensions: {} } }),
    );
    await expect(testGateway().load({}, TEST_CONTEXT)).rejects.toBeInstanceOf(CubeGatewayError);

    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [null] }));
    await expect(testGateway().loadMulti({}, TEST_CONTEXT)).rejects.toBeInstanceOf(
      CubeGatewayError,
    );
  } finally {
    fetchMock.mockRestore();
  }
});

test("Cube load 只把通过合同的行与 annotation 交给应用层", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({
      data: [{ "sales.revenue": 12 }],
      annotation: {
        measures: { "sales.revenue": { title: "Revenue", description: "Booked revenue" } },
        dimensions: {},
        segments: { ignored: true },
      },
    }),
  );
  try {
    await expect(testGateway().load({}, TEST_CONTEXT)).resolves.toEqual({
      data: [{ "sales.revenue": 12 }],
      annotation: {
        measures: { "sales.revenue": { title: "Revenue", description: "Booked revenue" } },
        dimensions: {},
      },
    });
  } finally {
    fetchMock.mockRestore();
  }
});

test("单次 Cube HTTP 往返超时后以稳定网关错误结束", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing abort signal");
    return {
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    } as Response;
  }) as typeof fetch);
  try {
    await expect(testGateway(5).meta(TEST_CONTEXT)).rejects.toMatchObject({
      name: "CubeGatewayError",
      message: "数据引擎暂时不可用，请稍后重试",
    });
  } finally {
    fetchMock.mockRestore();
  }
});

test("时间上下文拒绝 Cube 返回的非法年月", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      jsonResponse({
        cubes: [
          {
            type: "view",
            name: "sales_execution",
            title: "Sales execution",
            meta: {
              query_surface: "metric_source",
              time_source: "sales_actual",
              time_anchor_measure: "revenue",
            },
            measures: [{ name: "sales_execution.revenue", title: "Revenue", type: "number" }],
            dimensions: [],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        data: [{ "sales_execution.year": "2026", "sales_execution.month": "13" }],
        annotation: { measures: {}, dimensions: {} },
      }),
    );
  try {
    await expect(testGateway().timeContext()).rejects.toBeInstanceOf(CubeGatewayError);
  } finally {
    fetchMock.mockRestore();
  }
});

test("非 HR 数据时钟从包注册表和执行 View 元数据解析", () => {
  const metricView = (
    name: string,
    source: "sales_actual" | "sales_plan" | "inventory_count",
    measure: string,
  ): CubeView => ({
    name,
    title: name,
    meta: {
      query_surface: "metric_source",
      time_source: source,
      time_anchor_measure: measure,
    },
    measures: [{ name: `${name}.${measure}`, title: measure, type: "number" }],
    dimensions: [],
  });
  const anchors = resolveTimeSourceAnchors(
    [
      metricView("sales_execution", "sales_actual", "revenue"),
      metricView("plan_execution", "sales_plan", "planned_revenue"),
      metricView("inventory_execution", "inventory_count", "counted_units"),
    ],
    GENERIC_TIME_SOURCES,
  );
  expect(Object.fromEntries(anchors)).toEqual({
    sales_actual: { view: "sales_execution", measure: "revenue" },
    sales_plan: { view: "plan_execution", measure: "planned_revenue" },
    inventory_count: { view: "inventory_execution", measure: "counted_units" },
  });
  // 注册表里的非主来源不在当前包模型中出现时，不要求锚点。
  expect(
    Object.fromEntries(
      resolveTimeSourceAnchors(
        [metricView("sales_execution", "sales_actual", "revenue")],
        GENERIC_TIME_SOURCES,
      ),
    ),
  ).toEqual({ sales_actual: { view: "sales_execution", measure: "revenue" } });
  // 声明了某来源的执行 View 在场却没人给锚点：fail-closed
  expect(() =>
    resolveTimeSourceAnchors(
      [
        metricView("sales_execution", "sales_actual", "revenue"),
        {
          ...metricView("plan_execution", "sales_plan", "planned_revenue"),
          meta: { query_surface: "metric_source", time_source: "sales_plan" },
        },
      ],
      GENERIC_TIME_SOURCES,
    ),
  ).toThrow("sales_plan 缺少唯一时间锚点");
  // 主时钟恒必须在场
  expect(() =>
    resolveTimeSourceAnchors(
      [metricView("plan_execution", "sales_plan", "planned_revenue")],
      GENERIC_TIME_SOURCES,
    ),
  ).toThrow("sales_actual 缺少唯一时间锚点");
});

describe("normalizeSqlResponse", () => {
  test("单窗统一返回长度为一的逐窗数组", () => {
    const result = normalizeSqlResponse(
      {
        measures: ["test_people_metrics.active_employee_count"],
        timeDimensions: [
          {
            dimension: "test_people_metrics.period_month",
            granularity: "month",
            dateRange: ["2026-06-01", "2026-06-30"],
          },
        ],
      },
      { sql: { sql: ["select ?", ["2026"]] } },
    );
    expect(result).toEqual([
      {
        window: { from: "2026-06-01", to: "2026-06-30" },
        sql: "select ?",
        params: ["2026"],
      },
    ]);
  });

  test("多窗逐项配对窗口，不泄漏 Cube 包装对象", () => {
    const result = normalizeSqlResponse(
      {
        measures: ["test_people_metrics.ytd_primary_event_rate"],
        timeDimensions: [
          {
            dimension: "test_people_metrics.period_month",
            granularity: "month",
            compareDateRange: [
              ["2025-06-01", "2025-06-30"],
              ["2026-06-01", "2026-06-30"],
            ],
          },
        ],
      },
      [
        { sql: { external: false, sql: ["select 2025", ["2025", "2026"]] } },
        { sql: { external: false, sql: ["select 2026", ["2025", "2026"]] } },
      ],
    );
    expect(result.map(({ window, sql }) => ({ window, sql }))).toEqual([
      { window: { from: "2025-06-01", to: "2025-06-30" }, sql: "select 2025" },
      { window: { from: "2026-06-01", to: "2026-06-30" }, sql: "select 2026" },
    ]);
  });

  test("SQL 缺失或窗口数量不一致时以稳定网关错误拒绝", () => {
    expect(() => normalizeSqlResponse({}, { sql: {} })).toThrow("数据引擎暂时不可用");
    expect(() =>
      normalizeSqlResponse(
        {
          timeDimensions: [
            {
              dimension: "v.period_month",
              compareDateRange: [
                ["2025-01-01", "2025-01-31"],
                ["2026-01-01", "2026-01-31"],
              ],
            },
          ],
        },
        { sql: { sql: ["select 1", []] } },
      ),
    ).toThrow("数据引擎暂时不可用");
  });
});
