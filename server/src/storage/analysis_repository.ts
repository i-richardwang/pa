import { randomUUID } from "node:crypto";
import {
  parseSemanticAnalysisSpec,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import {
  ANALYSIS_RETENTION_DAYS,
  AnalysisNotFoundError,
  type AnalysisRecord,
  type AnalysisRepository,
} from "../ports/analysis_repository.js";
import type { SqliteDatabase } from "../sqlite.js";

export {
  ANALYSIS_RETENTION_DAYS,
  AnalysisNotFoundError,
  type AnalysisRecord,
  type AnalysisRepository,
} from "../ports/analysis_repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createAnalysisRepository(
  db: SqliteDatabase,
  options: { now?: () => number } = {},
): AnalysisRepository {
  const now = options.now ?? Date.now;
  let lastCleanupAt = Number.NEGATIVE_INFINITY;

  const record = (row: {
    id: string;
    owner: string;
    spec: string;
    created_at: string;
  }): AnalysisRecord => ({
    ...row,
    spec: parseSemanticAnalysisSpec(JSON.parse(row.spec)),
  });

  async function create(owner: string, rawSpec: SemanticAnalysisSpec): Promise<AnalysisRecord> {
    if (now() - lastCleanupAt >= DAY_MS) await removeExpired();
    const spec = parseSemanticAnalysisSpec(rawSpec);
    const row = {
      id: randomUUID(),
      owner: owner.trim(),
      spec: JSON.stringify(spec),
      created_at: new Date(now()).toISOString(),
    };
    db.prepare("INSERT INTO analysis (id, owner, spec, created_at) VALUES (?, ?, ?, ?)").run(
      row.id,
      row.owner,
      row.spec,
      row.created_at,
    );
    return record(row);
  }

  async function get(id: string): Promise<AnalysisRecord | null> {
    const row = db
      .prepare("SELECT id, owner, spec, created_at FROM analysis WHERE id = ?")
      .get(id) as
      | {
          id: string;
          owner: string;
          spec: string;
          created_at: string;
        }
      | undefined;
    return row ? record(row) : null;
  }

  function referenced(id: string): boolean {
    return Boolean(
      db
        .prepare(
          `SELECT 1
           FROM (
             SELECT analysis_id FROM report
             UNION ALL
             SELECT analysis_id FROM report_revision
           )
           WHERE analysis_id = ?
           LIMIT 1`,
        )
        .get(id),
    );
  }

  async function resolveOwned(id: string, owner: string): Promise<AnalysisRecord> {
    const row = await get(id);
    const expired = row
      ? Date.parse(row.created_at) < now() - ANALYSIS_RETENTION_DAYS * DAY_MS && !referenced(id)
      : false;
    if (!row || row.owner !== owner || expired) {
      throw new AnalysisNotFoundError("分析不存在、已过期或无权访问");
    }
    return row;
  }

  async function removeExpired(): Promise<number> {
    const current = now();
    const cutoff = new Date(current - ANALYSIS_RETENTION_DAYS * DAY_MS).toISOString();
    const unreferenced = `
      created_at < ?
      AND NOT EXISTS (SELECT 1 FROM report WHERE report.analysis_id = analysis.id)
      AND NOT EXISTS (
        SELECT 1 FROM report_revision WHERE report_revision.analysis_id = analysis.id
      )`;
    const rows = db.prepare(`SELECT id FROM analysis WHERE ${unreferenced}`).all(cutoff) as {
      id: string;
    }[];
    db.prepare(`DELETE FROM analysis WHERE ${unreferenced}`).run(cutoff);
    lastCleanupAt = current;
    return rows.length;
  }

  return { create, get, resolveOwned, removeExpired };
}
