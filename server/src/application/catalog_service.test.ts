/** CatalogService 集成纯桩：授权模型读取 /meta，翻值复用同一 context 走 /load 与上限协议。 */
import { describe, expect, spyOn, test } from "bun:test";
import { DIMENSION_VALUES_CAP, DIMENSION_VALUES_SCAN_LIMIT } from "../engine/dimension_values.js";
import type { Principal } from "../contracts/principal.js";
import type { CubeSecurityContext, CubeView, LoadResponse } from "../ports/cube_gateway.js";
import {
  buildCatalogDocument as buildRawCatalogDocument,
  toCompilerCatalog,
} from "../engine/catalog_document.js";
import {
  CatalogInputError,
  createCatalogService,
  SemanticModelUnavailableError,
} from "./catalog_service.js";
import {
  TEST_SEMANTIC_TAXONOMY,
  TEST_TIME_SOURCE_REGISTRY,
} from "../test_support/semantic_taxonomy.js";
import { canonicalModelFixture } from "../test_support/canonical_semantic_model.js";

const buildCatalogDocument = (views: CubeView[]) =>
  buildRawCatalogDocument(views, TEST_SEMANTIC_TAXONOMY, TEST_TIME_SOURCE_REGISTRY, {
    id: "test_scope",
    title: "测试数据范围",
  });

const principal: Principal = {
  email: "h@x",
  roles: ["user"],
  accessScope: { kind: "limited", values: ["Aurora Labs"] },
};
const context: CubeSecurityContext = {
  subject: principal.email,
  groups: ["pa_scoped"],
  accessScope: principal.accessScope,
};

const views: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "人员流动",
    meta: {
      query_surface: "metric_source",
      observation_scope: "统计范围",
      time_source: "workforce",
    },
    measures: [],
    dimensions: [
      {
        name: "test_people_metrics.organization_name",
        title: "组织",
        description: "员工所属组织。",
        type: "string",
        meta: {},
      },
    ],
  },
  {
    name: "employee_attributes_fixture",
    title: "在职员工信息",
    meta: {
      query_surface: "metric_source",
      observation_scope: "统计范围",
      time_source: "workforce",
    },
    measures: [],
    dimensions: [{ name: "employee_attributes_fixture.age", title: "年龄", type: "number" }],
  },
];
const canonical = canonicalModelFixture(views, TEST_SEMANTIC_TAXONOMY);
const noBusinessTerms = { resolve: async () => [] };
type CatalogServiceDependencies = Parameters<typeof createCatalogService>[0];
const createService = (
  deps: Omit<CatalogServiceDependencies, "businessTerms"> & {
    businessTerms?: CatalogServiceDependencies["businessTerms"];
  },
) => createCatalogService({ businessTerms: noBusinessTerms, ...deps });

// 翻值以语义 id 入参；从编译器目录取稳定 id（服务端再解析成物理绑定翻值）。
const catalogDimensions = toCompilerCatalog(buildCatalogDocument(views)).dimensions;
const dimId = (title: string) => {
  const found = catalogDimensions.find((dimension) => dimension.title === title);
  if (!found) throw new Error(`fixture 缺维度「${title}」`);
  return found.id;
};

describe("CatalogService", () => {
  test("授权上下文只用调用者身份读取 /meta", async () => {
    const seen: CubeSecurityContext[] = [];
    const service = createService({
      canonical,
      cube: {
        meta: async (received) => {
          seen.push(received);
          return views;
        },
        load: async () => {
          throw new Error("document 不应调用 /load");
        },
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
    });
    expect((await service.context(principal)).views.map((view) => view.name)).toEqual([
      "test_people_metrics",
      "employee_attributes_fixture",
    ]);
    expect(seen).toEqual([context]);
  });

  test("publicDocument 同时交付权限裁剪目录与权威数据截至月", async () => {
    const service = createService({
      canonical,
      cube: {
        meta: async () => views,
        load: async () => {
          throw new Error("publicDocument 不应调用 /load");
        },
        timeContext: async () => ({
          dataAsOf: "2026-07",
          sources: {
            workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
          },
        }),
      },
    });
    const document = await service.publicDocument(principal);
    expect(document.data_as_of).toBe("2026-07");
    expect(document.time_context).toEqual([
      {
        title: "人员数据",
        actual_through: "2026-07",
        available_through: "2026-07",
      },
    ]);
    expect(document.dimensions.map((dimension) => dimension.title)).toContain("组织");
  });

  test("术语读取失败只标记教学不可用，不放倒目录或改变成员检索", async () => {
    const cube = {
      meta: async () => views,
      load: async () => {
        throw new Error("document 不应调用 /load");
      },
      timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
    };
    const broken = createService({
      canonical,
      cube,
      businessTerms: {
        resolve: async () => {
          throw new Error("app.db 打不开");
        },
      },
    });
    const degraded = await broken.query(principal, { terms: ["组织"] });
    expect(degraded.term_knowledge_status).toBe("unavailable");
    expect(degraded.term_resolutions).toEqual([]);
    expect(degraded.dimensions.map((member) => member.title)).toContain("组织");
    const healthy = createService({
      canonical,
      cube,
      businessTerms: {
        resolve: async (inputs) => [
          {
            input_term: inputs[0]!,
            status: "resolved" as const,
            matches: [
              {
                id: "b1161af9-a5c1-4d28-b958-9185c04f7a51",
                canonical_term: "Band C+",
                definition: "职级处于 Band C及以上的示例人群。",
                aliases: [],
                related_members: [
                  {
                    id: dimId("组织"),
                    title: "组织",
                    kind: "dimension" as const,
                    status: "available" as const,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const resolved = await healthy.query(principal, { terms: ["Band C+"] });
    expect(resolved.term_knowledge_status).toBe("available");
    expect(resolved.term_resolutions[0]?.matches[0]?.definition).toBe(
      "职级处于 Band C及以上的示例人群。",
    );
    expect(resolved.matched_terms).toEqual(["Band C+"]);
    expect(resolved.dimensions.map((member) => member.title)).toContain("组织");
  });

  test("dimensionValues 以同一 context 走 /load，过滤空值并执行 200 条上限", async () => {
    const seen: Array<{ query: unknown; context: CubeSecurityContext }> = [];
    const data = [
      ...Array.from({ length: DIMENSION_VALUES_CAP + 1 }, (_, index) => ({
        "test_people_metrics.organization_name": `组织${String(index).padStart(3, "0")}`,
      })),
      { "test_people_metrics.organization_name": null },
      { "test_people_metrics.organization_name": "" },
    ];
    const service = createService({
      canonical,
      cube: {
        meta: async () => views,
        load: async (query, received) => {
          seen.push({ query, context: received });
          return {
            data,
            annotation: { measures: {}, dimensions: {} },
          } satisfies LoadResponse;
        },
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
    });
    const result = await service.dimensionValues(principal, dimId("组织"), "网约");
    expect(result.dimension).toBe(dimId("组织"));
    expect(result.values).toHaveLength(DIMENSION_VALUES_CAP);
    expect(result.truncated).toContain(`超过 ${DIMENSION_VALUES_CAP} 个`);
    expect(seen).toEqual([
      {
        context,
        query: {
          dimensions: ["test_people_metrics.organization_name"],
          filters: [
            {
              member: "test_people_metrics.organization_name",
              operator: "contains",
              values: ["网约"],
            },
          ],
          order: [["test_people_metrics.organization_name", "asc"]],
          limit: DIMENSION_VALUES_SCAN_LIMIT,
        },
      },
    ]);
  });

  test("空值占用 distinct 行时不误判恰好 200 个有效值为截断", async () => {
    const data = [
      ...Array.from({ length: DIMENSION_VALUES_CAP }, (_, index) => ({
        "test_people_metrics.organization_name": `组织${String(index).padStart(3, "0")}`,
      })),
      { "test_people_metrics.organization_name": null },
      { "test_people_metrics.organization_name": "" },
    ];
    const service = createService({
      canonical,
      cube: {
        meta: async () => views,
        load: async () => ({
          data,
          annotation: { measures: {}, dimensions: {} },
        }),
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
    });
    const result = await service.dimensionValues(principal, dimId("组织"));
    expect(result.values).toHaveLength(DIMENSION_VALUES_CAP);
    expect(result).not.toHaveProperty("truncated");
  });

  test("不可翻维度转成可识别的输入错误", async () => {
    const service = createService({
      canonical,
      cube: {
        meta: async () => views,
        load: async () => {
          throw new Error("不应调用");
        },
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
    });
    expect(service.dimensionValues(principal, dimId("年龄"))).rejects.toBeInstanceOf(
      CatalogInputError,
    );
  });

  test("模型诊断只进入 cause 与服务端日志，用户错误不暴露物理 View", async () => {
    const diagnostic = new Error(
      "执行 View test_people_metrics 的指标 active_employee_count 缺少 meta.metric_domain_id",
    );
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const service = createService({
      canonical,
      cube: {
        meta: async () => {
          throw diagnostic;
        },
        load: async () => {
          throw new Error("不应调用");
        },
        timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
      },
    });

    try {
      await service.context(principal);
      throw new Error("预期模型装配失败");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticModelUnavailableError);
      expect((error as Error).message).toBe("数据模型暂时不可用，请稍后重试");
      expect((error as Error).message).not.toContain("人员明细");
      expect((error as Error).message).not.toContain("test_people_metrics");
      expect((error as Error & { cause?: unknown }).cause).toBe(diagnostic);
      expect(logged).toHaveBeenCalledWith("[pa] 语义模型装配失败:", diagnostic);
    } finally {
      logged.mockRestore();
    }
  });
});
