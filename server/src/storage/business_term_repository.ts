import { randomUUID } from "node:crypto";
import { normalizeBusinessTerm } from "../engine/business_term_matcher.js";
import {
  BusinessTermNotFoundError,
  type BusinessTermContent,
  type BusinessTermRepository,
  type StoredBusinessTerm,
} from "../ports/business_term_repository.js";
import type { SqliteDatabase } from "../sqlite.js";

export {
  BusinessTermNotFoundError,
  type BusinessTermContent,
  type BusinessTermRepository,
  type StoredBusinessTerm,
} from "../ports/business_term_repository.js";

type TermRow = Omit<StoredBusinessTerm, "aliases" | "related_member_ids"> & {
  aliases: string;
  related_member_ids: string;
};

const distinctValues = (values: string[], canonical?: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const normalizedCanonical = canonical ? normalizeBusinessTerm(canonical) : undefined;
  for (const raw of values) {
    const value = raw.trim();
    const normalized = normalizeBusinessTerm(value);
    if (!normalized || normalized === normalizedCanonical || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value);
  }
  return out;
};

const storedContent = (input: BusinessTermContent) => ({
  canonical_term: input.canonical_term.trim(),
  definition: input.definition.trim(),
  context: input.context?.trim() || null,
  aliases: distinctValues(input.aliases, input.canonical_term),
  related_member_ids: distinctValues(input.related_member_ids),
});

const parseStringList = (value: string, field: string): string[] => {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`业务术语 ${field} 不是字符串数组`);
  }
  return parsed;
};

const toStored = (row: TermRow): StoredBusinessTerm => ({
  ...row,
  aliases: parseStringList(row.aliases, "aliases"),
  related_member_ids: parseStringList(row.related_member_ids, "related_member_ids"),
});

export function createBusinessTermRepository(db: SqliteDatabase): BusinessTermRepository {
  async function list(): Promise<StoredBusinessTerm[]> {
    return (
      db
        .prepare("SELECT * FROM business_term ORDER BY canonical_term COLLATE NOCASE, id")
        .all() as TermRow[]
    ).map(toStored);
  }

  async function get(id: string): Promise<StoredBusinessTerm | null> {
    const row = db.prepare("SELECT * FROM business_term WHERE id = ?").get(id) as
      | TermRow
      | undefined;
    return row ? toStored(row) : null;
  }

  async function create(input: BusinessTermContent): Promise<StoredBusinessTerm> {
    const term: StoredBusinessTerm = { id: randomUUID(), ...storedContent(input) };
    db.prepare(
      `INSERT INTO business_term
         (id, canonical_term, definition, context, aliases, related_member_ids)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      term.id,
      term.canonical_term,
      term.definition,
      term.context,
      JSON.stringify(term.aliases),
      JSON.stringify(term.related_member_ids),
    );
    return term;
  }

  async function replace(id: string, input: BusinessTermContent): Promise<StoredBusinessTerm> {
    const next: StoredBusinessTerm = { id, ...storedContent(input) };
    const result = db
      .prepare(
        `UPDATE business_term
         SET canonical_term = ?, definition = ?, context = ?, aliases = ?, related_member_ids = ?
         WHERE id = ?`,
      )
      .run(
        next.canonical_term,
        next.definition,
        next.context,
        JSON.stringify(next.aliases),
        JSON.stringify(next.related_member_ids),
        id,
      );
    if (Number(result.changes) !== 1) throw new BusinessTermNotFoundError("业务术语不存在");
    return next;
  }

  async function remove(id: string): Promise<StoredBusinessTerm> {
    const current = await get(id);
    if (!current) throw new BusinessTermNotFoundError("业务术语不存在");
    db.prepare("DELETE FROM business_term WHERE id = ?").run(id);
    return current;
  }

  return { list, get, create, replace, remove };
}
