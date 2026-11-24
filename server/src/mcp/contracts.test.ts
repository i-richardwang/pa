import { expect, test } from "bun:test";
import { CATALOG_OUTPUT_SCHEMA, RECORDS_OUTPUT_SCHEMA, RUN_OUTPUT_SCHEMA } from "./contracts.js";

test("公共 MCP 响应 schema 各层均为 strict，出现未声明字段时解析失败", () => {
  const catalog = {
    access_scope: { id: "organization", title: "组织" },
    observation_scopes: ["测试人群口径。"],
    data_as_of: "2026-07",
    time_context: [],
    metric_domains: [
      {
        id: "metric_domain:workforce",
        title: "人员规模",
        measure_ids: ["measure:active_employee_count"],
        dimension_ids: [],
      },
    ],
    measures: [
      {
        id: "measure:active_employee_count",
        kind: "measure",
        title: "在职人数",
        description: "月末在职人数。",
        data_as_of: "2026-03",
        query_capabilities: { dimension_ids: [] },
        time: { value_basis: "bucket_end" },
      },
    ],
    dimensions: [],
    matched_terms: ["在职人数"],
    unmatched_terms: [],
    ambiguous_terms: [],
    term_knowledge_status: "available",
    term_resolutions: [],
  };
  expect(CATALOG_OUTPUT_SCHEMA.safeParse(catalog).success).toBe(true);
  expect(
    CATALOG_OUTPUT_SCHEMA.safeParse({
      ...catalog,
      measures: [{ ...catalog.measures[0], query_capabilities: undefined }],
    }).success,
  ).toBe(false);
  expect(
    CATALOG_OUTPUT_SCHEMA.safeParse({
      ...catalog,
      dimensions: [
        {
          id: "dimension:organization_name",
          kind: "dimension",
          title: "组织",
          description: "组织。",
          query_capabilities: { dimension_ids: [] },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    CATALOG_OUTPUT_SCHEMA.safeParse({
      ...catalog,
      measures: [{ ...catalog.measures[0], name: "test_people_metrics.active_employee_count" }],
    }).success,
  ).toBe(false);
  expect(
    CATALOG_OUTPUT_SCHEMA.safeParse({
      ...catalog,
      unexpected_key: "test_people_metrics",
    }).success,
  ).toBe(false);

  const run = {
    analysis_id: "018f5da8-7a4c-7d4d-9f3a-8a3c7f4b4c01",
    view_id: "118f5da8-7a4c-7d4d-9f3a-8a3c7f4b4c01",
    observation_scopes: ["测试人群口径。"],
    data_as_of: "2026-07",
    time_context: [],
    view: {
      id: "result",
      columns: ["measure:active_employee_count"],
      column_roles: { "measure:active_employee_count": "measure" },
      column_time_basis: { "measure:active_employee_count": "bucket_end" },
      rows: [[12]],
      row_count: 1,
      time: {
        grain: "total",
        coordinates: [{ role: "primary", from: "2026-07", to: "2026-07" }],
        buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
      },
      query_notes: [
        {
          member: "measure:active_employee_count",
          title: "在职人数",
          text: "月末在职人数。",
        },
      ],
    },
  };
  expect(RUN_OUTPUT_SCHEMA.safeParse(run).success).toBe(true);
  // derived 是服务端内部的派生声明，不属于公共输出协议。
  expect(
    RUN_OUTPUT_SCHEMA.safeParse({
      ...run,
      view: { ...run.view, derived: { formula: "a+b" } },
    }).success,
  ).toBe(false);

  const records = {
    view_id: "118f5da8-7a4c-7d4d-9f3a-8a3c7f4b4c01",
    metric_id: "measure:active_employee_count",
    metric_title: "在职人数",
    record_set_title: "在职员工",
    record_set_description: "构成在职人数的员工记录。",
    offset: 0,
    displayed_records: 1,
    has_more: false,
    data_as_of: "2026-07",
    data_changed: false,
  };
  expect(RECORDS_OUTPUT_SCHEMA.safeParse(records).success).toBe(true);
  expect(RECORDS_OUTPUT_SCHEMA.safeParse({ ...records, rows: [["e_001", "张三"]] }).success).toBe(
    false,
  );
});
