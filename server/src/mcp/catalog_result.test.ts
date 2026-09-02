import { expect, test } from "bun:test";
import { createCatalogService } from "../application/catalog_service.js";
import type { Principal } from "../contracts/principal.js";
import type { CubeView } from "../ports/cube_gateway.js";
import { canonicalModelFixture } from "../test_support/canonical_semantic_model.js";
import { TEST_SEMANTIC_TAXONOMY } from "../test_support/semantic_taxonomy.js";
import { projectAgentCatalog } from "./catalog_result.js";
import { CATALOG_OUTPUT_SCHEMA } from "./contracts.js";

const views: CubeView[] = [
  {
    name: "people_metrics",
    title: "人员指标",
    meta: {
      query_surface: "metric_source",
      time_source: "workforce",
      observation_scope: "统计范围",
    },
    measures: [
      {
        name: "people_metrics.active_employee_count",
        title: "在职人数",
        description: "月末在职人数。",
        type: "number",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "last", window: "selected" },
        },
      },
      {
        name: "people_metrics.employee_scope_total",
        title: "统计范围总人数",
        description: "统计范围内的总人数。",
        type: "number",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "last", window: "selected" },
        },
      },
      {
        name: "people_metrics.monthly_metric",
        title: "月度指标",
        description: "仅按单月计算的指标。",
        type: "number",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "average", window: "selected", grain: "month" },
        },
      },
      {
        name: "people_metrics.active_employee_rate",
        title: "在职人数占比",
        description: "在职人数占统计范围总人数的比例。",
        type: "number",
        format: "percent",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "recompute", window: "selected" },
          components: {
            numerator: "active_employee_count",
            denominator: "employee_scope_total",
          },
        },
      },
    ],
    dimensions: [
      {
        name: "people_metrics.organization_name",
        title: "组织",
        description: "员工所属组织。",
        type: "string",
        meta: { dimension_group: "organization" },
      },
    ],
  },
];

test("Agent Catalog 从真实授权目录投影查询所需能力", async () => {
  const principal: Principal = { email: "agent@x", roles: ["user"], accessScope: { kind: "all" } };
  const service = createCatalogService({
    canonical: canonicalModelFixture(views, TEST_SEMANTIC_TAXONOMY),
    cube: {
      meta: async () => views,
      load: async () => {
        throw new Error("目录不应查数");
      },
      timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
    },
    businessTerms: { resolve: async () => [] },
  });

  const publicPayload = await service.query(principal, {});
  expect(publicPayload.dimensions[0]).toHaveProperty("dimension_group");
  expect(publicPayload.measures.find(({ title }) => title === "在职人数占比")?.formula).toEqual(
    expect.objectContaining({
      numerator_id: "measure:active_employee_count",
      denominator_id: "measure:employee_scope_total",
    }),
  );

  const agentPayload = projectAgentCatalog(publicPayload);
  expect(CATALOG_OUTPUT_SCHEMA.safeParse(agentPayload).success).toBe(true);
  expect(agentPayload.dimensions[0]).not.toHaveProperty("dimension_group");
  expect(agentPayload.measures.find(({ title }) => title === "在职人数占比")?.formula).toEqual({
    numerator: "在职人数",
    denominator: "统计范围总人数",
  });
  expect(agentPayload.measures.find(({ title }) => title === "月度指标")?.time_constraints).toEqual(
    { grain: "month" },
  );
});
