/**
 * Demo 能力地图夹具漂移门禁：参考 JSON 必须等于 Demo 分类、正式指标图与 Cube 模型装配结果。
 * 装配器测试同时锁定全局维度身份、业务指标域归属和物理事实血缘的 fail-closed 合同。
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { semanticCatalogFormalMetrics } from "./engine/metric_model.js";
import { projectDataCapabilityMap } from "./presentation_core/data_capability_map.js";
import {
  buildSemanticModelCatalog,
  type SemanticCatalogFormalMetric,
  type SemanticModelYamlFile,
} from "./semantic_core/semantic_model_catalog.js";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./engine/semantic_package.js";

const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const modelRoot = semanticPackage.model_root;
const dataUrl = new URL(
  "../console/src/dashboard/catalog/data_capability_map_data.json",
  import.meta.url,
);

async function modelFiles(): Promise<SemanticModelYamlFile[]> {
  const files: SemanticModelYamlFile[] = [];
  for (const dir of ["cubes", "views"]) {
    const entries = (await readdir(join(modelRoot, dir))).filter((f) => f.endsWith(".yml")).sort();
    for (const entry of entries) {
      files.push({
        path: `${dir}/${entry}`,
        text: await readFile(join(modelRoot, dir, entry), "utf8"),
      });
    }
  }
  return files;
}

function buildMap(
  files: SemanticModelYamlFile[],
  formalMetrics: readonly SemanticCatalogFormalMetric[] = [],
) {
  return projectDataCapabilityMap(
    buildSemanticModelCatalog(
      files,
      semanticPackage.taxonomy,
      semanticPackage.time_sources,
      formalMetrics,
    ),
  );
}

test("Demo 能力地图参考夹具与统一语义模型一致", async () => {
  const catalog = buildSemanticModelCatalog(
    await modelFiles(),
    semanticPackage.taxonomy,
    semanticPackage.time_sources,
    semanticCatalogFormalMetrics(semanticPackage.formal_metrics),
  );
  const built = projectDataCapabilityMap(catalog);
  const reference = JSON.parse(await readFile(dataUrl, "utf8"));
  expect(reference).toEqual(built);
});

test("统一语义目录装配唯一的数据时钟锚点", async () => {
  const catalog = buildSemanticModelCatalog(
    await modelFiles(),
    semanticPackage.taxonomy,
    semanticPackage.time_sources,
    semanticCatalogFormalMetrics(semanticPackage.formal_metrics),
  );
  expect(catalog.time_sources).toEqual([
    {
      key: "workforce",
      anchor: { view: "employee_snapshot_metrics", measure: "active_headcount" },
    },
    {
      key: "headcount_plan",
      anchor: { view: "headcount_plan_metrics", measure: "planned_headcount" },
    },
    {
      key: "survey",
      anchor: { view: "q12_survey_participation_metrics", measure: "q12_invited_count" },
    },
  ]);
});

test("地图呈现七张公开演示事实、四个业务指标域且不引入运行时 join", async () => {
  const graph = buildMap(
    await modelFiles(),
    semanticCatalogFormalMetrics(semanticPackage.formal_metrics),
  );
  expect(graph.facts.map((fact) => fact.name)).toEqual([
    "department_headcount_plan_fact",
    "employee_hire_event_fact",
    "employee_leave_event_fact",
    "employee_month_snapshot_fact",
    "q12_survey_participation_fact",
    "q12_survey_response_fact",
    "workforce_month_exposure_fact",
  ]);
  expect(graph.metric_domains.map((domain) => domain.id)).toEqual([
    "metric_domain:workforce_structure",
    "metric_domain:workforce_movement",
    "metric_domain:headcount_plan",
    "metric_domain:employee_engagement",
  ]);
  expect(
    Object.fromEntries(
      graph.metric_domains.map((domain) => [
        domain.id,
        domain.bindings.map((binding) => binding.fact),
      ]),
    ),
  ).toEqual({
    "metric_domain:workforce_structure": ["employee_month_snapshot_fact"],
    "metric_domain:workforce_movement": [
      "employee_hire_event_fact",
      "employee_leave_event_fact",
      "workforce_month_exposure_fact",
    ],
    "metric_domain:headcount_plan": [
      "department_headcount_plan_fact",
      "employee_month_snapshot_fact",
    ],
    "metric_domain:employee_engagement": [
      "q12_survey_participation_fact",
      "q12_survey_response_fact",
    ],
  });
});

test("维度构件是全局语义身份，事实只保留物理绑定", async () => {
  const graph = buildMap(
    await modelFiles(),
    semanticCatalogFormalMetrics(semanticPackage.formal_metrics),
  );
  expect(graph.dimension_groups.map((group) => group.name)).toEqual([
    "organization",
    "employment",
    "employee_basic_info",
    "job_and_level",
    "termination_event",
    "survey_wave",
  ]);
  expect(new Set(graph.dimension_groups.map((group) => group.name)).size).toBe(
    graph.dimension_groups.length,
  );
  expect(
    Object.fromEntries(graph.dimension_groups.map((group) => [group.name, group.bindings.length])),
  ).toEqual({
    organization: 7,
    employment: 6,
    employee_basic_info: 6,
    job_and_level: 6,
    termination_event: 1,
    survey_wave: 2,
  });

  const grouped = new Set(
    graph.dimension_groups.flatMap((group) =>
      group.bindings.flatMap((binding) =>
        binding.members.map((member) => `${binding.fact}.${member}`),
      ),
    ),
  );
  for (const fact of graph.facts) {
    for (const member of fact.members) {
      if (member.kind !== "dimension" || member.internal) continue;
      expect(grouped.has(`${fact.name}.${member.name}`)).toBe(true);
    }
  }
});

const validCube = `
cubes:
  - name: demo_fact
    dimensions:
      - name: department_name
        title: 部门名称
        type: string
        meta: { dimension_group: organization }
    measures:
      - name: total
        title: 总数
        type: count
        meta: { metric_domain_id: metric_domain:workforce_structure }
`;

const validView = `
views:
  - name: demo_metrics
    meta:
      query_surface: metric_source
      time_source: workforce
      time_anchor_measure: total
    cubes:
      - join_path: demo_fact
        includes: [department_name, total]
`;

test("执行 View 对不存在成员的投影 fail-closed", () => {
  const brokenView = validView.replace("total]", "missing_member]");
  expect(() =>
    buildMap([
      { path: "cubes/demo.yml", text: validCube },
      { path: "views/demo.yml", text: brokenView },
    ]),
  ).toThrow("不存在成员");
});

test("业务指标域属于指标，执行 View 不得声明域身份", () => {
  const viewWithDomain = validView.replace(
    "query_surface: metric_source",
    "query_surface: metric_source\n      metric_domain_id: metric_domain:workforce_structure",
  );
  expect(() =>
    buildMap([
      { path: "cubes/demo.yml", text: validCube },
      { path: "views/demo.yml", text: viewWithDomain },
    ]),
  ).toThrow("执行 View 不得声明 metric_domain_id");
});

test("公开叶子指标必须归属已登记的业务指标域", () => {
  const missingDomain = validCube.replace(
    "meta: { metric_domain_id: metric_domain:workforce_structure }",
    "",
  );
  expect(() =>
    buildMap([
      { path: "cubes/demo.yml", text: missingDomain },
      { path: "views/demo.yml", text: validView },
    ]),
  ).toThrow("公开指标 total 缺少 metric_domain_id");

  const unknownDomain = validCube.replace(
    "metric_domain:workforce_structure",
    "metric_domain:unknown",
  );
  expect(() =>
    buildMap([
      { path: "cubes/demo.yml", text: unknownDomain },
      { path: "views/demo.yml", text: validView },
    ]),
  ).toThrow("未登记的业务指标域");
});

test("受控明细 View 不进入业务指标域与普通指标来源", () => {
  const detailView = validView
    .replace("metric_source", "detail")
    .replace("      time_anchor_measure: total\n", "");
  const graph = buildMap([
    { path: "cubes/demo.yml", text: validCube },
    { path: "views/detail.yml", text: detailView },
  ]);
  expect(graph.metric_domains).toEqual([]);
});

test("统一语义目录拒绝运行时事实 join", () => {
  const withBadJoin = `
cubes:
  - name: demo_fact
    joins:
      - name: nowhere
        relationship: many_to_one
        sql: "1 = 1"
    measures:
      - name: total
        type: count
`;
  expect(() => buildMap([{ path: "cubes/demo.yml", text: withBadJoin }])).toThrow(
    "不得声明运行时 join",
  );

  // joins 键不允许出现，空数组同样拒绝。
  const emptyJoin = withBadJoin.replace(
    '    joins:\n      - name: nowhere\n        relationship: many_to_one\n        sql: "1 = 1"\n',
    "    joins: []\n",
  );
  expect(emptyJoin).toContain("joins: []");
  expect(() => buildMap([{ path: "cubes/demo.yml", text: emptyJoin }])).toThrow(
    "不得声明运行时 join",
  );
});

test("事实公开维度必须归属已登记的全局维度构件", () => {
  const ungrouped = validCube.replace("meta: { dimension_group: organization }", "");
  expect(() => buildMap([{ path: "cubes/demo.yml", text: ungrouped }])).toThrow(
    "缺少 dimension_group",
  );

  const unknownGroup = validCube.replace(
    "dimension_group: organization",
    "dimension_group: nowhere",
  );
  expect(() => buildMap([{ path: "cubes/demo.yml", text: unknownGroup }])).toThrow(
    "未登记的属性组",
  );
});

test("同名规范维度不得跨构件归属或产生不同公开契约", () => {
  const conflictingGroup = `
cubes:
  - name: fact_a
    dimensions:
      - name: shared_name
        title: 同名维度
        type: string
        meta: { dimension_group: organization }
    measures: [{ name: total_a, type: count }]
  - name: fact_b
    dimensions:
      - name: shared_name
        title: 同名维度
        type: string
        meta: { dimension_group: employee_basic_info }
    measures: [{ name: total_b, type: count }]
`;
  expect(() => buildMap([{ path: "cubes/demo.yml", text: conflictingGroup }])).toThrow("同时归属");

  const conflictingContract = conflictingGroup
    .replace("dimension_group: employee_basic_info", "dimension_group: organization")
    .replace(
      "title: 同名维度\n        type: string\n        meta: { dimension_group: organization }\n    measures: [{ name: total_b",
      "title: 另一含义\n        type: string\n        meta: { dimension_group: organization }\n    measures: [{ name: total_b",
    );
  expect(() => buildMap([{ path: "cubes/demo.yml", text: conflictingContract }])).toThrow(
    "公开契约不一致",
  );
});

test("非公开成员必须声明可解释职责", () => {
  const missingRole = `
cubes:
  - name: demo_fact
    dimensions:
      - name: record_key
        type: string
        public: false
    measures:
      - name: total
        type: count
`;
  expect(() => buildMap([{ path: "cubes/demo.yml", text: missingRole }])).toThrow(
    "缺少 member_role",
  );
});
