/**
 * 查询指纹：对归一后的 AnalysisDefinition 生成稳定内容哈希，仅用于使用报告聚合重复分析候选。
 * title/view_title 不进哈希（纯命名）；来源角色是固定词汇，直接进哈希；filters 按序列化排序，
 * measures/dimensions 保持原序——列顺序是表格形态的一部分。
 * 入参先过 canonical AnalysisDefinition 校验；定义无效（含物理 view 限定成员名）返回 undefined。
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../semantic_core/canonical_json.js";
import {
  parseAnalysisDefinition,
  semanticSourceViews,
  type SemanticQueryView,
  type SemanticColumnOperand,
  type SemanticExprNode,
  type SemanticLiteralOperand,
  type AnalysisDefinition,
} from "../semantic_core/semantic_analysis.js";

/** 规格无效（归一失败）时返回 undefined：报错调用没有可统计的分析规格。 */
export function queryFingerprint(input: unknown): string | undefined {
  let definition: AnalysisDefinition;
  try {
    definition = parseAnalysisDefinition(input);
  } catch {
    return undefined;
  }
  const digest = createHash("sha256")
    .update(canonicalJson(analysisShape(definition)))
    .digest("hex");
  return `q-${digest.slice(0, 10)}`;
}

function analysisShape(definition: AnalysisDefinition) {
  if ("composition" in definition) {
    const { group_by, filters, baseline, columns } = definition.composition;
    return {
      group_by,
      baseline,
      filters: (filters ?? []).map(canonicalJson).sort(),
      columns: columns.map(({ id, measure, time }) => ({ id, measure, time })),
    };
  }
  const shape = (query: SemanticQueryView) => ({
    measures: query.measures ?? [],
    dimensions: query.dimensions ?? [],
    filters: (query.filters ?? []).map(canonicalJson).sort(),
    ...(query.time ? { time: query.time } : {}),
    ...(query.group_sort ? { group_sort: query.group_sort } : {}),
  });
  const queries = semanticSourceViews(definition).map(({ query }) => shape(query));
  const derived = definition.derived
    ? {
        ...(definition.derived.joined
          ? {
              join: {
                how: definition.derived.joined.how,
                on: [...definition.derived.joined.on].sort(),
              },
            }
          : {}),
        columns: definition.derived.columns,
        order: definition.derived.order ?? [],
        ...(definition.derived.limit !== undefined ? { limit: definition.derived.limit } : {}),
      }
    : undefined;
  return { queries, ...(derived ? { derived } : {}) };
}

const OPERATOR_LABEL = { "+": "+", "-": "−", "*": "×", "/": "÷" } as const;

function renderOperand(
  node: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand,
  titles: ReadonlyMap<string, string>,
  nested = false,
): string {
  if ("lit" in node) return String(node.lit);
  if ("member" in node) return `${node.member}(${titles.get(node.source) ?? node.source})`;
  const expression =
    `${renderOperand(node.left, titles, true)} ${OPERATOR_LABEL[node.op]} ` +
    renderOperand(node.right, titles, true);
  return nested ? `(${expression})` : expression;
}

/** 周期报告只持久化派生公式摘要，不保存完整分析筛选与入参。 */
export function derivedFormulaSummaries(input: unknown): string[] {
  let definition: AnalysisDefinition;
  try {
    definition = parseAnalysisDefinition(input);
  } catch {
    return [];
  }
  const derived = "query" in definition ? definition.derived : undefined;
  if (!derived) return [];
  const titles = new Map(
    semanticSourceViews(definition).map(({ role, query }) => [role, query.view_title ?? role]),
  );
  const expressions = derived.columns.flatMap((column) =>
    "expr" in column ? [`${column.as} = ${renderOperand(column.expr, titles)}`] : [],
  );
  if (expressions.length || !derived.joined) return expressions;
  const sources = semanticSourceViews(definition).map(({ role }) => titles.get(role) ?? role);
  return [`${sources.join(` ${derived.joined.how} join `)}（${derived.joined.on.join(" + ")}）`];
}
