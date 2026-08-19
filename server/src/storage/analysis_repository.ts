import { randomUUID } from "node:crypto";
import {
  parseAnalysisDefinition,
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import {
  ANALYSIS_RETENTION_DAYS,
  AnalysisNotFoundError,
  AnalysisViewNotFoundError,
  type AnalysisRecord,
  type AnalysisRepository,
  type AnalysisViewRecord,
  type OwnedAnalysisView,
} from "../ports/analysis_repository.js";
import type { SqliteDatabase } from "../sqlite.js";
import { inTransaction } from "./app_database.js";
import {
  EMPTY_VIEW_PREFERENCES,
  validateViewPreferences,
  type ViewPreferences,
} from "../presentation_core/view_preferences.js";

export {
  ANALYSIS_RETENTION_DAYS,
  AnalysisNotFoundError,
  AnalysisViewNotFoundError,
  type AnalysisRecord,
  type AnalysisRepository,
  type AnalysisViewRecord,
  type OwnedAnalysisView,
} from "../ports/analysis_repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createAnalysisRepository(
  db: SqliteDatabase,
  options: { now?: () => number } = {},
): AnalysisRepository {
  const now = options.now ?? Date.now;
  let lastCleanupAt = Number.NEGATIVE_INFINITY;

  const analysisRecord = (row: {
    id: string;
    owner: string;
    definition: string;
    created_at: string;
  }): AnalysisRecord => ({
    id: row.id,
    owner: row.owner,
    definition: parseAnalysisDefinition(JSON.parse(row.definition)),
    created_at: row.created_at,
  });

  const viewRecord = (row: {
    id: string;
    analysis_id: string;
    intent: string;
    preferences: string;
    created_at: string;
  }): AnalysisViewRecord => {
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(JSON.parse(row.intent));
    return {
      id: row.id,
      analysis_id: row.analysis_id,
      intent,
      preferences: validateViewPreferences(intent, JSON.parse(row.preferences)),
      created_at: row.created_at,
    };
  };

  async function cleanIfDue(): Promise<void> {
    if (now() - lastCleanupAt >= DAY_MS) await removeExpired();
  }

  function newView(
    analysisId: string,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences,
    createdAt: string,
  ) {
    const intent = SEMANTIC_VIEW_INTENT_INPUT.parse(rawIntent);
    const preferences = validateViewPreferences(intent, rawPreferences);
    return {
      id: randomUUID(),
      analysis_id: analysisId,
      intent: JSON.stringify(intent),
      preferences: JSON.stringify(preferences),
      created_at: createdAt,
    };
  }

  async function create(
    owner: string,
    rawDefinition: AnalysisDefinition,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences = EMPTY_VIEW_PREFERENCES,
  ): Promise<OwnedAnalysisView> {
    await cleanIfDue();
    const definition = parseAnalysisDefinition(rawDefinition);
    const createdAt = new Date(now()).toISOString();
    const analysis = {
      id: randomUUID(),
      owner: owner.trim(),
      definition: JSON.stringify(definition),
      created_at: createdAt,
    };
    const view = newView(analysis.id, rawIntent, rawPreferences, createdAt);
    inTransaction(db, () => {
      db.prepare(
        "INSERT INTO analysis (id, owner, definition, created_at) VALUES (?, ?, ?, ?)",
      ).run(analysis.id, analysis.owner, analysis.definition, analysis.created_at);
      db.prepare(
        "INSERT INTO analysis_view (id, analysis_id, intent, preferences, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(view.id, view.analysis_id, view.intent, view.preferences, view.created_at);
    });
    return { analysis: analysisRecord(analysis), view: viewRecord(view) };
  }

  async function createView(
    owner: string,
    analysisId: string,
    rawIntent: SemanticViewIntent,
    rawPreferences: ViewPreferences = EMPTY_VIEW_PREFERENCES,
  ): Promise<OwnedAnalysisView> {
    await cleanIfDue();
    const analysis = await resolveOwnedAnalysis(analysisId, owner);
    const view = newView(analysis.id, rawIntent, rawPreferences, new Date(now()).toISOString());
    db.prepare(
      "INSERT INTO analysis_view (id, analysis_id, intent, preferences, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(view.id, view.analysis_id, view.intent, view.preferences, view.created_at);
    return { analysis, view: viewRecord(view) };
  }

  async function getAnalysis(id: string): Promise<AnalysisRecord | null> {
    const row = db
      .prepare("SELECT id, owner, definition, created_at FROM analysis WHERE id = ?")
      .get(id) as { id: string; owner: string; definition: string; created_at: string } | undefined;
    return row ? analysisRecord(row) : null;
  }

  async function getView(id: string): Promise<AnalysisViewRecord | null> {
    const row = db
      .prepare(
        "SELECT id, analysis_id, intent, preferences, created_at FROM analysis_view WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          analysis_id: string;
          intent: string;
          preferences: string;
          created_at: string;
        }
      | undefined;
    return row ? viewRecord(row) : null;
  }

  function analysisReferenced(id: string): boolean {
    return Boolean(
      db
        .prepare(
          `SELECT 1
           FROM analysis_view
           WHERE analysis_id = ?
             AND (
               EXISTS (SELECT 1 FROM report WHERE report.view_id = analysis_view.id)
               OR EXISTS (
                 SELECT 1 FROM report_revision WHERE report_revision.view_id = analysis_view.id
               )
             )
           LIMIT 1`,
        )
        .get(id),
    );
  }

  async function resolveOwnedAnalysis(id: string, owner: string): Promise<AnalysisRecord> {
    const row = await getAnalysis(id);
    const expired = row
      ? Date.parse(row.created_at) < now() - ANALYSIS_RETENTION_DAYS * DAY_MS &&
        !analysisReferenced(id)
      : false;
    if (!row || row.owner !== owner || expired) {
      throw new AnalysisNotFoundError("分析不存在、已过期或无权访问");
    }
    return row;
  }

  async function resolveOwnedView(id: string, owner: string): Promise<OwnedAnalysisView> {
    const view = await getView(id);
    if (!view) throw new AnalysisViewNotFoundError("分析视图不存在、已过期或无权访问");
    try {
      const analysis = await resolveOwnedAnalysis(view.analysis_id, owner);
      return { analysis, view };
    } catch (error) {
      if (error instanceof AnalysisNotFoundError) {
        throw new AnalysisViewNotFoundError("分析视图不存在、已过期或无权访问");
      }
      throw error;
    }
  }

  async function removeExpired(): Promise<number> {
    const current = now();
    const cutoff = new Date(current - ANALYSIS_RETENTION_DAYS * DAY_MS).toISOString();
    const predicate = `
      created_at < ?
      AND NOT EXISTS (
        SELECT 1 FROM analysis_view
        WHERE analysis_view.analysis_id = analysis.id
          AND (
            EXISTS (SELECT 1 FROM report WHERE report.view_id = analysis_view.id)
            OR EXISTS (
              SELECT 1 FROM report_revision WHERE report_revision.view_id = analysis_view.id
            )
          )
      )`;
    const candidates = db.prepare(`SELECT id FROM analysis WHERE ${predicate}`).all(cutoff) as {
      id: string;
    }[];
    db.prepare(`DELETE FROM analysis WHERE ${predicate}`).run(cutoff);
    lastCleanupAt = current;
    return candidates.length;
  }

  return {
    create,
    createView,
    getAnalysis,
    getView,
    resolveOwnedAnalysis,
    resolveOwnedView,
    removeExpired,
  };
}
