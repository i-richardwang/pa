import { describe, expect, test } from "bun:test";
import { PUBLIC_CATALOG_DOCUMENT_SCHEMA } from "./catalog_contract.js";

const catalog = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: ["测试口径。"],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [],
  measures: [
    {
      id: "measure:employee_count",
      kind: "measure",
      title: "人数",
      description: "所选范围人数。",
      query_capabilities: { dimension_ids: ["dimension:organization"] },
      time: { value_basis: "bucket_end" },
    },
  ],
  dimensions: [
    {
      id: "dimension:organization",
      kind: "dimension",
      title: "组织",
      description: "人员所属组织。",
      dimension_kind: "categorical",
      dimension_group: { id: "organization", title: "组织与部门" },
    },
  ],
};

describe("public catalog contract", () => {
  test("指标必须带 query_capabilities 与 time，维度必须带 dimension_group 且不接受 query_capabilities", () => {
    expect(PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse(catalog).success).toBe(true);
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        measures: [{ ...catalog.measures[0], query_capabilities: undefined }],
      }).success,
    ).toBe(false);
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        dimensions: [{ ...catalog.dimensions[0], query_capabilities: { dimension_ids: [] } }],
      }).success,
    ).toBe(false);
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        dimensions: [{ ...catalog.dimensions[0], dimension_group: undefined }],
      }).success,
    ).toBe(false);
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        measures: [{ ...catalog.measures[0], time: undefined }],
      }).success,
    ).toBe(false);
  });
});
