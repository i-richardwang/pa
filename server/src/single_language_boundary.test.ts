/**
 * 单语言边界门禁：物理 Cube 绑定与选路只能活在服务端编译器目录。
 * 浏览器与对外公共契约不得重新依赖 CompilerCatalog 或任何编译器选路模块——它们只说语义。
 *
 * 静态断言：扫描 console/src 与 contracts/catalog_contract，禁止导入编译器内务模块。
 * 带存活自检：探测器必须命中已知违规样本，对合规导入零命中。
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalogDocument as buildRawCatalogDocument,
  searchCatalogDocument,
  toCompilerCatalog,
  toSemanticCatalog,
  type CatalogDocument,
} from "./engine/catalog_document.js";
import { catalogMember } from "./semantic_core/query_intent.js";
import { compileSemanticAnalysis } from "./engine/semantic_analysis_compiler.js";
import { parseSemanticAnalysisSpec } from "./semantic_core/semantic_analysis.js";
import { publicTimeContext } from "./application/time_context.js";
import type { CubeView, TimeContext } from "./ports/cube_gateway.js";
import { TEST_SEMANTIC_TAXONOMY } from "./test_support/semantic_taxonomy.js";

const buildCatalogDocument = (views: CubeView[]) =>
  buildRawCatalogDocument(views, TEST_SEMANTIC_TAXONOMY);

/** 编译器内务：只应在服务端编译边界内流转，绝不进浏览器或公共契约。 */
const FORBIDDEN = [
  "query_intent",
  "semantic_analysis_compiler",
  "record_projection_planner",
  "compiler_catalog",
];

const importsForbidden = (source: string): string[] =>
  FORBIDDEN.filter((specifier) => {
    // 只看 import/export ... from "…<specifier>…"，避免命中注释或普通字符串。
    const pattern = new RegExp(`(?:import|export)[^;]*from\\s*["'][^"']*${specifier}[^"']*["']`);
    return pattern.test(source);
  });

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) return [];
    return [full];
  });
}

const CONSOLE_SRC = join(import.meta.dir, "../console/src");
const CONTRACT = join(import.meta.dir, "contracts/catalog_contract.ts");

describe("单语言边界门禁", () => {
  it("探测器抓得住违规、放得过语义导入（存活自检）", () => {
    expect(
      importsForbidden(`import { planQueryIntent } from "../semantic_core/query_intent.js";`),
    ).toEqual(["query_intent"]);
    expect(
      importsForbidden(`import type { X } from "../semantic_core/compiler_catalog.js";`),
    ).toEqual(["compiler_catalog"]);
    expect(importsForbidden(`import { useState } from "react";`)).toEqual([]);
    // 语义契约导入不算违规
    expect(importsForbidden(`import type { CatalogPayload } from "@contract";`)).toEqual([]);
  });

  it("console/src 不导入任何编译器内务模块", () => {
    const offenders = tsFiles(CONSOLE_SRC).flatMap((file) => {
      const hits = importsForbidden(readFileSync(file, "utf8"));
      return hits.length ? [`${file}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("公共 catalog 契约不依赖 CompilerCatalog", () => {
    expect(importsForbidden(readFileSync(CONTRACT, "utf8"))).toEqual([]);
  });
});

/**
 * 最小语义/物理双投影夹具。语义 id 使用成员类型与规范短名；
 * 物理限定名、执行 view 名与 aliasMember 仍只在服务端编译目录中流转。
 */
const DOCUMENT: CatalogDocument = {
  default_population_scope: "统计口径：测试",
  views: [
    {
      name: "employee_and_key_talent",
      surface: "metric_source",
      title: "人员总览",
      time_source: "workforce",
      hierarchies: [],
      record_projection_members: [],
      calculation_input_titles: {},
      measures: [
        {
          name: "employee_and_key_talent.active_employee_count",
          kind: "measure",
          metric_domain_id: "metric_domain:workforce_structure",
          title: "在职人数",
          display_title: "在职人数",
          alias: "hc_col",
          value_type: "number",
          description: "月末在职",
          // 模型按物理短名声明互斥维度；投影必须归一为语义 id。
          incompatible_dimensions: ["organization_name"],
        },
      ],
      dimensions: [
        {
          name: "employee_and_key_talent.organization_name",
          kind: "dimension",
          title: "组织",
          display_title: "组织",
          alias: "org_col",
          value_type: "string",
          description: "组织名",
          dimension_kind: "categorical",
        },
      ],
    },
  ],
  metric_domains: [
    {
      id: "metric_domain:workforce_structure",
      title: "人员规模与结构",
      description: "人员规模与结构。",
      time_source: "workforce",
      synonyms: ["人员规模"],
    },
  ],
};

const HEADCOUNT_ID = "measure:active_employee_count";
const ORG_ID = "dimension:organization_name";

describe("单语言物理绑定不上线", () => {
  it("对外 SemanticCatalog 的成员无物理绑定，指标域保留稳定 id", () => {
    const semantic = toSemanticCatalog(DOCUMENT);
    for (const member of [...semantic.measures, ...semantic.dimensions]) {
      expect(member).not.toHaveProperty("name");
      expect(member).not.toHaveProperty("available_in");
    }
    for (const topic of semantic.metric_domains) {
      expect(topic.id).toBe("metric_domain:workforce_structure");
      expect(topic).not.toHaveProperty("name");
      expect(topic).not.toHaveProperty("hierarchies");
      // 指标域只上数据时间业务标签，绝不上内部 time_source key。
      expect(topic).not.toHaveProperty("time_source");
      expect(topic.time_context_title).toBe("人员数据");
    }
    // incompatible_dimensions 归一为语义 id（规范短名 organization_name → dimension:organization_name）
    expect(semantic.measures[0]?.incompatible_dimensions).toEqual([ORG_ID]);
    // 整份线载荷里不出现成员物理限定名或 aliasMember。
    const wire = JSON.stringify(semantic);
    expect(wire).not.toContain("hc_col");
    // 内部时间源 key 不上线
    expect(wire).not.toContain('"time_source":"workforce"');
  });

  it("公共时间上下文是业务标签数组，内部 source key 去重后不上线", () => {
    const context: TimeContext = {
      dataAsOf: "2026-06",
      sources: {
        workforce: { actualThrough: "2026-06", availableThrough: "2026-07" },
      },
    };
    // 两个视图共用同一内部 source，按 source key 去重为一项；标题是业务标签而非内部 key
    const out = publicTimeContext(
      [{ time_source: "workforce" }, { time_source: "workforce" }],
      context,
    );
    expect(out).toEqual([
      { title: "人员数据", actual_through: "2026-06", available_through: "2026-07" },
    ]);
    expect(JSON.stringify(out)).not.toContain("workforce");
    expect(() =>
      publicTimeContext([{ time_source: "unregistered_physical_clock" }], {
        dataAsOf: "2026-06",
        sources: {
          unregistered_physical_clock: {
            actualThrough: "2026-06",
            availableThrough: "2026-06",
          },
        },
      }),
    ).toThrow("未登记的时间来源");
  });

  it("编译产出的语义路由只讲业务血缘，键集合全等", () => {
    const compiled = compileSemanticAnalysis(
      toCompilerCatalog(DOCUMENT),
      parseSemanticAnalysisSpec({
        version: 2,
        analysis: {
          views: [
            {
              id: "v1",
              measures: [HEADCOUNT_ID],
              time: {
                window: { kind: "current_month", month: "2026-07" },
              },
            },
          ],
        },
        presentation: { type: "table" },
      }),
    );
    const route = compiled.routes.find((r) => r.view_id === "v1");
    expect(route?.status).toBe("direct");
    // 全等而非排除：直查血缘只有状态与语义视图 id，选路字段无从随实现变化混入。
    expect(Object.keys(route!).sort()).toEqual(["status", "view_id"]);
    // 对外血缘里不出现物理执行 view 名
    expect(JSON.stringify(compiled.routes)).not.toContain("employee_and_key_talent");
  });
});

describe("语义解析 fail-closed", () => {
  it("物理成员名解析失败，语义 id 正常", () => {
    const compiler = toCompilerCatalog(DOCUMENT);
    // 语义 id 命中
    expect(catalogMember(compiler, HEADCOUNT_ID, "measure")?.id).toBe(HEADCOUNT_ID);
    expect(catalogMember(compiler, ORG_ID, "dimension")?.id).toBe(ORG_ID);
    // 物理限定名与裸短名一律不命中
    expect(
      catalogMember(compiler, "employee_and_key_talent.active_employee_count", "measure"),
    ).toBeUndefined();
    expect(
      catalogMember(compiler, "employee_and_key_talent.organization_name", "dimension"),
    ).toBeUndefined();
    expect(catalogMember(compiler, "hc_col", "measure")).toBeUndefined();
  });

  it("编译器目录仍保留物理绑定供服务端选路", () => {
    const compiler = toCompilerCatalog(DOCUMENT);
    const active_employee_count = catalogMember(compiler, HEADCOUNT_ID, "measure");
    expect(active_employee_count?.available_in[0]?.member).toBe(
      "employee_and_key_talent.active_employee_count",
    );
    expect(active_employee_count?.available_in[0]?.view).toBe("employee_and_key_talent");
    // 业务词典只教学、不参与选路；编译器目录从类型与运行时都不承载它。
    expect(compiler).not.toHaveProperty("business_terms");
  });
});

const CALIBRE = "统计范围：测试。";

/** 从原始 Cube view 造夹具（走 buildCatalogDocument 真实装配路径，互斥维度从 meta 提取）。 */
function fixtureView(name: string, _rank: number, over: Partial<CubeView>): CubeView {
  const { meta, ...rest } = over;
  return {
    name,
    title: `场景${name}`,
    measures: [],
    dimensions: [],
    ...rest,
    meta: {
      default_population_scope: CALIBRE,
      query_surface: "metric_source",
      time_source: "workforce",
      ...meta,
    },
  };
}
const orgDim = (view: string): CubeView["dimensions"][number] => ({
  name: `${view}.organization_name`,
  title: "组织",
  shortTitle: "组织",
  description: "组织。",
  type: "string",
  aliasMember: `${view}_fact.organization_name`,
  meta: {},
});
const deptDim = (
  view: string,
  title: string,
  member = "department_name",
): CubeView["dimensions"][number] => ({
  name: `${view}.${member}`,
  title,
  shortTitle: title,
  description: `${title}。`,
  type: "string",
  aliasMember: `${view}_fact.${member}`,
  meta: {},
});
const planMeasure = (
  view: string,
  incompatible?: { member: string; reason: string }[],
): CubeView["measures"][number] => ({
  name: `${view}.plan`,
  title: "编制人数",
  shortTitle: "编制人数",
  description: "编制人数。",
  type: "number",
  aggType: "sum",
  meta: {
    metric_domain_id: "metric_domain:headcount_plan",
    time_contract: { aggregation: "last", window: "selected" },
    ...(incompatible ? { incompatible_dimensions: incompatible } : {}),
  },
});

describe("互斥维度按共享语义身份解析（fail-closed，无名称关联）", () => {
  const collisionViews = (wfRank: number, hcRank: number): CubeView[] => [
    fixtureView("wf", wfRank, { dimensions: [orgDim("wf"), deptDim("wf", "部门")] }),
    fixtureView("hc", hcRank, {
      dimensions: [orgDim("hc"), deptDim("hc", "部门")],
      measures: [
        planMeasure("hc", [{ member: "department_name", reason: "年底口径只在组织层。" }]),
      ],
    }),
  ];

  it("不同执行来源的同一部门规范成员归并为一个语义维度", () => {
    const compiler = toCompilerCatalog(buildCatalogDocument(collisionViews(1, 2)));
    const departments = compiler.dimensions.filter((d) => d.title === "部门");
    const plan = compiler.measures.find((m) => m.title === "编制人数")!;
    expect(departments).toHaveLength(1);
    expect(departments[0]?.id).toBe("dimension:department_name");
    expect(plan.incompatible_dimensions).toEqual(["dimension:department_name"]);
  });

  it("调换视图策展顺序不改变解析结果", () => {
    const forward = toCompilerCatalog(buildCatalogDocument(collisionViews(1, 2)));
    const swapped = toCompilerCatalog(buildCatalogDocument(collisionViews(2, 1)));
    const planForward = forward.measures.find((m) => m.title === "编制人数")!;
    const planSwapped = swapped.measures.find((m) => m.title === "编制人数")!;
    expect(planForward.incompatible_dimensions).toEqual(planSwapped.incompatible_dimensions);
  });

  it("聚焦 View 未投影互斥维度时由结构性不可用替代重复声明", () => {
    const views = [
      fixtureView("hc", 1, {
        dimensions: [orgDim("hc")],
        measures: [planMeasure("hc", [{ member: "department_name", reason: "x" }])],
      }),
    ];
    expect(
      toCompilerCatalog(buildCatalogDocument(views)).measures[0]?.incompatible_dimensions,
    ).toBeUndefined();
  });

  it("多命中（歧义）目录装配失败", () => {
    // 两个不同维度的 name 短名与 aliasMember 短名交叉塌成同一 token department_name
    const ambiguous = fixtureView("hc", 1, {
      dimensions: [
        {
          name: "hc.department_name",
          title: "部门甲",
          shortTitle: "部门甲",
          description: "部门。",
          type: "string",
          aliasMember: "hc_fact.dept_alpha",
          meta: {},
        },
        {
          name: "hc.dept_beta",
          title: "另一部门",
          shortTitle: "另一部门",
          description: "部门。",
          type: "string",
          aliasMember: "hc_fact.department_name",
          meta: {},
        },
      ],
      measures: [planMeasure("hc", [{ member: "department_name", reason: "x" }])],
    });
    expect(() => toCompilerCatalog(buildCatalogDocument([ambiguous]))).toThrow(/歧义/);
  });

  it("同一指标不能在两个普通执行 View 重复投影", () => {
    const views = [
      fixtureView("wf", 1, {
        dimensions: [orgDim("wf"), deptDim("wf", "部门")],
        measures: [planMeasure("wf", [{ member: "department_name", reason: "x" }])],
      }),
      fixtureView("hc", 2, {
        dimensions: [orgDim("hc"), deptDim("hc", "部门")],
        measures: [planMeasure("hc", [{ member: "department_name", reason: "x" }])],
      }),
    ];
    expect(() => toCompilerCatalog(buildCatalogDocument(views))).toThrow(
      /只能归属一个普通执行 View/,
    );
  });

  it("同一规范短名声明为不同语义时目录装配失败", () => {
    const views = [
      fixtureView("wf", 1, { dimensions: [deptDim("wf", "部门")] }),
      fixtureView("hc", 2, { dimensions: [deptDim("hc", "另一类部门")] }),
    ];
    expect(() => buildCatalogDocument(views)).not.toThrow();
    expect(() => toCompilerCatalog(buildCatalogDocument(views))).toThrow(
      /不同语义必须使用不同成员名/,
    );
  });
});

describe("公共 catalog 检索不接受物理成员语言", () => {
  const fixture = fixtureView("fact_x", 1, {
    title: "人员场景",
    meta: {
      default_population_scope: CALIBRE,
    },
    dimensions: [orgDim("fact_x")],
    measures: [
      {
        name: "fact_x.hc",
        title: "在职人数",
        shortTitle: "在职人数",
        description: "在职人数。",
        type: "number",
        aggType: "count",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "last", window: "selected" },
        },
      },
    ],
  });
  const document = buildCatalogDocument([fixture]);

  it("业务标题命中，物理 view 名 / 限定成员名 / 裸短名一律进 unmatched_terms", () => {
    expect(searchCatalogDocument(document, ["在职人数"]).measures.map((m) => m.title)).toContain(
      "在职人数",
    );
    const physical = searchCatalogDocument(document, ["fact_x", "fact_x.hc", "organization_name"]);
    expect(physical.measures).toHaveLength(0);
    expect(physical.dimensions).toHaveLength(0);
    expect(physical.unmatched_terms.slice().sort()).toEqual([
      "fact_x",
      "fact_x.hc",
      "organization_name",
    ]);
  });

  it("业务域同义词来自全局语义分类，而非物理 View 名兼容", () => {
    const hit = searchCatalogDocument(document, ["人员规模"]);
    expect(hit.matched_terms).toContain("人员规模");
    expect(hit.measures.map((m) => m.title)).toContain("在职人数");
  });
});
