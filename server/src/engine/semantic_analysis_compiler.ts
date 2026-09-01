/** 把语义分析编译为物理执行工件的唯一边界。 */
import { memberShortName } from "../semantic_core/member_name.js";
import {
  isDerivedViewSpec,
  parseAnalysisSpec,
  calculationColumnName,
  type ColumnOperand,
  type DerivedColumnInput,
  type DerivedViewSpec,
  type ExprNode,
  type LiteralOperand,
  type GroupingShareCalculationSpec,
  type QueryViewSpec,
} from "../semantic_core/analysis_spec.js";
import type { CompilerCatalog, CompilerCatalogMember } from "../semantic_core/compiler_catalog.js";
import type { UnboundChart } from "../presentation_core/chart_spec.js";
import {
  planExecution,
  type ExecutionPlan,
  type OutputDelivery,
  type OutputProvenance,
} from "../semantic_core/execution_plan.js";
import { bindPresentation, type PresentationSpec } from "../presentation_core/presentation_spec.js";
import {
  parseAnalysisDefinition,
  parseSemanticViewIntent,
  isSemanticDerivedView,
  semanticAnalysisSink,
  AnalysisDefinitionError,
  ViewIntentError,
  type AnalysisDefinition,
  type SemanticAnalysisView,
  type SemanticViewIntent,
  type SemanticColumnOperand,
  type SemanticDerivedView,
  type SemanticExprNode,
  type SemanticLiteralOperand,
  type SemanticQueryView,
} from "../semantic_core/semantic_analysis.js";
import {
  EMPTY_VIEW_PREFERENCES,
  validateViewPreferences,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";
import {
  catalogMember,
  planQueryIntent,
  type QueryIntentPlan,
} from "../semantic_core/query_intent.js";
import type {
  RecordProjectionBindings,
  RecordProjectionViewBinding,
} from "../contracts/record_projection_contract.js";
import { planMetricRecordProjection } from "../semantic_core/record_projection_planner.js";
import { projectPresentation } from "../presentation_core/presentation_projection.js";
import type { ChartDecl } from "../presentation_core/chart_decl.js";

/**
 * 结果血缘（对外）：只讲业务事实——单来源直查 / 跨来源组合（来源标题 + 关联键） / 不可行原因。
 * 产物只含 status、result_view_id、sources.title、join_keys 与 reason；物理视图选路是编译器内务，不进入产物。
 */
export type SemanticRoute =
  | {
      status: "direct";
      result_view_id: string;
    }
  | {
      status: "composed";
      result_view_id: string;
      sources: { title: string }[];
      join_keys: { id: string; title: string }[];
    }
  | { status: "incompatible"; result_view_id: string; reason: string };

export type CompiledAnalysisView = {
  /** 私有执行计划：计算节点与唯一结果已解析必填，交付路径消费此结构或其投影。 */
  plan: ExecutionPlan;
  presentation: PresentationSpec;
  /** 面向 Web 渲染的公共列声明；不含物理成员名。 */
  render_decl: ChartDecl;
  routes: SemanticRoute[];
  record_projection_bindings: RecordProjectionBindings;
};

function bindingInPool(member: CompilerCatalogMember, pool: string[]): string {
  const binding = member.available_in.find((available) => pool.includes(available.member));
  if (!binding) throw new Error(`字段「${member.title}」未绑定到当前执行查询`);
  return memberShortName(binding.member);
}

function physicalBindingInPool(member: CompilerCatalogMember, pool: string[]): string {
  const binding = member.available_in.find((available) => pool.includes(available.member));
  if (!binding) throw new Error(`字段「${member.title}」未绑定到当前执行查询`);
  return binding.member;
}

function recordProjectionBindingForIntent(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  plan: QueryIntentPlan,
): RecordProjectionViewBinding | null {
  if (plan.status === "incompatible") return null;
  const metrics: RecordProjectionViewBinding["metrics"] = {};
  const dimensions: RecordProjectionViewBinding["dimensions"] = {};
  for (const id of intent.measures ?? []) {
    const member = catalogMember(catalog, id, "measure");
    if (member && planMetricRecordProjection(catalog, intent, member.id)) {
      metrics[member.id] = { metric_id: member.id, title: member.title };
    }
  }
  for (const dimension of plan.group_dimensions) {
    dimensions[dimension.id] = {
      dimension_id: dimension.id,
      title: dimension.title,
    };
  }
  return { result_view_id: intent.id, metrics, dimensions };
}

export class SemanticQueryIncompatibleError extends Error {
  constructor(
    message: string,
    readonly routes: SemanticRoute[],
  ) {
    super(message);
    this.name = "SemanticQueryIncompatibleError";
  }
}

function routesForPlans(intents: SemanticQueryView[], plans: QueryIntentPlan[]): SemanticRoute[] {
  return plans.map((plan, index) => {
    const viewId = intents[index].id;
    if (plan.status === "direct") {
      return { status: "direct", result_view_id: viewId };
    }
    return { status: "incompatible", result_view_id: viewId, reason: plan.reason };
  });
}

/** 用户自定义派生视图的来源血缘：来源查询视图的标题 + join 关联键，供 ⓘ「结果来源」呈现。 */
function routesForDerived(
  catalog: CompilerCatalog,
  views: SemanticAnalysisView[],
): SemanticRoute[] {
  const titleById = new Map(
    views.flatMap((view) => (view.view_title?.trim() ? [[view.id, view.view_title] as const] : [])),
  );
  return views.filter(isSemanticDerivedView).map((view): SemanticRoute => {
    const sources = view.from.map((id) => {
      const title = titleById.get(id);
      if (!title) {
        throw new Error(`派生结果「${view.view_title}」的来源查询缺少业务标题`);
      }
      return { title };
    });
    return {
      status: "composed",
      result_view_id: view.id,
      sources,
      join_keys: (view.join?.on ?? []).map((member) => ({
        id: member,
        title: catalogMember(catalog, member, "dimension")?.title ?? member,
      })),
    };
  });
}

function directDelivery(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  plan: Extract<QueryIntentPlan, { status: "direct" }>,
): OutputDelivery {
  const columns: Record<string, string> = {};
  for (const id of intent.measures ?? []) {
    const member = catalogMember(catalog, id, "measure");
    if (member) columns[bindingInPool(member, plan.query.measures ?? [])] = member.id;
  }
  for (const dimension of plan.group_dimensions) {
    columns[memberShortName(dimension.member)] = dimension.id;
  }
  for (const calculation of intent.calculations ?? []) {
    columns[calculationColumnName(calculation.id)] = calculation.id;
  }
  return { columns };
}

function semanticDelivery(
  catalog: CompilerCatalog,
  views: SemanticAnalysisView[],
  plans: ReadonlyMap<string, QueryIntentPlan>,
  routes: SemanticRoute[],
  outputId: string,
): OutputDelivery {
  const provenanceById = new Map(
    routes.flatMap((route) =>
      route.status === "composed"
        ? [
            [
              route.result_view_id,
              {
                sources: route.sources,
                join_keys: route.join_keys,
              } satisfies OutputProvenance,
            ] as const,
          ]
        : [],
    ),
  );
  const view = views.find((candidate) => candidate.id === outputId);
  if (!view) throw new Error(`语义结果视图 ${outputId} 不存在`);
  const provenance = provenanceById.get(outputId);
  if (isSemanticDerivedView(view)) {
    return {
      columns: Object.fromEntries(view.columns.map((column) => [column.as, column.as])),
      ...(provenance ? { provenance } : {}),
    };
  }
  const plan = plans.get(outputId);
  if (!plan || plan.status === "incompatible") {
    throw new Error(`语义结果视图 ${outputId} 没有可交付的执行计划`);
  }
  return directDelivery(catalog, view, plan);
}

function memberForIntent(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  reference: string,
  kind: "measure" | "dimension",
): CompilerCatalogMember {
  const allowed = kind === "measure" ? (intent.measures ?? []) : (intent.dimensions ?? []);
  if (!allowed.includes(reference)) {
    throw new ViewIntentError(`呈现引用的语义字段 ${reference} 不在查询中`);
  }
  const member = catalogMember(catalog, reference, kind);
  if (!member) throw new ViewIntentError(`catalog 中不存在语义字段 ${reference}`);
  return member;
}

function bindSemantic(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  physical: QueryViewSpec,
  reference: string,
  kind: "measure" | "dimension",
): string {
  const member = memberForIntent(catalog, intent, reference, kind);
  const pool = kind === "measure" ? (physical.measures ?? []) : (physical.dimensions ?? []);
  const binding = member.available_in.find((available) => pool.includes(available.member));
  if (!binding) throw new Error(`语义字段「${member.title}」未绑定到当前执行视图`);
  return binding.member;
}

type ChartMemberBinder = (reference: string, kind: "measure" | "dimension") => string;
type CalculatedMeasure = { title: string; numerator_id: string };

function compileBoundChart(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  chart: SemanticViewIntent,
  style: ViewPreferences,
  bind: ChartMemberBinder,
  calculated: ReadonlyMap<string, CalculatedMeasure> = new Map(),
): UnboundChart {
  if (chart.type === "kpi") return { type: "kpi" };
  if (chart.type === "table") {
    return {
      type: "table",
      ...(chart.columns
        ? {
            columns: chart.columns.map((axis) =>
              axis === "time" || axis === "metrics" ? axis : bind(axis, "dimension"),
            ),
          }
        : {}),
      ...(style.table_shading ? { shading: style.table_shading } : {}),
    };
  }
  const queried = [...(intent.measures ?? []), ...calculated.keys()];
  const relationOf = (id: string) => {
    const local = calculated.get(id);
    if (local) return { kind: "structure_share" as const, numerator_id: local.numerator_id };
    return catalogMember(catalog, id, "measure")?.relation;
  };
  const titleOf = (id: string) =>
    calculated.get(id)?.title ?? catalogMember(catalog, id, "measure")?.title ?? id;
  const secondary = chart.type === "pie" ? [] : (chart.secondary_series ?? []);
  const series =
    chart.series ??
    queried.filter((id) => {
      if (secondary.includes(id)) return false;
      const relation = relationOf(id);
      return !(relation?.kind === "structure_share" && queried.includes(relation.numerator_id));
    });
  if (!series.length) throw new ViewIntentError(`${chart.type} 呈现至少需要一个主系列`);
  const plotted = [...series, ...secondary];
  const annotations = chart.type === "bar" ? (chart.annotations ?? []) : [];
  if (annotations.some((id) => series.includes(id))) {
    throw new ViewIntentError("同一指标不能同时是主系列和辅助标注");
  }
  for (const id of annotations) {
    const relation = relationOf(id);
    if (relation?.kind !== "structure_share" || !series.includes(relation.numerator_id)) {
      throw new ViewIntentError(`辅助指标「${titleOf(id)}」必须是当前主系列的结构占比`);
    }
  }
  const expectedAnnotations =
    chart.type === "bar"
      ? queried.filter((id) => {
          const relation = relationOf(id);
          return relation?.kind === "structure_share" && series.includes(relation.numerator_id);
        })
      : [];
  if (
    annotations.length !== expectedAnnotations.length ||
    expectedAnnotations.some((id) => !annotations.includes(id))
  ) {
    throw new ViewIntentError("结构占比与分子同查时必须进入辅助标注通道");
  }
  const display = style.series
    ? Object.fromEntries(
        Object.entries(style.series).map(([id, value]) => {
          if (!plotted.includes(id)) {
            throw new ViewIntentError(`系列视觉设置引用的指标「${titleOf(id)}」不在当前系列中`);
          }
          return [
            bind(id, "measure"),
            {
              ...(value.color ? { color: value.color } : {}),
              ...(value.mark ? { type: value.mark } : {}),
            },
          ];
        }),
      )
    : undefined;
  const y = series.map((id) => bind(id, "measure"));
  if (chart.type === "pie") {
    return { type: "pie", ...(chart.category ? { x: bind(chart.category, "dimension") } : {}), y };
  }
  const seriesChannels = {
    y,
    ...(secondary.length ? { y2: secondary.map((id) => bind(id, "measure")) } : {}),
    // 空数组不是「没有」：辅助标注通道在场即说明主系列已由这里裁定过，呈现层据此不再推断。
    annotations: annotations.map((id) => bind(id, "measure")),
    ...(chart.group_by ? { group_by: bind(chart.group_by, "dimension") } : {}),
    ...(display ? { display } : {}),
    ...(style.value_labels ? { value_labels: style.value_labels } : {}),
  };
  if (chart.type === "line") return { type: "line", ...seriesChannels };
  return {
    type: "bar",
    ...(chart.category ? { x: bind(chart.category, "dimension") } : {}),
    ...seriesChannels,
    ...(chart.stack !== undefined ? { stack: chart.stack } : {}),
  };
}

function physicalReference(
  catalog: CompilerCatalog,
  intents: ReadonlyMap<string, SemanticQueryView>,
  queries: ReadonlyMap<string, QueryViewSpec>,
  operand: SemanticColumnOperand,
): string {
  if (operand.member === "year" || operand.member === "month") return operand.member;
  const intent = intents.get(operand.source);
  const query = queries.get(operand.source);
  if (!intent || !query) {
    throw new AnalysisDefinitionError(`派生视图引用的查询视图 ${operand.source} 不存在`);
  }
  if (intent.measures?.includes(operand.member)) {
    return memberShortName(bindSemantic(catalog, intent, query, operand.member, "measure"));
  }
  if (intent.dimensions?.includes(operand.member)) {
    return memberShortName(bindSemantic(catalog, intent, query, operand.member, "dimension"));
  }
  throw new AnalysisDefinitionError(
    `派生视图引用的成员 ${operand.member} 不在查询视图 ${operand.source} 中`,
  );
}

function physicalExpressionOperand(
  catalog: CompilerCatalog,
  intents: ReadonlyMap<string, SemanticQueryView>,
  queries: ReadonlyMap<string, QueryViewSpec>,
  node: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand,
): ExprNode | ColumnOperand | LiteralOperand {
  if ("lit" in node) return node;
  if ("member" in node) {
    return {
      source: node.source,
      col: physicalReference(catalog, intents, queries, node),
    };
  }
  return {
    op: node.op,
    left: physicalExpressionOperand(catalog, intents, queries, node.left),
    right: physicalExpressionOperand(catalog, intents, queries, node.right),
  };
}

function physicalExpression(
  catalog: CompilerCatalog,
  intents: ReadonlyMap<string, SemanticQueryView>,
  queries: ReadonlyMap<string, QueryViewSpec>,
  node: SemanticExprNode,
): ExprNode {
  return {
    op: node.op,
    left: physicalExpressionOperand(catalog, intents, queries, node.left),
    right: physicalExpressionOperand(catalog, intents, queries, node.right),
  };
}

function compileDerivedView(
  catalog: CompilerCatalog,
  intents: ReadonlyMap<string, SemanticQueryView>,
  queries: ReadonlyMap<string, QueryViewSpec>,
  view: SemanticDerivedView,
): DerivedViewSpec {
  const columns: DerivedColumnInput[] = view.columns.map((column) =>
    "member" in column
      ? {
          source: column.source,
          col: physicalReference(catalog, intents, queries, column),
          as: column.as,
        }
      : {
          expr: physicalExpression(catalog, intents, queries, column.expr),
          as: column.as,
          ...(column.format ? { format: column.format } : {}),
        },
  );
  const join = view.join
    ? {
        how: view.join.how,
        on: view.join.on.map((member) => {
          const [leftSource, rightSource] = view.from;
          const left = physicalReference(catalog, intents, queries, {
            source: leftSource,
            member,
          });
          const right = physicalReference(catalog, intents, queries, {
            source: rightSource,
            member,
          });
          return { left, right };
        }),
      }
    : undefined;
  if (view.summary) {
    const hasMeasure = view.columns.some(
      (column) =>
        "expr" in column || catalogMember(catalog, column.member, "measure") !== undefined,
    );
    const hasDimension = view.columns.some(
      (column) =>
        "member" in column && catalogMember(catalog, column.member, "dimension") !== undefined,
    );
    if (!hasMeasure || !hasDimension) {
      throw new AnalysisDefinitionError(
        `派生视图「${view.view_title}」的总体行只适用于同时包含指标与业务分组维度的结果`,
      );
    }
  }
  return {
    id: view.id,
    view_title: view.view_title,
    from: view.from,
    ...(join ? { join } : {}),
    columns,
    ...(view.order ? { order: view.order } : {}),
    ...(view.limit ? { limit: view.limit } : {}),
    ...(view.summary ? { summary: view.summary } : {}),
  };
}

function compileDerivedChart(chart: SemanticViewIntent, style: ViewPreferences): UnboundChart {
  if (chart.type === "kpi") return { type: "kpi" };
  if (chart.type === "table") {
    return {
      type: "table",
      ...(chart.columns ? { columns: chart.columns } : {}),
      ...(style.table_shading ? { shading: style.table_shading } : {}),
    };
  }
  const secondary = chart.type === "pie" ? undefined : chart.secondary_series;
  if (style.series && chart.series) {
    const plotted = [...chart.series, ...(secondary ?? [])];
    const unknown = Object.keys(style.series).find((id) => !plotted.includes(id));
    if (unknown) {
      throw new ViewIntentError(`系列视觉设置引用的派生列「${unknown}」不在当前系列中`);
    }
  }
  if (chart.type === "pie") {
    return {
      type: "pie",
      ...(chart.category ? { x: chart.category } : {}),
      ...(chart.series ? { y: chart.series } : {}),
    };
  }
  const seriesChannels = {
    ...(chart.series ? { y: chart.series } : {}),
    ...(secondary ? { y2: secondary } : {}),
    ...(chart.group_by ? { group_by: chart.group_by } : {}),
    ...(style.series
      ? {
          display: Object.fromEntries(
            Object.entries(style.series).map(([id, value]) => [
              id,
              {
                ...(value.color ? { color: value.color } : {}),
                ...(value.mark ? { type: value.mark } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(style.value_labels ? { value_labels: style.value_labels } : {}),
  };
  if (chart.type === "line") return { type: "line", ...seriesChannels };
  return {
    type: "bar",
    ...(chart.category ? { x: chart.category } : {}),
    ...seriesChannels,
    ...(chart.annotations?.length ? { annotations: chart.annotations } : {}),
    ...(chart.stack !== undefined ? { stack: chart.stack } : {}),
  };
}

function validateSemanticTableLayout(view: SemanticAnalysisView, chart: SemanticViewIntent): void {
  if (chart.type !== "table" || !chart.columns) return;
  const businessColumns = chart.columns.filter((axis) => axis !== "time" && axis !== "metrics");
  if (view.summary && businessColumns.length) {
    throw new ViewIntentError(
      "presentation.columns 的业务维度列轴与 summary 互斥；请关闭总体行，或仅保留 time / metrics",
    );
  }
}

function groupingShareCalculations(
  catalog: CompilerCatalog,
  intent: SemanticQueryView,
  plan: Extract<QueryIntentPlan, { status: "direct" }>,
): GroupingShareCalculationSpec[] {
  return (intent.calculations ?? []).map((calculation) => {
    const measure = catalogMember(catalog, calculation.measure, "measure");
    if (!measure)
      throw new AnalysisDefinitionError(`catalog 中不存在基础指标 ${calculation.measure}`);
    if (!measure.report_calculations?.includes("percent_of_total")) {
      throw new AnalysisDefinitionError(`指标「${measure.title}」不支持报告级构成占比`);
    }
    const category = catalogMember(catalog, calculation.category_dimension, "dimension");
    if (!category) {
      throw new AnalysisDefinitionError(
        `catalog 中不存在构成维度 ${calculation.category_dimension}`,
      );
    }
    if (category.dimension_kind === "overlapping") {
      throw new AnalysisDefinitionError(
        `维度「${category.title}」不是互斥分类，不能计算合计为 100% 的构成占比`,
      );
    }
    return {
      kind: "grouping_share",
      id: calculation.id,
      title: calculation.title,
      measure: physicalBindingInPool(measure, plan.query.measures ?? []),
      category_dimension: calculation.category_dimension,
    };
  });
}

/** 在当前身份可见 catalog 上编译可执行工件。 */
export function compileAnalysisView(
  catalog: CompilerCatalog,
  input: { analysis: AnalysisDefinition; view: SemanticViewIntent },
  rawPreferences: ViewPreferences = EMPTY_VIEW_PREFERENCES,
): CompiledAnalysisView {
  const definition = parseAnalysisDefinition(input.analysis);
  const intent = parseSemanticViewIntent(input.view);
  const preferences = validateViewPreferences(intent, rawPreferences);
  const intents = definition.views.filter(
    (view): view is SemanticQueryView => !isSemanticDerivedView(view),
  );
  const resolved = intents.map((intent) => planQueryIntent(catalog, intent));
  const routes = routesForPlans(intents, resolved);
  const incompatible = resolved.find(
    (plan): plan is Extract<QueryIntentPlan, { status: "incompatible" }> =>
      plan.status === "incompatible",
  );
  if (incompatible) throw new SemanticQueryIncompatibleError(incompatible.reason, routes);
  const outputId = semanticAnalysisSink(definition.views);
  const intentById = new Map(intents.map((intent) => [intent.id, intent]));
  const directPlans = resolved.filter(
    (plan): plan is Extract<QueryIntentPlan, { status: "direct" }> => plan.status === "direct",
  );
  const queryById = new Map(directPlans.map((item) => [item.query.id, item.query]));
  // 查询计划的 query.id 恒等于其意图 id；上面的 fail-closed 已保证每个意图都有 direct 计划。
  const planByIntent = new Map(directPlans.map((item) => [item.query.id, item]));
  const physicalViews: Array<QueryViewSpec | DerivedViewSpec> = [];
  for (const view of definition.views) {
    if (isSemanticDerivedView(view)) {
      physicalViews.push(compileDerivedView(catalog, intentById, queryById, view));
      continue;
    }
    const plan = planByIntent.get(view.id);
    if (!plan) throw new Error(`查询视图 ${view.id} 缺少已解析执行计划`);
    const calculations = groupingShareCalculations(catalog, view, plan);
    const groupingSets = plan.query.grouping_sets;
    if (!groupingSets) throw new Error(`查询视图 ${view.id} 缺少基础分组集`);
    physicalViews.push({
      ...plan.query,
      grouping_sets: {
        ...groupingSets,
        ...(calculations.length ? { calculations } : {}),
      },
      ...(view.summary ? { summary: view.summary } : {}),
    });
  }
  const analysis = parseAnalysisSpec({
    ...(definition.title ? { title: definition.title } : {}),
    views: physicalViews,
  });
  const outputIntent = definition.views.find((view) => view.id === outputId);
  const outputPhysical = analysis.views.find((view) => view.id === outputId);
  if (!outputIntent || !outputPhysical) throw new Error(`结果视图 ${outputId} 不存在`);
  validateSemanticTableLayout(outputIntent, intent);
  const calculated = new Map<string, CalculatedMeasure>(
    !isSemanticDerivedView(outputIntent)
      ? (outputIntent.calculations ?? []).map((calculation) => [
          calculation.id,
          { title: calculation.title, numerator_id: calculation.measure },
        ])
      : [],
  );
  const presentation = bindPresentation(
    isSemanticDerivedView(outputIntent) && isDerivedViewSpec(outputPhysical)
      ? compileDerivedChart(intent, preferences)
      : !isSemanticDerivedView(outputIntent) && !isDerivedViewSpec(outputPhysical)
        ? compileBoundChart(
            catalog,
            outputIntent,
            intent,
            preferences,
            (reference, kind) => {
              const calculation = calculated.get(reference);
              if (kind === "measure" && calculation) return calculationColumnName(reference);
              return bindSemantic(catalog, outputIntent, outputPhysical, reference, kind);
            },
            calculated,
          )
        : (() => {
            throw new Error(`结果视图 ${outputId} 的语义类型与执行类型不一致`);
          })(),
    analysis,
  );
  const allRoutes = [...routes, ...routesForDerived(catalog, definition.views)];
  const plan = planExecution(analysis, {
    delivery: semanticDelivery(catalog, definition.views, planByIntent, allRoutes, outputId),
  });
  const outputPlan = planByIntent.get(outputId);
  const recordProjectionBinding =
    !isSemanticDerivedView(outputIntent) && outputPlan
      ? recordProjectionBindingForIntent(catalog, outputIntent, outputPlan)
      : null;
  return {
    plan,
    presentation,
    render_decl: projectPresentation(presentation, plan.output, plan.output.id),
    routes: allRoutes,
    record_projection_bindings: {
      views:
        recordProjectionBinding && Object.keys(recordProjectionBinding.metrics).length
          ? [recordProjectionBinding]
          : [],
    },
  };
}
