/** Catalog 公开请求合同与确定性归一。 */
import { z } from "zod";

export const CATALOG_TERMS_MAX = 20;
export const CATALOG_TERM_LENGTH_MAX = 100;

export const CATALOG_TERMS_INPUT = z
  .array(z.string().trim().min(1).max(CATALOG_TERM_LENGTH_MAX))
  .min(1)
  .max(CATALOG_TERMS_MAX)
  .optional()
  .describe("本次问题涉及的业务概念、指标名或同义词；每项作为一个完整术语匹配并一次提交");

export const CATALOG_QUERY_INPUT = z.object({ terms: CATALOG_TERMS_INPUT }).strict();
export type CatalogQueryInput = z.infer<typeof CATALOG_QUERY_INPUT>;

export type NormalizedCatalogQuery = { mode: "overview" } | { mode: "search"; terms: string[] };

/** trim、大小写不敏感去重，保留第一次出现的原始写法供逐项记账。 */
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

/** 空入参浏览全部成员，terms 筛选目录；真实值由独立 values_of 工具负责。 */
export function normalizeCatalogQuery(input: CatalogQueryInput): NormalizedCatalogQuery {
  return input.terms === undefined
    ? { mode: "overview" }
    : { mode: "search", terms: normalizeCatalogTerms(input.terms) };
}
