import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  CubeGateway,
  CubeMember,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  LoadResponse,
  TimeContext,
} from "../ports/cube_gateway.js";
import { planQueryIntent } from "../semantic_core/query_intent.js";
import { queryFeasibilityIssueMessage } from "../semantic_core/query_feasibility.js";
import { applyFormalMetricModel } from "./metric_model.js";
import { executeMetricQuery } from "./metric_executor.js";
import { planMetricQuery } from "../test_support/planning.js";
import { loadCanonicalSemanticModel } from "./canonical_semantic_model.js";
import { toCompilerCatalog } from "./catalog_document.js";
import { loadSemanticPackage } from "./semantic_package.js";
import { createCatalogService } from "../application/catalog_service.js";
import type { Principal } from "../contracts/principal.js";
import { cubeSecurityContext } from "./cube_security.js";

const packageRoot = fileURLToPath(
  new URL("../../test_fixtures/generic_bi_package/", import.meta.url),
);

const metric = (
  view: string,
  name: string,
  title: string,
  aggregation: "sum" | "last",
  domain: string,
): CubeMember => ({
  name: `${view}.${name}`,
  title,
  description: `${title} acceptance fixture.`,
  type: "number",
  meta: {
    metric_domain_id: domain,
    time_contract: { aggregation, window: "selected" },
  },
});

const dimension = (view: string, name: string, title: string, type = "string"): CubeMember => ({
  name: `${view}.${name}`,
  title,
  description: `${title} acceptance fixture.`,
  type,
  meta: { dimension_group: "market" },
});

const timeDimensions = (view: string): CubeMember[] =>
  [
    ["year", "number"],
    ["month", "number"],
    ["period_month", "time"],
  ].map(([name, type]) => ({
    name: `${view}.${name}`,
    title: name,
    description: `${name} time control.`,
    type,
    meta: { internal: true, member_role: "time_control" },
  }));

function runtimeViews(): CubeView[] {
  const sales = "sales_metrics";
  const inventory = "inventory_metrics";
  return [
    {
      name: sales,
      title: "Sales metrics",
      description: "Governed query surface for regional sales performance.",
      meta: {
        query_surface: "metric_source",
        time_source: "sales_actual",
        time_anchor_measure: "order_count",
        observation_scope: "Scope: completed sales orders.",
      },
      measures: [
        metric(sales, "revenue", "Revenue", "sum", "metric_domain:sales_performance"),
        metric(sales, "order_count", "Completed orders", "sum", "metric_domain:sales_performance"),
      ],
      dimensions: [dimension(sales, "region", "Region")],
      internalDimensions: timeDimensions(sales),
    },
    {
      name: inventory,
      title: "Inventory metrics",
      description: "Governed query surface for regional inventory observations.",
      meta: {
        query_surface: "metric_source",
        time_source: "inventory_count",
        time_anchor_measure: "counted_units",
        observation_scope: "Scope: completed inventory observations.",
      },
      measures: [
        metric(
          inventory,
          "counted_units",
          "Counted units",
          "last",
          "metric_domain:inventory_position",
        ),
      ],
      dimensions: [dimension(inventory, "region", "Region")],
      internalDimensions: timeDimensions(inventory),
    },
  ];
}

function response(query: CubeQuery, rows: LoadResponse["data"]): LoadResponse {
  return {
    data: rows,
    annotation: {
      measures: Object.fromEntries(
        (query.measures ?? []).map((member) => [member, { title: member }]),
      ),
      dimensions: Object.fromEntries(
        (query.dimensions ?? []).map((member) => [member, { title: member }]),
      ),
    },
  };
}

test("非 HR 语义包走通注册、canonical model、比较策略、规划与结果保护", async () => {
  const semanticPackage = await loadSemanticPackage(packageRoot);
  const views = applyFormalMetricModel(runtimeViews(), semanticPackage.formal_metrics);
  const security: CubeSecurityContext = {
    subject: "acceptance",
    groups: [],
    accessScope: { kind: "all" },
  };
  const canonical = await loadCanonicalSemanticModel({
    semantic_package: semanticPackage,
    cube: { meta: async () => views },
    service_context: security,
    retry: { attempts: 1 },
  });
  const compiler = toCompilerCatalog(canonical.document);

  expect(canonical.time_sources.primary.id).toBe("sales_actual");
  expect(canonical.access_scope).toEqual({ id: "region", title: "Region" });
  expect(canonical.document.observation_scopes).toEqual([
    "Scope: completed sales orders.",
    "Scope: completed inventory observations.",
  ]);
  expect(canonical.capabilities.metric_domains.map((domain) => domain.id)).toEqual([
    "metric_domain:sales_performance",
    "metric_domain:inventory_position",
  ]);
  expect(compiler.measures.find(({ id }) => id === "measure:counted_units")).toMatchObject({
    query_capabilities: { dimension_ids: ["dimension:region"] },
    time_constraints: { comparison: "explicit_only" },
  });

  const blocked = planQueryIntent(
    compiler,
    {
      measures: ["measure:counted_units"],
      dimensions: ["dimension:region"],
      time: {
        window: { kind: "current_month", month: "2026-07" },
        comparison: { kind: "previous_year" },
      },
    },
    "query",
  );
  expect(blocked).toMatchObject({ status: "incompatible" });

  const intent = planQueryIntent(
    compiler,
    {
      measures: ["measure:average_order_value"],
      dimensions: ["dimension:region"],
      time: { window: { kind: "current_month", month: "2026-07" } },
    },
    "query",
  );
  if (intent.status !== "direct") throw new Error(queryFeasibilityIssueMessage(intent.issue));

  const context: TimeContext = {
    dataAsOf: "2026-07",
    sources: {
      sales_actual: { actualThrough: "2026-07", availableThrough: "2026-07" },
      inventory_count: { actualThrough: "2026-07", availableThrough: "2026-07" },
    },
  };
  const plan = planMetricQuery(
    {
      measures: intent.query.measures,
      dimensions: intent.query.dimensions,
      filters: intent.query.filters,
    },
    intent.query.time,
    context,
    canonical.views,
    intent.view,
  );
  expect(plan.legs).toHaveLength(1);
  expect(plan.result_guards).toEqual([
    {
      kind: "minimum_support",
      measure: "sales_metrics.average_order_value",
      support_measure: "measure:order_count",
      threshold: 5,
    },
  ]);

  const cube: Pick<CubeGateway, "load" | "loadMulti"> = {
    load: async (query) =>
      response(query, [
        {
          "sales_metrics.region": "North",
          "sales_metrics.revenue": 400,
          "sales_metrics.order_count": 4,
        },
        {
          "sales_metrics.region": "South",
          "sales_metrics.revenue": 1000,
          "sales_metrics.order_count": 10,
        },
      ]),
    loadMulti: async (query) => [await cube.load(query, security)],
  };
  const result = await executeMetricQuery(cube, plan, security, canonical.views);
  expect(result.data).toEqual([
    { "sales_metrics.region": "North", "sales_metrics.average_order_value": null },
    { "sales_metrics.region": "South", "sales_metrics.average_order_value": 100 },
  ]);
  expect(result.masked).toEqual([
    { member: "sales_metrics.average_order_value", threshold: 5, groups: 1 },
  ]);

  const principal: Principal = {
    email: "regional-analyst@example.com",
    roles: ["user"],
    accessScope: { kind: "limited", values: ["North"] },
  };
  const observedContexts: CubeSecurityContext[] = [];
  const catalog = createCatalogService({
    canonical,
    cube: {
      meta: async (context) => {
        observedContexts.push(context);
        return views;
      },
      load: async () => response({}, []),
      timeContext: async () => context,
    },
    businessTerms: { resolve: async () => [] },
  });
  const publicCatalog = await catalog.query(principal, {});
  expect(publicCatalog.access_scope).toEqual({ id: "region", title: "Region" });
  expect(publicCatalog.observation_scopes).toEqual(canonical.document.observation_scopes);
  expect(observedContexts).toEqual([cubeSecurityContext(principal)]);
  expect(observedContexts[0]).toMatchObject({
    groups: ["pa_scoped"],
    accessScope: { kind: "limited", values: ["North"] },
  });
});
