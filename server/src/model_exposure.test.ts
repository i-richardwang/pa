/** 公开 Demo 语义包的结构检查：展示产品能力，不包含任何内部源表或公司专属口径。 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./engine/semantic_package.js";

const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const modelRoot = semanticPackage.model_root;

type Member = {
  name: string;
  title?: string;
  description?: string;
  public?: boolean;
  type?: string;
  meta?: Record<string, unknown>;
};
type Cube = {
  name: string;
  extends?: string;
  sql?: string;
  meta?: Record<string, unknown>;
  joins?: unknown;
  dimensions?: Member[];
  measures?: Member[];
};
type View = {
  name: string;
  title?: string;
  description?: string;
  meta?: Record<string, unknown> & { record_sets?: Record<string, unknown> };
  cubes: { join_path: string; includes: "*" | string[] }[];
};

function load<T>(directory: "cubes" | "views", key: "cubes" | "views"): T[] {
  return readdirSync(join(modelRoot, directory))
    .filter((file) => file.endsWith(".yml"))
    .sort()
    .flatMap((file) => {
      const document = Bun.YAML.parse(readFileSync(join(modelRoot, directory, file), "utf8")) as {
        cubes?: T[];
        views?: T[];
      };
      return document[key] ?? [];
    });
}

const cubes = load<Cube>("cubes", "cubes");
const views = load<View>("views", "views");
const facts = cubes.filter((cube) => cube.meta?.model_role !== "template");
const metricViews = views.filter((view) => view.meta?.query_surface === "metric_source");
const detailViews = views.filter((view) => view.meta?.query_surface === "detail");

describe("公开 Demo 语义包", () => {
  test("用独立的宽事实表演示跨表指标，不定义运行时 join", () => {
    expect(semanticPackage.id).toBe("pa_demo");
    expect(facts.map((fact) => fact.name).sort()).toEqual([
      "department_headcount_plan_fact",
      "employee_hire_event_fact",
      "employee_leave_event_fact",
      "employee_month_snapshot_fact",
      "q12_survey_participation_fact",
      "q12_survey_response_fact",
      "workforce_month_exposure_fact",
    ]);
    for (const fact of facts) {
      expect(fact.sql, fact.name).toContain(`/semantic/current/${fact.name}.parquet`);
      expect(fact.joins, fact.name).toBeUndefined();
    }
  });

  test("每个执行 View 只绑定一张事实表，明细 View 通过记录集显式开放", () => {
    expect(metricViews.map((view) => view.name).sort()).toEqual([
      "employee_hire_metrics",
      "employee_leave_metrics",
      "employee_snapshot_metrics",
      "headcount_plan_metrics",
      "q12_survey_participation_metrics",
      "q12_survey_response_metrics",
      "workforce_exposure_metrics",
    ]);
    expect(detailViews.map((view) => view.name).sort()).toEqual([
      "employee_hire_records",
      "employee_leave_records",
      "employee_snapshot_records",
    ]);
    for (const view of views) {
      expect(view.cubes).toHaveLength(1);
      if (view.meta?.query_surface === "detail") {
        expect(view.cubes[0]?.includes).toBe("*");
        expect(Object.keys(view.meta.record_sets ?? {})).toHaveLength(1);
      } else {
        expect(Array.isArray(view.cubes[0]?.includes)).toBe(true);
      }
    }
  });

  test("正式指标来自语义包声明，其组成指标和所在 View 都能在物理模型中找到", () => {
    const leafMeasures = new Set(
      facts.flatMap((fact) => (fact.measures ?? []).map((measure) => measure.name)),
    );
    const viewNames = new Set(views.map((view) => view.name));
    const formalNames = new Set(semanticPackage.formal_metrics.map((metric) => metric.name));
    expect(formalNames.size).toBe(semanticPackage.formal_metrics.length);
    for (const metric of semanticPackage.formal_metrics) {
      expect(viewNames.has(metric.host_view), metric.name).toBe(true);
      const components =
        metric.node.kind === "ratio"
          ? [metric.node.numerator, metric.node.denominator]
          : [metric.node.value, metric.node.availability];
      for (const component of components) {
        const name = component.metric_id.slice("measure:".length);
        expect(leafMeasures.has(name) || formalNames.has(name), `${metric.name} -> ${name}`).toBe(
          true,
        );
      }
    }
  });

  test("公开成员都有完整说明，并只引用包内登记的分类", () => {
    const domains = new Set<string>(
      semanticPackage.taxonomy.metric_domains.map((domain) => domain.id),
    );
    const groups = new Set(semanticPackage.taxonomy.dimension_groups.map((group) => group.name));
    const missing: string[] = [];
    for (const fact of facts) {
      for (const member of [...(fact.dimensions ?? []), ...(fact.measures ?? [])]) {
        const internal = member.public === false || member.meta?.internal === true;
        if (!internal && (!member.title?.trim() || !member.description?.trim())) {
          missing.push(`${fact.name}.${member.name}`);
        }
        const domain = member.meta?.metric_domain_id;
        if (domain !== undefined) expect(domains.has(String(domain)), member.name).toBe(true);
        const group = member.meta?.dimension_group;
        if (group !== undefined) expect(groups.has(String(group)), member.name).toBe(true);
      }
    }
    expect(missing).toEqual([]);
  });
});
