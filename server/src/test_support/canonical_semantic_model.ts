import { buildCanonicalSemanticModel } from "../engine/canonical_semantic_model.js";
import { buildCatalogDocument, toCompilerCatalog } from "../engine/catalog_document.js";
import type { CubeView } from "../ports/cube_gateway.js";
import type { SemanticTaxonomy } from "../semantic_core/semantic_taxonomy.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { parseKnownTimeSourceId, type TimeSourceRegistry } from "../semantic_core/time_source.js";
import { TEST_TIME_SOURCE_REGISTRY } from "./semantic_taxonomy.js";

/** 根据 CubeView 夹具生成对应的能力层，让应用层单测也经过统一语义模型的完整校验。 */
export function canonicalModelFixture(
  views: CubeView[],
  taxonomy: SemanticTaxonomy,
  timeSources: TimeSourceRegistry = TEST_TIME_SOURCE_REGISTRY,
) {
  const accessScope = { id: "test_scope", title: "测试范围" };
  const document = buildCatalogDocument(views, taxonomy, timeSources, accessScope);
  const compiler = toCompilerCatalog(document);
  const dimensionGroups = new Map<string, Set<string>>();
  for (const dimension of compiler.dimensions) {
    const group = dimension.dimension_group?.id;
    if (!group) continue;
    dimensionGroups.set(
      group,
      new Set([...(dimensionGroups.get(group) ?? []), memberShortName(dimension.name)]),
    );
  }
  return buildCanonicalSemanticModel({
    capabilities: {
      facts: [],
      dimension_groups: taxonomy.dimension_groups.flatMap((definition) => {
        const members = [...(dimensionGroups.get(definition.name) ?? [])].sort();
        return members.length ? [{ ...definition, members, bindings: [] }] : [];
      }),
      metric_domains: document.metric_domains.map((domain) => ({
        id: domain.id,
        title: domain.title,
        description: domain.description,
        metrics: compiler.measures
          .filter((measure) => measure.metric_domain_id === domain.id)
          .map((measure) => ({
            name: memberShortName(measure.name),
            title: measure.title,
          })),
        dimensions: [],
        bindings: [],
      })),
      time_sources: views.flatMap((view) => {
        const anchor = view.meta?.time_anchor_measure;
        return typeof anchor === "string"
          ? [
              {
                key: parseKnownTimeSourceId(
                  view.meta?.time_source,
                  `Cube View ${view.name}`,
                  timeSources,
                ),
                anchor: { view: view.name, measure: memberShortName(anchor) },
              },
            ]
          : [];
      }),
    },
    views,
    taxonomy,
    time_sources: timeSources,
    access_scope: accessScope,
  });
}
