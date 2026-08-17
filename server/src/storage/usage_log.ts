/**
 * MCP 使用日志：每次工具调用落 app.db 的 usage_log 表，
 * 是产品改进用的旁路观察日志——title 保留分析问题原文，catalog 的完整
 * terms 在 args，逐项 unmatched_terms 是目录缺口信号；
 * 报错调用（目录外成员名）是另一类"未答问题"信号。周期报告见 scripts/usage_report.py。
 *
 * 与 export_audit 分工：export_audit 是文件外带的安全审计链（含 HTTP 下载事件），
 * 本表是使用面——只记查询条件与结果规模，不落结果行。
 * query_fingerprint 是查询规格的内容哈希，仅用于周期报告聚合重复查询候选。
 * 日志写入失败绝不影响查数应答：错误只打 stderr。
 */
import { queryFingerprint } from "../engine/query_fingerprint.js";
import type { UsageLog, UsageRecord } from "../ports/usage_log.js";
import type { SqliteDatabase } from "../sqlite.js";

export type { UsageLog, UsageRecord, UsageSummary } from "../ports/usage_log.js";

export const USAGE_LOG_RETENTION_DAYS = 366;
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

  /** 从落库 args（JSON 串或对象）计算分析指纹；解析或归一失败返回 undefined。 */
  function fingerprintOf(args: unknown): string | undefined {
    try {
      return queryFingerprint((args as { spec: unknown }).spec);
    } catch {
      return undefined;
    }
  }

  async function log(r: UsageRecord): Promise<void> {
    try {
      if (now() - lastCleanupAt >= DAY_MS) removeExpired();
      // 指纹只挂成功的 run_analysis 行；其他工具不参与重复分析统计。
      const fingerprint =
        r.tool === "run_analysis" && r.outcome === "ok" ? fingerprintOf(r.args) : undefined;
      db.prepare(
        `INSERT INTO usage_log
             (at, caller, tool, title, args, outcome, error,
              row_count, has_more, duration_ms, query_fingerprint, unmatched_terms,
              analysis_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        new Date(now()).toISOString(),
        r.caller,
        r.tool,
        r.title ?? null,
        JSON.stringify(r.args),
        r.outcome,
        r.error ?? null,
        r.row_count ?? null,
        r.has_more === undefined ? null : r.has_more ? 1 : 0,
        Math.round(r.duration_ms),
        fingerprint ?? null,
        r.unmatched_terms === undefined ? null : JSON.stringify(r.unmatched_terms),
        r.analysis_id ?? null,
      );
    } catch (e) {
      console.error("[pa] usage log 写入失败（不影响应答）:", e);
    }
  }

  removeExpired();
  return { log, removeExpired };
}
