/**
 * catalog 入参契约：无 terms 浏览全部可见成员，有 terms 按业务概念筛选。
 * 归一层只裁决内部执行分支与表示形式，不改变两种调用共用的公开输出结构。
 */
import { z } from "zod";

export const CATALOG_TERMS_MAX = 20;
export const CATALOG_TERM_LENGTH_MAX = 100;

export const CATALOG_INPUT = {
  terms: z
    .array(z.string().trim().min(1).max(CATALOG_TERM_LENGTH_MAX))
    .min(1)
    .max(CATALOG_TERMS_MAX)
    .optional()
    .describe("本次问题涉及的业务概念、指标名或同义词；每项作为一个完整术语匹配并一次提交"),
};

const catalogInput = z.object(CATALOG_INPUT);
export type CatalogToolInput = z.infer<typeof catalogInput>;

export type NormalizedCatalogInput = { mode: "overview" } | { mode: "search"; terms: string[] };

/** trim、大小写不敏感去重，保留第一次出现的原始写法供逐项记账。 */
export function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  if (!out.length) throw new Error("terms 至少提供一个非空业务概念");
  return out;
}

/** 空入参浏览全部成员，terms 筛选目录；真实值由独立 values_of 工具负责。 */
export function normalizeCatalogInput(input: CatalogToolInput): NormalizedCatalogInput {
  if (input.terms !== undefined) {
    return { mode: "search", terms: normalizeTerms(input.terms) };
  }
  return { mode: "overview" };
}
