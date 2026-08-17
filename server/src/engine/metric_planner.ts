/**
 * 正式指标 Planner：把逻辑指标查询编译为最少数量的单事实 Cube 查询腿。
 * 本模块只产生不可变执行计划，不访问 Cube，也不计算指标结果。
 */
import type { TopNSelectionSpec } from "../semantic_core/analysis_spec.js";
import type { TimeInput } from "../semantic_core/time_contract.js";
import { z } from "zod";
import type {
  CubeFilter,
  CubeMember,
  CubeQuery,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import { metricNodeOf, type MetricNode } from "./metric_model.js";
import { memberSemanticId } from "./model_contract.js";
import { memberShortName } from "../semantic_core/member_name.js";
import {
  BUSINESS_TIME_SCHEMA,
  PLANNED_QUERY_LEG_SCHEMA,
  planResolvedTimeQuery,
  resolveTimePlanning,
  timeEmissionForForm,
  type BusinessTimeResolution,
  type PlannedQuery,
  type PlannedQueryLeg,
  type ResolvedTimePlanning,
  type TimeEvalForm,
} from "./time_plan.js";

type AggregateMetricNode = { kind: "aggregate"; member: string };
export type ExecutableMetricNode = AggregateMetricNode | MetricNode;

export type MetricQueryLeg = {
  source_view: string;
  plan: PlannedQueryLeg;
  /** 来源维度成员到逻辑查询维度成员的映射。 */
  dimensions: Record<string, string>;
  /** 来源叶子度量到规范指标 id 的映射。 */
  measures: Record<string, string>;
};

/** 最小样本量保护：输出指标在分母（样本量）指标低于阈值的结果格上置空。 */
export type MinSampleRule = {
  /** 受保护的输出指标限定名。 */
  measure: string;
  /** 判定样本量的分母指标语义 id；Planner 已确保其叶子进入查询腿。 */
  denominator: string;
  threshold: number;
};

export type MetricQueryPlan = {
  kind: "metric_query";
  business_time: BusinessTimeResolution;
  time_view: string;
  legs: MetricQueryLeg[];
  nodes: Record<string, ExecutableMetricNode>;
  dimensions: string[];
  measures: string[];
  output_metric_ids: Record<string, string>;
  min_sample?: MinSampleRule[];
  order?: [string, "asc" | "desc"][];
  selection?: TopNSelectionSpec;
};

const COMPONENT_SCHEMA = z
  .object({ metric_id: z.string().min(1), missing: z.enum(["null", "zero"]) })
  .strict();

const EXECUTABLE_NODE_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("aggregate"), member: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("ratio"),
      numerator: COMPONENT_SCHEMA,
      denominator: COMPONENT_SCHEMA,
      division_by_zero: z.literal("null"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("availability_guard"),
      value: COMPONENT_SCHEMA,
      availability: COMPONENT_SCHEMA,
      unavailable: z.literal("null"),
    })
    .strict(),
]);

const METRIC_QUERY_PLAN_SCHEMA: z.ZodType<MetricQueryPlan> = z
  .object({
    kind: z.literal("metric_query"),
    business_time: BUSINESS_TIME_SCHEMA,
    time_view: z.string().min(1),
    legs: z
      .array(
        z
          .object({
            source_view: z.string().min(1),
            plan: PLANNED_QUERY_LEG_SCHEMA,
            dimensions: z.record(z.string(), z.string()),
            measures: z.record(z.string(), z.string()),
          })
          .strict(),
      )
      .min(1),
    nodes: z.record(z.string(), EXECUTABLE_NODE_SCHEMA),
    dimensions: z.array(z.string()),
    measures: z.array(z.string()),
    output_metric_ids: z.record(z.string(), z.string()),
    min_sample: z
      .array(
        z
          .object({
            measure: z.string().min(1),
            denominator: z.string().min(1),
            threshold: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
    order: z.array(z.tuple([z.string(), z.enum(["asc", "desc"])])).optional(),
    selection: z
      .object({
        type: z.literal("top_n"),
        dimensions: z.array(z.string().min(1)).min(1),
        by: z.string().min(1),
        window: z.literal("anchor"),
        count: z.number().int().positive().max(1000),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseMetricQueryPlan(value: unknown): MetricQueryPlan {
  const parsed = METRIC_QUERY_PLAN_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `持久化正式指标计划无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  return parsed.data;
}

type MetricIndex = {
  byId: Map<string, CubeMember>;
};

const isDetail = (view: CubeView) => view.meta?.query_surface === "detail";

function metricIndex(views: CubeView[]): MetricIndex {
  const byId = new Map<string, CubeMember>();
  for (const view of views.filter((candidate) => !isDetail(candidate))) {
    for (const member of [...view.measures, ...(view.internalMeasures ?? [])]) {
      const id = memberSemanticId("measure", member);
      if (byId.has(id)) {
        throw new Error(`规范指标 ${id} 在多个普通指标来源中重复，无法唯一规划`);
      }
      byId.set(id, member);
    }
  }
  return { byId };
}

function mapDimension(source: CubeView, member: string): string {
  const short = memberShortName(member);
  const matches = source.dimensions.filter(
    (dimension) => memberShortName(dimension.name) === short,
  );
  if (matches.length !== 1) {
    throw new Error(
      `指标来源「${source.title}」不支持维度「${short}」，或该维度在来源中不唯一；请移除该维度`,
    );
  }
  return matches[0].name;
}

function mapFilter(source: CubeView, filter: CubeFilter): CubeFilter {
  if ("member" in filter) return { ...filter, member: mapDimension(source, filter.member) };
  if ("and" in filter) return { and: filter.and.map((child) => mapFilter(source, child)) };
  return { or: filter.or.map((child) => mapFilter(source, child)) };
}

function expandMetricGraph(
  metricId: string,
  index: MetricIndex,
  nodes: Map<string, ExecutableMetricNode>,
  resolving: Set<string>,
): void {
  if (nodes.has(metricId)) return;
  if (resolving.has(metricId)) throw new Error(`正式指标图存在循环：${metricId}`);
  const member = index.byId.get(metricId);
  if (!member) throw new Error(`正式指标组件 ${metricId} 不在当前身份可见目录中`);
  const formal = metricNodeOf(member);
  if (!formal) {
    nodes.set(metricId, { kind: "aggregate", member: member.name });
    return;
  }
  resolving.add(metricId);
  try {
    const components =
      formal.kind === "ratio"
        ? [formal.numerator, formal.denominator]
        : [formal.value, formal.availability];
    for (const component of components) {
      expandMetricGraph(component.metric_id, index, nodes, resolving);
    }
    nodes.set(metricId, formal);
  } finally {
    resolving.delete(metricId);
  }
}

function physicalLeaves(nodes: ReadonlyMap<string, ExecutableMetricNode>): Array<{
  metricId: string;
  member: string;
}> {
  return [...nodes].flatMap(([metricId, node]) =>
    node.kind === "aggregate" ? [{ metricId, member: node.member }] : [],
  );
}

function sourceForLeaf(views: CubeView[], member: string): CubeView {
  const source = views.find(
    (view) =>
      !isDetail(view) &&
      [...view.measures, ...(view.internalMeasures ?? [])].some(
        (measure) => measure.name === member,
      ),
  );
  if (!source) throw new Error(`叶子指标 ${member} 缺少唯一的 Cube 来源`);
  return source;
}

function planningForSource(
  planning: ResolvedTimePlanning,
  sourceView: string,
): ResolvedTimePlanning {
  return { ...planning, view: sourceView };
}

function groupKey(sourceView: string, form: TimeEvalForm): string {
  return `${sourceView}\u0000${form}`;
}

export function planMetricQuery(
  query: CubeQuery,
  time: TimeInput | undefined,
  context: TimeContext,
  views: CubeView[],
  timeView?: string,
  selection?: TopNSelectionSpec,
): MetricQueryPlan {
  const requested = query.measures ?? [];
  const index = metricIndex(views);
  const outputMetricIds = new Map<string, string>();
  const nodes = new Map<string, ExecutableMetricNode>();
  const minSampleRules: MinSampleRule[] = [];
  for (const memberName of requested) {
    const member = views
      .filter((view) => !isDetail(view))
      .flatMap((view) => view.measures)
      .find((candidate) => candidate.name === memberName);
    if (!member) throw new Error(`指标 ${memberName} 不在当前身份可见目录中`);
    const id = memberSemanticId("measure", member);
    outputMetricIds.set(memberName, id);
    expandMetricGraph(id, index, nodes, new Set());
    const rule = minSampleRuleOf(member, index, nodes);
    if (rule) minSampleRules.push(rule);
  }
  const leaves = physicalLeaves(nodes);
  if (!leaves.length && requested.length) throw new Error("正式指标图没有可执行叶子指标");

  const synthetic: CubeQuery = {
    ...query,
    measures: [...new Set([...leaves.map((leaf) => leaf.member), ...requested])],
    order: undefined,
    limit: undefined,
    offset: undefined,
  };
  const planning = resolveTimePlanning(synthetic, time, context, views, timeView);
  const outputTimeView = timeView ?? requested[0]?.split(".")[0] ?? planning.view;
  const groups = new Map<string, { source: CubeView; form: TimeEvalForm; leaves: typeof leaves }>();
  for (const leaf of leaves) {
    const source = sourceForLeaf(views, leaf.member);
    const form = planning.evalForms.get(leaf.member);
    if (!form) throw new Error(`叶子指标 ${leaf.member} 缺少时间求值形态`);
    const key = groupKey(source.name, form);
    const group = groups.get(key) ?? { source, form, leaves: [] };
    group.leaves.push(leaf);
    groups.set(key, group);
  }

  const dimensions = query.dimensions ?? [];
  const legs = [...groups.values()].map(({ source, form, leaves: groupLeaves }): MetricQueryLeg => {
    const dimensionPairs = dimensions.map(
      (target) => [mapDimension(source, target), target] as const,
    );
    const sourceQuery: CubeQuery = {
      measures: groupLeaves.map((leaf) => leaf.member),
      ...(dimensionPairs.length ? { dimensions: dimensionPairs.map(([member]) => member) } : {}),
      ...(query.filters?.length
        ? { filters: query.filters.map((filter) => mapFilter(source, filter)) }
        : {}),
    };
    const sourcePlanning = planningForSource(planning, source.name);
    const plan = planResolvedTimeQuery(
      sourceQuery,
      sourcePlanning,
      timeEmissionForForm(planning.businessTime, form),
    );
    return {
      source_view: source.name,
      plan,
      dimensions: Object.fromEntries(dimensionPairs),
      measures: Object.fromEntries(groupLeaves.map((leaf) => [leaf.member, leaf.metricId])),
    };
  });
  return {
    kind: "metric_query",
    business_time: planning.businessTime,
    time_view: outputTimeView,
    legs,
    nodes: Object.fromEntries(nodes),
    dimensions,
    measures: requested,
    output_metric_ids: Object.fromEntries(outputMetricIds),
    ...(minSampleRules.length ? { min_sample: minSampleRules } : {}),
    ...(query.order ? { order: query.order } : {}),
    ...(selection ? { selection } : {}),
  };
}

/**
 * 从模型声明提取最小样本量规则，并把分母（样本量）指标展入执行图，
 * 保证遮蔽判定所需的样本量随任何查询形态一起取回。声明不完整时 fail-closed。
 */
function minSampleRuleOf(
  member: CubeMember,
  index: MetricIndex,
  nodes: Map<string, ExecutableMetricNode>,
): MinSampleRule | null {
  const raw = member.meta?.min_sample;
  if (raw === undefined) return null;
  const threshold = Number(raw);
  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new Error(`指标「${member.title ?? member.name}」的 min_sample 必须是正整数`);
  }
  const components = member.meta?.components as { denominator?: unknown } | undefined;
  if (typeof components?.denominator !== "string") {
    throw new Error(
      `指标「${member.title ?? member.name}」声明 min_sample 但缺少 components.denominator`,
    );
  }
  const qualified = components.denominator.includes(".")
    ? components.denominator
    : `${member.name.split(".")[0]}.${components.denominator}`;
  const denominator = [...index.byId.entries()].find(
    ([, candidate]) => candidate.name === qualified,
  );
  if (!denominator) {
    throw new Error(
      `指标「${member.title ?? member.name}」的样本量指标 ${qualified} 不在当前身份可见目录中`,
    );
  }
  expandMetricGraph(denominator[0], index, nodes, new Set());
  return { measure: member.name, denominator: denominator[0], threshold };
}

export function metricTimeMembers(plan: MetricQueryPlan): string[] {
  if (plan.business_time.outputGrain === "total") return [];
  const year = `${plan.time_view}.year`;
  return plan.business_time.outputGrain === "year" ? [year] : [year, `${plan.time_view}.month`];
}

export function metricKeyMembers(plan: MetricQueryPlan): string[] {
  return [...plan.dimensions, ...metricTimeMembers(plan)];
}

export function metricOutputMembers(plan: MetricQueryPlan): string[] {
  return [...metricKeyMembers(plan), ...plan.measures];
}

export function metricLegPlan(plan: MetricQueryPlan, leg: MetricQueryLeg): PlannedQuery {
  return { ...leg.plan, businessTime: plan.business_time };
}

export function metricPlanLeafQueries(plan: MetricQueryPlan): PlannedQuery[] {
  return plan.legs.map((leg) => metricLegPlan(plan, leg));
}
