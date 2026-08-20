/**
 * MCP 使用日志：每次工具调用落 app.db 的 usage_log 表，
 * 是产品改进用的旁路观察日志——title 保留分析问题原文，catalog 只记录
 * 概念数量与逐项 unmatched_terms；
 * 报错调用（目录外成员名）是另一类"未答问题"信号。周期报告见 scripts/usage_report.py。
 *
 * 与 export_audit 分工：export_audit 是文件外带的安全审计链（含 HTTP 下载事件），
 * 本表只记最小观察元数据与结果规模，不落原始入参或结果行。
 * query_fingerprint 是查询规格的内容哈希，仅用于周期报告聚合重复查询候选。
 */
import { USAGE_LOG_RETENTION_DAYS, type UsageLog, type UsageRecord } from "../ports/usage_log.js";
import type { SqliteDatabase } from "../sqlite.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 工厂注入应用库连接：连接生命周期由 composition root 统一管理。 */
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
