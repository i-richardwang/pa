import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import {
  ACCESS_SCOPE_DEFINITION_SCHEMA,
  type AccessScopeDefinition,
} from "../semantic_core/access_scope_definition.js";
import { semanticCatalogFormalMetrics, type FormalMetricDefinition } from "./metric_model.js";
import {
  METRIC_DOMAIN_ID_PATTERN,
  type MetricDomainId,
} from "../semantic_core/metric_domain_id.js";
import { METRIC_TIME_CONTRACT_SCHEMA } from "../semantic_core/metric_time_contract.js";
import type {
  DimensionGroupDefinition,
  MetricDomainDefinition,
  SemanticTaxonomy,
} from "../semantic_core/semantic_taxonomy.js";
import {
  buildSemanticModelCatalog,
  type SemanticModelCatalog,
  type SemanticModelYamlFile,
} from "../semantic_core/semantic_model_catalog.js";
import { buildTimeSourceRegistry, type TimeSourceRegistry } from "../semantic_core/time_source.js";

const memberName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const metricId = z.string().regex(METRIC_DOMAIN_ID_PATTERN);
const component = z.strictObject({
  metric_id: z.string().regex(/^measure:[a-z][a-z0-9_]*$/),
  missing: z.enum(["null", "zero"]),
});
const ratioNode = z.strictObject({
  kind: z.literal("ratio"),
  numerator: component,
  denominator: component,
  division_by_zero: z.literal("null"),
});
const availabilityGuardNode = z.strictObject({
  kind: z.literal("availability_guard"),
  value: component,
  availability: component,
  unavailable: z.literal("null"),
});
const recordSelection = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("self") }),
  z.strictObject({ kind: z.literal("numerator") }),
  z.strictObject({ kind: z.literal("measure"), member: memberName }),
]);
const formalMetric = z.strictObject({
  name: memberName,
  metric_domain_id: metricId,
  host_view: memberName,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).max(160),
  time_contract: METRIC_TIME_CONTRACT_SCHEMA,
  node: z.discriminatedUnion("kind", [ratioNode, availabilityGuardNode]),
  format: z.enum(["number", "percent"]).optional(),
  result_guards: z
    .array(
      z.strictObject({
        kind: z.literal("minimum_support"),
        support_measure: memberName,
        threshold: z.int().positive(),
      }),
    )
    .min(1)
    .optional(),
  sensitivity: z.literal("restricted").optional(),
  ai_context: z.string().trim().min(1).max(180).optional(),
  incompatible_dimensions: z
    .array(z.strictObject({ member: memberName, reason: z.string().trim().min(1) }))
    .optional(),
  record_projection: z
    .strictObject({
      view: memberName,
      components: z.strictObject({ numerator: memberName, denominator: memberName }).optional(),
      underlying_records: z.strictObject({ record_set: memberName, selection: recordSelection }),
    })
    .optional(),
});
const metricDomain = z.strictObject({
  id: metricId,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  time_source: memberName,
  synonyms: z.array(z.string().trim().min(1)),
});
const dimensionGroup = z.strictObject({
  name: memberName,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
});
const manifestSchema = z.strictObject({
  schema_version: z.literal(1),
  id: memberName,
  model_path: z.string().trim().min(1),
  access_scope: ACCESS_SCOPE_DEFINITION_SCHEMA,
  time_sources: z
    .array(
      z.strictObject({
        id: memberName,
        title: z.string().trim().min(1),
        role: z.enum(["actual", "plan"]),
        primary: z.boolean(),
        reference_source: memberName.optional(),
        comparison_policy: z.enum(["calendar", "explicit_only"]),
        observation: z
          .strictObject({
            id_member: memberName,
            date_member: memberName,
            title_member: memberName.optional(),
          })
          .optional(),
      }),
    )
    .min(1),
  taxonomy: z.strictObject({
    metric_domains: z.array(metricDomain).min(1),
    dimension_groups: z.array(dimensionGroup).min(1),
  }),
  formal_metrics: z.array(formalMetric),
});

export type SemanticPackage = {
  schema_version: 1;
  id: string;
  root: string;
  model_root: string;
  access_scope: AccessScopeDefinition;
  time_sources: TimeSourceRegistry;
  taxonomy: SemanticTaxonomy;
  formal_metrics: readonly FormalMetricDefinition[];
};

function unique(values: readonly string[], owner: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`语义包 ${owner} 不得重复`);
  }
}

function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("语义包 model_path 必须是包内相对路径");
  const target = resolve(root, path);
  const offset = relative(root, target);
  if (offset === ".." || offset.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("语义包 model_path 不得离开包目录");
  }
  return target;
}

/** 加载只含声明的版本化语义包；包不能执行代码，模型路径不得逃逸包目录。 */
export async function loadSemanticPackage(root: string): Promise<SemanticPackage> {
  const packageRoot = resolve(root);
  const manifestPath = resolve(packageRoot, "semantic_package.yml");
  const raw = parse(await readFile(manifestPath, "utf8"));
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`语义包 ${manifestPath} 不符合 schema_version 1 合同`, {
      cause: parsed.error,
    });
  }
  const modelRoot = resolveInside(packageRoot, parsed.data.model_path);
  for (const directory of ["cubes", "views"]) {
    const info = await stat(resolve(modelRoot, directory)).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`语义包缺少模型目录 ${directory}`);
  }
  const taxonomy: SemanticTaxonomy = {
    metric_domains: parsed.data.taxonomy.metric_domains as MetricDomainDefinition[],
    dimension_groups: parsed.data.taxonomy.dimension_groups as DimensionGroupDefinition[],
  };
  const timeSources = buildTimeSourceRegistry(parsed.data.time_sources);
  unique(
    taxonomy.metric_domains.map((domain) => domain.id),
    "metric_domains.id",
  );
  for (const domain of taxonomy.metric_domains) {
    if (!timeSources.by_id.has(domain.time_source)) {
      throw new Error(`语义包业务指标域 ${domain.id} 引用了未登记的时间来源`);
    }
  }
  unique(
    taxonomy.dimension_groups.map((group) => group.name),
    "dimension_groups.name",
  );
  unique(
    parsed.data.formal_metrics.map((metric) => metric.name),
    "formal_metrics.name",
  );
  const knownDomains = new Set<MetricDomainId>(taxonomy.metric_domains.map((domain) => domain.id));
  for (const metric of parsed.data.formal_metrics) {
    if (!knownDomains.has(metric.metric_domain_id as MetricDomainId)) {
      throw new Error(`语义包正式指标 ${metric.name} 引用了未登记的业务指标域`);
    }
    unique(
      (metric.result_guards ?? []).map((guard) => guard.kind),
      `formal_metrics.${metric.name}.result_guards.kind`,
    );
  }
  return {
    schema_version: 1,
    id: parsed.data.id,
    root: packageRoot,
    model_root: modelRoot,
    access_scope: parsed.data.access_scope,
    time_sources: timeSources,
    taxonomy,
    formal_metrics: parsed.data.formal_metrics as FormalMetricDefinition[],
  };
}

/** 以包目录为唯一模型输入装配能力目录；运行时地图与离线门禁调用同一条路径。 */
export async function loadSemanticModelCatalog(
  semanticPackage: SemanticPackage,
): Promise<SemanticModelCatalog> {
  const files: SemanticModelYamlFile[] = [];
  for (const directory of ["cubes", "views"]) {
    const entries = (await readdir(join(semanticPackage.model_root, directory)))
      .filter((entry) => entry.endsWith(".yml"))
      .sort();
    for (const entry of entries) {
      files.push({
        path: `${directory}/${entry}`,
        text: await readFile(join(semanticPackage.model_root, directory, entry), "utf8"),
      });
    }
  }
  return buildSemanticModelCatalog(
    files,
    semanticPackage.taxonomy,
    semanticPackage.time_sources,
    semanticCatalogFormalMetrics(semanticPackage.formal_metrics),
  );
}

/** 本地开发默认使用仓库包；容器和内部部署通过同一环境变量挂载外部私有包。 */
export function configuredSemanticPackageDir(environment: NodeJS.ProcessEnv = process.env): string {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const configured = environment.PA_SEMANTIC_PACKAGE_DIR?.trim();
  return configured ? resolve(repositoryRoot, configured) : resolve(repositoryRoot, "demo");
}
