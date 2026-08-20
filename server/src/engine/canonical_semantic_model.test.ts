import { describe, expect, test } from "bun:test";
import type { CubeView } from "../ports/cube_gateway.js";
import {
  TEST_SEMANTIC_TAXONOMY,
  TEST_TIME_SOURCE_REGISTRY,
} from "../test_support/semantic_taxonomy.js";
import { canonicalModelFixture } from "../test_support/canonical_semantic_model.js";
import {
  authorizeCanonicalSemanticModel,
  buildCanonicalSemanticModel,
  loadCanonicalViews,
  withCanonicalSemanticModel,
} from "./canonical_semantic_model.js";

const canonicalViews: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "人员指标执行面",
    description: "权威执行面说明。",
    meta: {
      query_surface: "metric_source",
      time_source: "workforce",
      default_population_scope: "统计范围：权威口径。",
    },
    measures: [
      {
        name: "test_people_metrics.active_employee_count",
        title: "人员指标执行面 在职人数",
        shortTitle: "在职人数",
        description: "所选月末仍在职的去重人数。",
        type: "number",
        aggType: "countDistinct",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "last", window: "selected" },
        },
      },
    ],
    dimensions: [
      {
        name: "test_people_metrics.organization_name",
        title: "人员指标执行面 组织",
        shortTitle: "组织",
        description: "记录所属组织。",
        type: "string",
        meta: {
          dimension_group: "organization",
          dimension_kind: "categorical",
        },
      },
    ],
  },
];

const canonical = canonicalModelFixture(canonicalViews, TEST_SEMANTIC_TAXONOMY);

describe("CanonicalSemanticModel 权限投影", () => {
  test("用户 /meta 只决定可见性，不能覆盖权威语义合同", () => {
    const visible: CubeView[] = [
      {
        ...canonicalViews[0]!,
        title: "伪造标题",
        meta: {
          query_surface: "detail",
          time_source: "headcount_plan",
          default_population_scope: "伪造口径",
        },
        measures: canonicalViews[0]!.measures.map((member) => ({
          ...member,
          title: "伪造指标",
          description: "伪造说明",
          meta: {},
        })),
        dimensions: canonicalViews[0]!.dimensions.map((member) => ({
          ...member,
          title: "伪造维度",
          meta: { dimension_kind: "individual" },
        })),
      },
    ];

    const authorized = authorizeCanonicalSemanticModel(canonical, visible);
    expect(authorized.document.default_population_scope).toBe("统计范围：权威口径。");
    expect(authorized.document.views[0]).toMatchObject({
      title: "人员指标执行面",
      surface: "metric_source",
      time_source: "workforce",
    });
    expect(authorized.compiler.measures[0]).toMatchObject({
      title: "在职人数",
      description: "所选月末仍在职的去重人数。",
    });
    expect(authorized.compiler.dimensions[0]).toMatchObject({
      title: "组织",
      dimension_kind: "categorical",
    });
    expect(authorized.views[0]?.meta).toEqual(canonicalViews[0]?.meta);
  });

  test("不可见成员从目录、执行绑定和指标域同步消失", () => {
    const visible = [{ ...canonicalViews[0]!, measures: [] }];
    const authorized = authorizeCanonicalSemanticModel(canonical, visible);
    expect(authorized.compiler.measures).toEqual([]);
    expect(authorized.compiler.metric_domains).toEqual([]);
    expect(authorized.views[0]?.measures).toEqual([]);
  });

  test("只有明细 View 可见时不暴露空指标域", () => {
    const detail: CubeView = {
      ...canonicalViews[0]!,
      name: "test_people_records",
      title: "人员记录",
      meta: { ...canonicalViews[0]!.meta, query_surface: "detail" },
    };
    const model = canonicalModelFixture([...canonicalViews, detail], TEST_SEMANTIC_TAXONOMY);
    const authorized = authorizeCanonicalSemanticModel(model, [detail]);
    expect(authorized.document.metric_domains).toEqual([]);
    expect(authorized.compiler.measures).toEqual([]);
  });

  test("记录集字段不完整时同步隐藏记录投影能力", () => {
    const detail: CubeView = {
      name: "test_people_records",
      title: "人员记录",
      description: "受控人员记录。",
      meta: {
        query_surface: "detail",
        time_source: "workforce",
        default_population_scope: "统计范围：权威口径。",
        record_sets: {
          employee: {
            title: "人员记录",
            description: "构成人数的人员记录。",
            record_key: "record_key",
            entity_key: "employee_id",
            fields: [{ member: "employee_id" }],
            entity_order: [{ member: "record_key", direction: "asc" }],
          },
        },
      },
      measures: canonicalViews[0]!.measures.map((member) => ({
        ...member,
        name: "test_people_records.active_employee_count",
        meta: {
          ...member.meta,
          underlying_records: {
            record_set: "employee",
            selection: { kind: "self" },
          },
        },
      })),
      dimensions: [],
      internalDimensions: [
        {
          name: "test_people_records.record_key",
          title: "记录键",
          type: "string",
        },
        {
          name: "test_people_records.employee_id",
          title: "人员键",
          type: "string",
        },
      ],
    };
    const model = canonicalModelFixture([...canonicalViews, detail], TEST_SEMANTIC_TAXONOMY);
    const restrictedDetail = {
      ...detail,
      internalDimensions: detail.internalDimensions?.filter((member) =>
        member.name.endsWith("record_key"),
      ),
    };
    const authorized = authorizeCanonicalSemanticModel(model, [
      canonicalViews[0]!,
      restrictedDetail,
    ]);
    expect(authorized.compiler.measures[0]?.records_available).toBeUndefined();
    expect(authorized.compiler.measures[0]?.available_in).not.toContainEqual(
      expect.objectContaining({ records_available: true }),
    );
    expect(authorized.views[1]?.meta?.record_sets).toBeUndefined();
  });

  test("权限结果出现 canonical model 未登记的公开成员时 fail-closed", () => {
    const visible = [
      {
        ...canonicalViews[0]!,
        dimensions: [
          ...canonicalViews[0]!.dimensions,
          {
            name: "test_people_metrics.unknown_dimension",
            title: "未知维度",
            type: "string",
          },
        ],
      },
    ];
    expect(() => authorizeCanonicalSemanticModel(canonical, visible)).toThrow(
      "canonical model 中不存在的成员",
    );
  });

  test("能力目录与 Cube 编译指标漂移时 fail-closed", () => {
    expect(() =>
      buildCanonicalSemanticModel({
        capabilities: {
          facts: [],
          dimension_groups: [],
          metric_domains: [],
          time_sources: [],
        },
        views: canonicalViews,
        taxonomy: TEST_SEMANTIC_TAXONOMY,
        time_sources: TEST_TIME_SOURCE_REGISTRY,
      }),
    ).toThrow("指标能力目录");
  });

  test("启动读取 Cube /meta 时等待引擎就绪", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const views = await loadCanonicalViews({
      cube: {
        async meta() {
          attempts += 1;
          if (attempts < 3) throw new Error("Cube 尚未就绪");
          return canonicalViews;
        },
      },
      service_context: {
        subject: "service",
        groups: ["service"],
        orgScope: "*",
      },
      retry: {
        attempts: 3,
        delay_ms: 25,
        wait: async (delay) => {
          waits.push(delay);
        },
      },
    });
    expect(views).toBe(canonicalViews);
    expect(attempts).toBe(3);
    expect(waits).toEqual([25, 25]);
  });

  test("Cube gateway 的执行消费者也只收到 canonical 语义", async () => {
    const visible = [
      {
        ...canonicalViews[0]!,
        title: "请求期标题",
        dimensions: canonicalViews[0]!.dimensions.map((member) => ({
          ...member,
          meta: { dimension_kind: "individual" },
        })),
      },
    ];
    const gateway = withCanonicalSemanticModel(
      {
        meta: async () => visible,
        load: async () => ({
          data: [],
          annotation: { measures: {}, dimensions: {} },
        }),
        loadMulti: async () => [],
        sql: async () => [],
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
      canonical,
    );
    const views = await gateway.meta({
      subject: "test",
      groups: ["test"],
      orgScope: "*",
    });
    expect(views[0]?.title).toBe("人员指标执行面");
    expect(views[0]?.dimensions[0]?.meta?.dimension_kind).toBe("categorical");
  });
});
