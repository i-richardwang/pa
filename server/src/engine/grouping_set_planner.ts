/** 把一个语义查询视图展开为共享业务时间的 grouping sets。 */
import {
  calculationColumnName,
  type GroupingSetsSpec,
  type GroupingShareCalculationSpec,
} from "../semantic_core/analysis_spec.js";
import type { CubeFilter, CubeQuery, CubeView } from "../ports/cube_gateway.js";
import {
  resolveFilterLineage,
  sameFilterLineage,
  type ResolvedFilterLineage,
} from "./filter_lineage.js";
import { completeGroupingSetHierarchy } from "./hierarchy.js";
import { memberSemanticId } from "./model_contract.js";
import {
  metricKeyMembers,
  planMetricQueryWithPlanning,
  type MetricQueryPlan,
} from "./metric_planner.js";
import type { BusinessTimeResolution, ResolvedTimePlanning } from "./time_plan.js";

export type ResolvedResultSignature = {
  grouping_set: string[];
  business_time: BusinessTimeResolution;
};

export type GroupingSetLeg = {
  id: string;
  signature: ResolvedResultSignature;
  filter_lineage: ResolvedFilterLineage;
  plan: MetricQueryPlan;
};

export type GroupingShareCalculation = {
  kind: "grouping_share";
  id: string;
  title: string;
  column: string;
  measure: string;
  category_member: string;
  numerator_leg: "base";
  denominator_leg: string;
};

export type ResolvedGroupingSetPlan = {
  view_id: string;
  base_signature: ResolvedResultSignature;
  base_keys: string[];
  base_grouping_members: string[];
  legs: GroupingSetLeg[];
  calculations: GroupingShareCalculation[];
  summary_leg?: string;
};

const canonicalGroupingSet = (dimensions: string[]): string[] => [...dimensions].sort();

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function signature(
  groupingSet: string[],
  businessTime: BusinessTimeResolution,
): ResolvedResultSignature {
  return {
    grouping_set: canonicalGroupingSet(groupingSet),
    business_time: businessTime,
  };
}

function assertSubset(coarse: string[], fine: string[], title: string): void {
  const fineSet = new Set(fine);
  if (coarse.some((dimension) => !fineSet.has(dimension))) {
    throw new Error(`计算「${title}」的粗分组集不是基础分组集的语义子集`);
  }
  if (coarse.length >= fine.length) {
    throw new Error(`计算「${title}」没有形成更粗的分组集`);
  }
}

type LegRequest = {
  key: string;
  grouping_set: string[];
  dimensions: string[];
  filter_lineage: ResolvedFilterLineage;
  measures: string[];
};

function calculationRequest(
  calculation: GroupingShareCalculationSpec,
  grouping: GroupingSetsSpec,
  baselineFilterLineage: ResolvedFilterLineage,
): LegRequest {
  const category = grouping.base.find(
    (dimension) => dimension.id === calculation.category_dimension,
  );
  if (!category) throw new Error(`计算「${calculation.title}」的分类维度不在基础分组集中`);
  const dimensions = grouping.base
    .filter((dimension) => dimension.id !== calculation.category_dimension)
    .map((dimension) => dimension.member);
  return {
    key: calculation.id,
    grouping_set: grouping.base
      .filter((dimension) => dimension.id !== calculation.category_dimension)
      .map((dimension) => dimension.id),
    dimensions,
    filter_lineage: baselineFilterLineage,
    measures: [calculation.measure],
  };
}

function requestKey(request: LegRequest, businessTime: BusinessTimeResolution): string {
  return JSON.stringify({
    grouping_set: canonicalGroupingSet(request.grouping_set),
    filters: request.filter_lineage.fingerprint,
    business_time: businessTime,
  });
}

function assertSemanticBinding(request: LegRequest): void {
  const bound = request.dimensions.map((member) => memberSemanticId("dimension", member));
  if (!same(canonicalGroupingSet(bound), canonicalGroupingSet(request.grouping_set))) {
    throw new Error(`分组子查询 ${request.key} 的语义分组集与物理维度绑定不一致`);
  }
}

export function planGroupingSets(input: {
  viewId: string;
  baseQuery: CubeQuery;
  baseGroupingSet: string[];
  basePlan: MetricQueryPlan;
  timePlanning: ResolvedTimePlanning;
  baselineFilters?: CubeFilter[];
  grouping?: GroupingSetsSpec;
  includeSummary: boolean;
  views: CubeView[];
  timeView?: string;
}): ResolvedGroupingSetPlan {
  const {
    viewId,
    baseQuery,
    baseGroupingSet,
    basePlan,
    timePlanning,
    baselineFilters,
    grouping,
    includeSummary,
    views,
    timeView,
  } = input;
  const baselineFilterLineage = resolveFilterLineage(baselineFilters ?? baseQuery.filters);
  const displayFilterLineage = resolveFilterLineage(baseQuery.filters);
  const baseSignature = signature(baseGroupingSet, basePlan.business_time);
  if (grouping) {
    const groupingBase = grouping.base.map((dimension) => dimension.id);
    if (!same(canonicalGroupingSet(groupingBase), baseSignature.grouping_set)) {
      throw new Error("基础语义分组集与 grouping-set 声明不一致");
    }
    assertSemanticBinding({
      key: "base",
      grouping_set: groupingBase,
      dimensions: grouping.base.map((dimension) => dimension.member),
      filter_lineage: displayFilterLineage,
      measures: basePlan.measures,
    });
  }
  const requests: LegRequest[] = grouping
    ? (grouping.calculations ?? []).map((calculation) =>
        calculationRequest(calculation, grouping, baselineFilterLineage),
      )
    : [];
  if (includeSummary) {
    requests.push({
      key: "summary",
      grouping_set: [],
      dimensions: [],
      filter_lineage: displayFilterLineage,
      measures: basePlan.measures,
    });
  }

  const groupedRequests = new Map<string, LegRequest & { aliases: string[] }>();
  for (const request of requests) {
    assertSemanticBinding(request);
    const key = requestKey(request, basePlan.business_time);
    const current = groupedRequests.get(key);
    if (!current) {
      groupedRequests.set(key, { ...request, aliases: [request.key] });
      continue;
    }
    if (
      !same(
        canonicalGroupingSet(current.grouping_set),
        canonicalGroupingSet(request.grouping_set),
      ) ||
      !sameFilterLineage(current.filter_lineage, request.filter_lineage)
    ) {
      throw new Error("分组子查询合并前提失效：分组集或筛选条件来源不一致");
    }
    current.measures = [...new Set([...current.measures, ...request.measures])];
    current.aliases.push(request.key);
  }

  const aliasToLeg = new Map<string, string>();
  const legs = [...groupedRequests.values()].map((request, index): GroupingSetLeg => {
    const id = `grouping_set_${index + 1}`;
    request.aliases.forEach((alias) => {
      aliasToLeg.set(alias, id);
    });
    const query = completeGroupingSetHierarchy(
      {
        ...baseQuery,
        dimensions: request.dimensions.length ? request.dimensions : undefined,
        filters: request.filter_lineage.filters,
        measures: request.measures,
        order: undefined,
      },
      views,
    ).query;
    const plan = planMetricQueryWithPlanning(query, timePlanning, views, timeView);
    if (!same(plan.dimensions, query.dimensions ?? [])) {
      throw new Error(`分组子查询 ${id} 的层级补全键没有被 Metric Planner 原样保留`);
    }
    if (!same(plan.business_time, basePlan.business_time)) {
      throw new Error("分组子查询的业务时间与基础分组集不一致");
    }
    return {
      id,
      signature: signature(request.grouping_set, plan.business_time),
      filter_lineage: request.filter_lineage,
      plan,
    };
  });
  const basePhysicalGrouping = new Set(basePlan.dimensions);
  for (const leg of legs) {
    if (leg.plan.dimensions.some((dimension) => !basePhysicalGrouping.has(dimension))) {
      throw new Error(`分组子查询 ${leg.id} 的层级补全结果不是基础物理分组的子集`);
    }
  }

  const calculations = (grouping?.calculations ?? []).map(
    (calculation): GroupingShareCalculation => {
      const denominatorLeg = aliasToLeg.get(calculation.id);
      if (!denominatorLeg) throw new Error(`计算「${calculation.title}」缺少粗粒度分组子查询`);
      const leg = legs.find((candidate) => candidate.id === denominatorLeg);
      if (!leg) throw new Error(`计算「${calculation.title}」引用了不存在的粗粒度分组子查询`);
      if (!sameFilterLineage(leg.filter_lineage, baselineFilterLineage)) {
        throw new Error(`计算「${calculation.title}」的两侧筛选条件来源不一致`);
      }
      assertSubset(leg.signature.grouping_set, baseSignature.grouping_set, calculation.title);
      if (!same(leg.signature.business_time, baseSignature.business_time)) {
        throw new Error(`计算「${calculation.title}」的两侧业务时间不一致`);
      }
      const category = grouping?.base.find(
        (dimension) => dimension.id === calculation.category_dimension,
      );
      if (!category) throw new Error(`计算「${calculation.title}」的分类维度不在基础分组集中`);
      const coarsePhysical = new Set(leg.plan.dimensions);
      if (coarsePhysical.has(category.member) || coarsePhysical.size >= basePhysicalGrouping.size) {
        throw new Error(
          `计算「${calculation.title}」的分类维度是层级中间级，移除后无法形成更粗的分组集；` +
            "请移除其下级分组，或改为计算下级在上级内的占比",
        );
      }
      return {
        kind: "grouping_share",
        id: calculation.id,
        title: calculation.title,
        column: calculationColumnName(calculation.id),
        measure: calculation.measure,
        category_member: category.member,
        numerator_leg: "base",
        denominator_leg: denominatorLeg,
      };
    },
  );
  const summaryLegId = aliasToLeg.get("summary");
  if (summaryLegId) {
    const summaryLeg = legs.find((leg) => leg.id === summaryLegId);
    if (!summaryLeg) throw new Error("总计子查询不存在");
    if (summaryLeg.plan.dimensions.length) {
      throw new Error("总计子查询必须移除全部业务分组维度");
    }
  }
  return {
    view_id: viewId,
    base_signature: baseSignature,
    base_keys: metricKeyMembers(basePlan),
    base_grouping_members: basePlan.dimensions,
    legs,
    calculations,
    ...(summaryLegId ? { summary_leg: summaryLegId } : {}),
  };
}
