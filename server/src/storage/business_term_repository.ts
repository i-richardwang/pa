import { randomUUID } from "node:crypto";
import {
  BusinessTermNotFoundError,
  type BusinessTermRepository,
  type NormalizedBusinessTermContent,
  type StoredBusinessTerm,
} from "../ports/business_term_repository.js";
import type { SqliteDatabase } from "../sqlite.js";

type TermRow = Omit<StoredBusinessTerm, "aliases" | "related_member_ids"> & {
  aliases: string;
  related_member_ids: string;
};

const storedContent = (input: NormalizedBusinessTermContent) => ({
  canonical_term: input.canonical_term,
  definition: input.definition,
  context: input.context ?? null,
  aliases: input.aliases,
  related_member_ids: input.related_member_ids,
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
        .prepare(
          `SELECT * FROM business_term WHERE archived_at IS NULL
             ORDER BY canonical_term COLLATE NOCASE, id`,
        )
        .all() as TermRow[]
    ).map(toStored);
  }

  async function get(id: string): Promise<StoredBusinessTerm | null> {
    const row = db.prepare("SELECT * FROM business_term WHERE id = ?").get(id) as
      | TermRow
      | undefined;
    return row ? toStored(row) : null;
  }

  async function create(input: NormalizedBusinessTermContent): Promise<StoredBusinessTerm> {
    const term: StoredBusinessTerm = {
      id: randomUUID(),
      archived_at: null,
      ...storedContent(input),
    };
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

  async function replace(
    id: string,
    input: NormalizedBusinessTermContent,
  ): Promise<StoredBusinessTerm> {
    const next: StoredBusinessTerm = { id, archived_at: null, ...storedContent(input) };
    const result = db
      .prepare(
        `UPDATE business_term
         SET canonical_term = ?, definition = ?, context = ?, aliases = ?, related_member_ids = ?
         WHERE id = ? AND archived_at IS NULL`,
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

  async function setArchivedAt(id: string, archivedAt: string | null): Promise<StoredBusinessTerm> {
    const current = await get(id);
    if (!current) throw new BusinessTermNotFoundError("业务术语不存在");
    db.prepare("UPDATE business_term SET archived_at = ? WHERE id = ?").run(archivedAt, id);
    return { ...current, archived_at: archivedAt };
  }

  const archive = (id: string) => setArchivedAt(id, new Date().toISOString());
  const restore = (id: string) => setArchivedAt(id, null);

  return { list, get, create, replace, archive, restore };
}
