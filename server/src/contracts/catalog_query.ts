import { z } from "zod";

export const CATALOG_TERMS_MAX = 20;
export const CATALOG_TERM_LENGTH_MAX = 100;

export const CATALOG_TERMS_INPUT = z
  .array(z.string().trim().min(1).max(CATALOG_TERM_LENGTH_MAX))
  .min(1)
  .max(CATALOG_TERMS_MAX)
  .optional()
  .describe("本次问题涉及的业务概念、指标名或同义词；每项作为一个完整术语匹配并一次提交");

export const CATALOG_QUERY_INPUT = z.strictObject({ terms: CATALOG_TERMS_INPUT });
export type CatalogQueryInput = z.infer<typeof CATALOG_QUERY_INPUT>;

export type NormalizedCatalogQuery = { mode: "overview" } | { mode: "search"; terms: string[] };

/** 保留第一次出现的原始写法，供 unmatched_terms 逐项回报。 */
export function normalizeCatalogTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(term);
  }
  if (!normalized.length) throw new Error("terms 至少提供一个非空业务概念");
  return normalized;
}

/** 无 terms 时返回目录概览，有 terms 时按术语检索；维度取值由 values_of 工具查询。 */
export function normalizeCatalogQuery(input: CatalogQueryInput): NormalizedCatalogQuery {
  return input.terms === undefined
    ? { mode: "overview" }
    : { mode: "search", terms: normalizeCatalogTerms(input.terms) };
}
