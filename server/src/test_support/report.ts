import {
  analysisSink,
  isDerivedViewSpec,
  type AnalysisSpec,
  type ColumnOperand,
  type ExprNode,
  type LiteralOperand,
  type QueryViewSpec,
} from "../semantic_core/analysis_spec.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import {
  parseAnalysisDefinition,
  type AnalysisDefinition,
  type SemanticColumnOperand,
  type SemanticSourceRole,
  type SemanticExprNode,
  type SemanticLiteralOperand,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import {
  TIME_INTENT_INPUT,
  type TimeInput,
  type TimeIntent,
} from "../semantic_core/time_contract.js";
import { memberShortName } from "../semantic_core/member_name.js";

function semanticMember(query: QueryViewSpec, reference: string): string {
  if (/^(?:measure|dimension):[a-z][a-z0-9_]*$/.test(reference)) return reference;
  const measure = (query.measures ?? []).find(
    (candidate) => memberShortName(candidate) === memberShortName(reference),
  );
  if (measure) return `measure:${memberShortName(measure)}`;
  const dimension = (query.dimensions ?? []).find(
    (candidate) => memberShortName(candidate) === memberShortName(reference),
  );
  if (dimension) return `dimension:${memberShortName(dimension)}`;
  throw new Error(`测试报告的查询视图 ${query.id} 不包含字段 ${reference}`);
}

function semanticOperand(
  queries: ReadonlyMap<string, { role: SemanticSourceRole; view: QueryViewSpec }>,
  operand: ColumnOperand,
): SemanticColumnOperand {
  const source = queries.get(operand.source);
  if (!source) throw new Error(`测试报告不存在查询视图 ${operand.source}`);
  return {
    source: source.role,
    member: semanticMember(source.view, operand.col),
  };
}

function semanticExpression(
  queries: ReadonlyMap<string, { role: SemanticSourceRole; view: QueryViewSpec }>,
  node: ExprNode | ColumnOperand | LiteralOperand,
): SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand {
  if ("lit" in node) return node;
  if ("col" in node) return semanticOperand(queries, node);
  return {
    op: node.op,
    left: semanticExpression(queries, node.left),
    right: semanticExpression(queries, node.right),
  };
}

/** 测试夹具只把简单物理时间坐标还原为当前语义输入；复杂时间用例直接构造 AnalysisDefinition。 */
function testTimeIntent(time: TimeInput): TimeIntent {
  if ("last" in time || time.compare) {
    throw new Error("复杂时间测试必须直接使用 TimeIntent 构造语义规格");
  }
  if ("range" in time) {
    if (time.grain !== "year" && time.grain !== "month") {
      throw new Error("期间夹具必须带序列粒度 year 或 month");
    }
    return TIME_INTENT_INPUT.parse({
      window: { kind: "range", from: time.range.from, to: time.range.to, grain: time.grain },
    });
  }
  const cutoff = "cutoff" in time ? time.cutoff : undefined;
  return TIME_INTENT_INPUT.parse({
    window: { kind: "current_month", ...(cutoff ? { month: cutoff } : {}) },
  });
}

/** 为不关心 catalog 路由的存储与 HTTP 测试构造同成员名语义规格。 */
export function semanticAnalysisOf(
  analysis: AnalysisSpec,
  presentation: PresentationSpec = { type: "table" },
): { analysis: AnalysisDefinition; view: SemanticViewIntent } {
  const queryViews = analysis.views.filter(
    (view): view is QueryViewSpec => !isDerivedViewSpec(view),
  );
  const derivedView = analysis.views.find(isDerivedViewSpec);
  const roles: SemanticSourceRole[] = ["query", "joined"];
  const sourceIds = derivedView ? derivedView.from : queryViews.map((view) => view.id);
  if (sourceIds.length > roles.length) throw new Error("测试报告的来源查询超过两个");
  const sourceById = new Map(
    sourceIds.map((id, index) => {
      const view = queryViews.find((candidate) => candidate.id === id);
      if (!view) throw new Error(`测试报告不存在查询视图 ${id}`);
      return [id, { role: roles[index]!, view }] as const;
    }),
  );
  const semanticQuery = (view: QueryViewSpec) => {
    const groupSort = view.selection
      ? {
          dimension: semanticMember(view, view.selection.dimensions.at(-1)!),
          by: view.selection.dimensions.includes(view.selection.by)
            ? "name"
            : semanticMember(view, view.selection.by),
          direction: view.selection.direction,
          max_items: view.selection.count,
        }
      : view.order?.length === 1 && view.dimensions?.length
        ? {
            dimension: semanticMember(view, view.dimensions.at(-1)!),
            by: view.dimensions.includes(view.order[0]!.member)
              ? "name"
              : semanticMember(view, view.order[0]!.member),
            direction: view.order[0]!.direction,
          }
        : undefined;
    if (view.order && view.order.length > 1) {
      throw new Error("测试报告的直接查询排序无法归属到唯一 Breakdown");
    }
    return {
      ...(view.view_title ? { view_title: view.view_title } : {}),
      ...(view.measures
        ? { measures: view.measures.map((member) => semanticMember(view, member)) }
        : {}),
      ...(view.dimensions
        ? { dimensions: view.dimensions.map((member) => semanticMember(view, member)) }
        : {}),
      ...(view.filters
        ? {
            filters: view.filters.map((filter) => {
              if (filter.operator !== "equals" && filter.operator !== "notEquals") {
                throw new Error(`测试报告的公开筛选不支持物理算子 ${filter.operator}`);
              }
              return {
                member: semanticMember(view, filter.member),
                relation: filter.operator === "equals" ? "one_of" : "none_of",
                values: filter.values,
              };
            }),
          }
        : {}),
      time: testTimeIntent(view.time),
      ...(groupSort ? { group_sort: groupSort } : {}),
    };
  };
  const rootSource = sourceById.get(sourceIds[0]!)!;
  const joinedSource = sourceIds[1] ? sourceById.get(sourceIds[1])! : undefined;
  const definition = parseAnalysisDefinition({
    ...(analysis.title ? { title: analysis.title } : {}),
    query: semanticQuery(rootSource.view),
    ...(derivedView
      ? {
          derived: {
            view_title: derivedView.view_title,
            ...(derivedView.join && joinedSource
              ? {
                  joined: {
                    query: semanticQuery(joinedSource.view),
                    how: derivedView.join.how,
                    on: derivedView.join.on.map((binding) => {
                      const leftMember = semanticMember(rootSource.view, binding.left);
                      const rightMember = semanticMember(joinedSource.view, binding.right);
                      if (leftMember !== rightMember) {
                        throw new Error(
                          `测试报告 join 字段 ${binding.left} / ${binding.right} 的语义成员不一致`,
                        );
                      }
                      return leftMember;
                    }),
                  },
                }
              : {}),
            columns: derivedView.columns.map((column) =>
              "col" in column
                ? { ...semanticOperand(sourceById, column), as: column.as ?? column.col }
                : {
                    expr: semanticExpression(sourceById, column.expr),
                    as: column.as,
                    ...(column.format ? { format: column.format } : {}),
                  },
            ),
            ...(derivedView.order ? { order: derivedView.order } : {}),
            ...(derivedView.limit ? { limit: derivedView.limit } : {}),
          },
        }
      : {}),
  });
  const view: SemanticViewIntent = (() => {
    const outputId = analysisSink(analysis.views);
    const view = analysis.views.find((candidate) => candidate.id === outputId);
    if (!view) throw new Error(`测试报告不存在结果视图 ${outputId}`);
    const query = isDerivedViewSpec(view) ? null : view;
    const reference = (member: string): string => (query ? semanticMember(query, member) : member);
    if (presentation.type === "table" || presentation.type === "kpi") {
      return { type: presentation.type };
    }
    const series = presentation.y.map(reference);
    if (presentation.type === "line") {
      return {
        type: "line",
        series,
        ...(presentation.groupBy ? { group_by: reference(presentation.groupBy) } : {}),
      };
    }
    if (presentation.type === "pie") {
      return { type: "pie", series, category: reference(presentation.x) };
    }
    return {
      type: "bar",
      series,
      category: reference(presentation.x),
      ...(presentation.annotations ? { annotations: presentation.annotations.map(reference) } : {}),
      ...(presentation.groupBy ? { group_by: reference(presentation.groupBy) } : {}),
      ...(presentation.stack !== undefined ? { stack: presentation.stack } : {}),
    };
  })();
  return { analysis: definition, view };
}

export async function unexpectedExport(): Promise<never> {
  throw new Error("此分析不应签发导出票据");
}
