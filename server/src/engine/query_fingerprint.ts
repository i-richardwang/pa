/**
 * 查询指纹：对归一后的语义分析规格生成稳定内容哈希，仅用于使用报告聚合重复分析候选。
 * 指纹锚定"查出什么数"：
 * - 参与哈希：查询视图的 measures/dimensions/filters/time/group_sort；派生视图的
 *   from/join/columns（含表达式 AST 与搬运/派生列的 as 列身份）/order/limit；
 * - 不参与：analysis.title/view_title 与局部 view id（纯命名）——换标题或换 id 不换码；
 * - filters 内部键排序且按序列化排序：过滤条件写法顺序不同不算两种分析；
 *   measures/dimensions 保持原序——列顺序即表格形态的一部分。
 * 入参先过 canonical SemanticAnalysisSpec 校验；规格无效（含物理 view 限定成员名）返回 undefined。
 */
import { createHash } from "node:crypto";
import {
  isSemanticDerivedView,
  parseSemanticAnalysisSpec,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";

export const QUERY_FINGERPRINT_PATTERN = /^q-[0-9a-f]{10}$/;

/** 值的稳定序列化：对象键排序，数组保序（调用方对需要排序的数组自行先排） */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 规格无效（归一失败）时返回 undefined：报错调用没有可统计的分析规格。 */
export function queryFingerprint(input: unknown): string | undefined {
  let spec: SemanticAnalysisSpec;
  try {
    spec = parseSemanticAnalysisSpec(input);
  } catch {
    return undefined;
  }
  const analysisViews = spec.analysis.views;
  const stableId = new Map(analysisViews.map((view, index) => [view.id, `view_${index + 1}`]));
  const normalizeSources = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeSources);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        key === "source" && typeof entry === "string"
          ? (stableId.get(entry) ?? entry)
          : normalizeSources(entry),
      ]),
    );
  };
  const views = analysisViews.map((s) => {
    if (isSemanticDerivedView(s)) {
      return {
        from: s.from.map((id) => stableId.get(id) ?? id),
        ...(s.join ? { join: { how: s.join.how, on: [...s.join.on].sort() } } : {}),
        columns: normalizeSources(s.columns),
        order: s.order ?? [],
        ...(s.limit !== undefined ? { limit: s.limit } : {}),
      };
    }
    return {
      measures: s.measures ?? [],
      dimensions: s.dimensions ?? [],
      filters: (s.filters ?? []).map(canonical).sort(),
      ...(s.time ? { time: s.time } : {}),
      ...(s.group_sort ? { group_sort: s.group_sort } : {}),
    };
  });
  const digest = createHash("sha256").update(canonical({ views })).digest("hex");
  return `q-${digest.slice(0, 10)}`;
}
