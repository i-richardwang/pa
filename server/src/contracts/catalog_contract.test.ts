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
  test("指标查询能力是必填正向合同，指标专属字段不能落到维度", () => {
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
    // 属性组是维度的必填归属：客户端按它归拢与筛选，不自行造桶。
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        dimensions: [{ ...catalog.dimensions[0], dimension_group: undefined }],
      }).success,
    ).toBe(false);
    // 求值基准是指标的必填面：缺了它，消费方就只能按标题猜这个数代表什么时间。
    expect(
      PUBLIC_CATALOG_DOCUMENT_SCHEMA.safeParse({
        ...catalog,
        measures: [{ ...catalog.measures[0], time: undefined }],
      }).success,
    ).toBe(false);
  });
});
