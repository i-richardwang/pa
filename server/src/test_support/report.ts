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
  type SemanticExprNode,
  type SemanticLiteralOperand,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import {
  resolveTimeOutputGrain,
  TIME_INTENT_INPUT,
  type TimeInput,
  type TimeIntent,
} from "../semantic_core/time_contract.js";
import { memberShortName } from "../semantic_core/member_name.js";

function semanticMember(query: QueryViewSpec, reference: string): string {
  if (reference === "year" || reference === "month") return reference;
  const member = [...(query.measures ?? []), ...(query.dimensions ?? [])].find(
    (candidate) => memberShortName(candidate) === memberShortName(reference),
  );
  if (!member) throw new Error(`测试报告的查询视图 ${query.id} 不包含字段 ${reference}`);
  return member;
}

function semanticOperand(
  queries: ReadonlyMap<string, QueryViewSpec>,
  operand: ColumnOperand,
): SemanticColumnOperand {
  const query = queries.get(operand.source);
  if (!query) throw new Error(`测试报告不存在查询视图 ${operand.source}`);
  return {
    source: operand.source,
    member: semanticMember(query, operand.col),
  };
}

function semanticExpression(
  queries: ReadonlyMap<string, QueryViewSpec>,
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
function testTimeIntent(time: TimeInput, grouped: boolean): TimeIntent {
  if (time.last || time.compare) {
    throw new Error("复杂时间测试必须直接使用 TimeIntent 构造语义规格");
  }
  // 显示方式只有序列粒度；整段单桶时省略 display。
  const grain = time.grain ?? resolveTimeOutputGrain(time, undefined, { grouped });
  return TIME_INTENT_INPUT.parse({
    window: time.range
      ? { kind: "range", from: time.range.from, to: time.range.to }
      : { kind: "current_month", ...(time.cutoff ? { month: time.cutoff } : {}) },
    ...(grain === "total" ? {} : { display: grain }),
  });
}

/** 为不关心 catalog 路由的存储与 HTTP 测试构造同成员名语义规格。 */
export function semanticAnalysisOf(
  analysis: AnalysisSpec,
  presentation: PresentationSpec = {
    type: "table",
    y: [],
  },
): { analysis: AnalysisDefinition; view: SemanticViewIntent } {
  const queryViews = analysis.views.filter(
    (view): view is QueryViewSpec => !isDerivedViewSpec(view),
  );
  const queryById = new Map(queryViews.map((view) => [view.id, view]));
  const definition = parseAnalysisDefinition({
    ...(analysis.title ? { title: analysis.title } : {}),
    views: analysis.views.map((view) => {
      if (!isDerivedViewSpec(view)) {
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
          id: view.id,
          ...(view.view_title ? { view_title: view.view_title } : {}),
          ...(view.measures ? { measures: view.measures } : {}),
          ...(view.dimensions ? { dimensions: view.dimensions } : {}),
          ...(view.filters
            ? {
                filters: view.filters.map((filter) => {
                  if (filter.operator !== "equals" && filter.operator !== "notEquals") {
                    throw new Error(`测试报告的公开筛选不支持物理算子 ${filter.operator}`);
                  }
                  return {
                    member: filter.member,
                    relation: filter.operator === "equals" ? "one_of" : "none_of",
                    values: filter.values,
                  };
                }),
              }
            : {}),
          time: testTimeIntent(view.time, (view.dimensions ?? []).length > 0),
          ...(groupSort ? { group_sort: groupSort } : {}),
        };
      }
      return {
        id: view.id,
        view_title: view.view_title,
        from: view.from,
        ...(view.join
          ? {
              join: {
                how: view.join.how,
                on: view.join.on.map((binding) => {
                  const left = queryById.get(view.from[0]);
                  const right = queryById.get(view.from[1]);
                  if (!left || !right) throw new Error("测试报告缺少 join 输入视图");
                  const leftMember = semanticMember(left, binding.left);
                  const rightMember = semanticMember(right, binding.right);
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
        columns: view.columns.map((column) =>
          "col" in column
            ? {
                ...semanticOperand(queryById, column),
                as: column.as ?? column.col,
              }
            : {
                expr: semanticExpression(queryById, column.expr),
                as: column.as,
                ...(column.format ? { format: column.format } : {}),
              },
        ),
        ...(view.order ? { order: view.order } : {}),
        ...(view.limit ? { limit: view.limit } : {}),
      };
    }),
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
    return {
      type: presentation.type,
      ...(presentation.x ? { category: reference(presentation.x) } : {}),
      series: presentation.y.map(reference),
      ...(presentation.annotations ? { annotations: presentation.annotations.map(reference) } : {}),
      ...(presentation.groupBy ? { group_by: reference(presentation.groupBy) } : {}),
      ...(presentation.stack !== undefined ? { stack: presentation.stack } : {}),
    };
  })();
  return { analysis: definition, view };
}
