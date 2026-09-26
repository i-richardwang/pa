/**
 * 每次 MCP 工具调用写一行 usage_log，只记元数据与结果规模，不存原始入参或结果行。
 * title 保存问题原文；query_fingerprint 用于聚合重复查询。
 */
import { USAGE_LOG_RETENTION_DAYS, type UsageLog, type UsageRecord } from "../ports/usage_log.js";
import type { SqliteDatabase } from "../sqlite.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createUsageLog(db: SqliteDatabase, options: { now?: () => number } = {}): UsageLog {
  const now = options.now ?? Date.now;
  let lastCleanupAt = Number.NEGATIVE_INFINITY;

  function removeExpired(): number {
    const current = now();
    const cutoff = new Date(current - USAGE_LOG_RETENTION_DAYS * DAY_MS).toISOString();
    const removed = Number(db.prepare("DELETE FROM usage_log WHERE at < ?").run(cutoff).changes);
    lastCleanupAt = current;
    return removed;
  }

  async function log(r: UsageRecord): Promise<void> {
    if (now() - lastCleanupAt >= DAY_MS) removeExpired();
    db.prepare(
      `INSERT INTO usage_log
             (at, caller, tool, title, outcome, error,
              row_count, has_more, duration_ms, term_count, query_fingerprint,
              derived_formulas, unmatched_terms,
              analysis_id, view_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date(now()).toISOString(),
      r.caller,
      r.tool,
      r.title ?? null,
      r.outcome,
      r.error ?? null,
      r.row_count ?? null,
      r.has_more === undefined ? null : r.has_more ? 1 : 0,
      Math.round(r.duration_ms),
      r.term_count ?? null,
      r.query_fingerprint ?? null,
      r.derived_formulas?.length ? JSON.stringify(r.derived_formulas) : null,
      r.unmatched_terms === undefined ? null : JSON.stringify(r.unmatched_terms),
      r.analysis_id ?? null,
      r.view_id ?? null,
    );
  }

  removeExpired();
  return { log, removeExpired };
}
