import type { CompilerCatalog } from "./compiler_catalog.js";
import { bindSemanticFilter, catalogMember, type QueryIntentResolution } from "./query_intent.js";
import type { SemanticQueryView } from "./semantic_analysis.js";
import { compileTimeIntent } from "./time_contract.js";

/**
 * 只在标记为 detail 且可查明细的绑定中寻找记录来源，并要求报告的全部分组与筛选
 * 都能绑定到同一个 View；业务指标域不参与选择。
 */
export function planMetricRecordProjection(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  metricId: string,
): QueryIntentResolution | null {
  const metric = catalogMember(catalog, metricId, "measure");
  if (!metric?.records_available) return null;
  const recordProjectionBindings = metric.available_in.filter(
    (binding) => binding.records_available,
  );
  for (const binding of recordProjectionBindings) {
    if (!binding.detail || !binding.records_available) continue;
    const dimensions = (intent.dimensions ?? []).map((id) =>
      catalogMember(catalog, id, "dimension"),
    );
    const filters = (intent.filters ?? []).map((filter) => ({
      filter,
      member: catalogMember(catalog, filter.member, "dimension"),
    }));
    const dimensionBindings = dimensions.map((member) =>
      member?.available_in.find(
        (available) =>
          available.view === binding.view &&
          (binding.detail ? available.detail : !available.detail),
      ),
    );
    const filterBindings = filters.map(({ member }) =>
      member?.available_in.find(
        (available) =>
          available.view === binding.view &&
          (binding.detail ? available.detail : !available.detail),
      ),
    );
    if (
      dimensions.some((member) => !member) ||
      filters.some(({ member }) => !member) ||
      dimensionBindings.some((item) => !item) ||
      filterBindings.some((item) => !item)
    ) {
      continue;
    }
    return {
      status: "direct",
      view: binding.view,
      views: [binding.view],
      group_dimensions: dimensions.map((member, index) => ({
        id: member!.id,
        title: member!.title,
        member: dimensionBindings[index]!.member,
      })),
      query: {
        // 明细只对直接交付的查询成立，节点 id 使用顶层查询的固定 id。
        id: "query",
        ...(intent.view_title ? { view_title: intent.view_title } : {}),
        time_view: binding.view,
        measures: [binding.member],
        ...(dimensionBindings.length
          ? { dimensions: dimensionBindings.map((item) => item!.member) }
          : {}),
        ...(filters.length
          ? {
              filters: filters.map(({ filter }, index) =>
                bindSemanticFilter(filter, filterBindings[index]!.member),
              ),
            }
          : {}),
        time: compileTimeIntent(intent.time),
      },
    };
  }
  return null;
}
