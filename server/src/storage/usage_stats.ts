/** usage_log 的只读统计层，与写入器共享同一 app.db 连接。 */
import type { SqliteDatabase } from "../sqlite.js";
import { ANALYSIS_RETENTION_DAYS } from "../ports/analysis_repository.js";
import type { UsageStatistics } from "../ports/usage_statistics.js";
import type {
  ErrorRow,
  UnansweredPayload,
  UsageOverviewPayload,
  UsageTitlesPayload,
  ZeroHitRow,
} from "../contracts/usage_contract.js";
import type { MyAnalysesPayload } from "../contracts/analysis_contract.js";
import { USAGE_ERROR_GROUP_TEXT_LIMIT } from "../contracts/usage_contract.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createUsageStats(db: SqliteDatabase): UsageStatistics {
  function since(days: number): string {
    return new Date(Date.now() - days * DAY_MS).toISOString();
  }

  function count(conn: SqliteDatabase, where: string, params: unknown[]): number {
    return (
      conn.prepare(`SELECT COUNT(*) AS n FROM usage_log WHERE ${where}`).get(...params) as {
        n: number;
      }
    ).n;
  }

  async function overview(days: number): Promise<UsageOverviewPayload> {
    const cells = db
      .prepare(
        `SELECT tool, outcome, COUNT(*) AS n,
                SUM(COALESCE(has_more, 0)) AS truncated
         FROM usage_log WHERE at >= ? GROUP BY tool, outcome ORDER BY tool, outcome`,
      )
      .all(since(days)) as UsageOverviewPayload["cells"];
    const callers = db
      .prepare(
        `SELECT caller, COUNT(*) AS n, MAX(at) AS last_at
         FROM usage_log WHERE at >= ? GROUP BY caller ORDER BY n DESC`,
      )
      .all(since(days)) as UsageOverviewPayload["callers"];
    return { days, cells, callers };
  }

  /** 分析清单只计创建 Analysis/View 身份的执行；重放消费既有身份，不算新的业务提问。 */
  async function titles(days: number, limit: number, offset: number): Promise<UsageTitlesPayload> {
    const where = `at >= ? AND tool IN ('run_analysis', 'rerun_analysis') AND outcome = 'ok' AND title IS NOT NULL`;
    const rows = db
      .prepare(
        `SELECT id, at, caller, title, row_count
         FROM usage_log
         WHERE ${where}
         ORDER BY at DESC LIMIT ? OFFSET ?`,
      )
      .all(since(days), limit, offset) as Array<{
      id: number;
      at: string;
      caller: string;
      title: string;
      row_count: number | null;
    }>;
    return {
      days,
      total: count(db, where, [since(days)]),
      rows,
    };
  }

  /**
   * 本人分析记录：按 caller 精确匹配锁定到单个身份，只取成功且带 title 的分析执行（口径同 titles）。
   * caller 已由 Application 从 Principal 派生，故此处按等值过滤即纵向可见、不泄他人。
   */
  async function mine(
    caller: string,
    days: number,
    limit: number,
    offset: number,
  ): Promise<MyAnalysesPayload> {
    const where = `u.at >= ? AND u.caller = ? AND u.tool IN ('run_analysis', 'rerun_analysis') AND u.outcome = 'ok' AND u.title IS NOT NULL`;
    const rows = db
      .prepare(
        `SELECT u.id,
                CASE WHEN a.id IS NOT NULL THEN u.analysis_id ELSE NULL END AS analysis_id,
                CASE WHEN a.id IS NOT NULL THEN u.view_id ELSE NULL END AS view_id,
                u.at, u.title, u.row_count
         FROM usage_log AS u
         LEFT JOIN analysis_view AS v ON v.id = u.view_id
         LEFT JOIN analysis AS a
           ON a.id = v.analysis_id
          AND a.owner = u.caller
          AND (
            a.created_at >= ?
            OR EXISTS (SELECT 1 FROM report WHERE report.view_id = v.id)
            OR EXISTS (
              SELECT 1 FROM report_revision WHERE report_revision.view_id = v.id
            )
          )
         WHERE ${where}
         ORDER BY u.at DESC LIMIT ? OFFSET ?`,
      )
      .all(since(ANALYSIS_RETENTION_DAYS), since(days), caller, limit, offset) as Array<{
      id: number;
      analysis_id: string | null;
      view_id: string | null;
      at: string;
      title: string;
      row_count: number | null;
    }>;
    return {
      days,
      total: (
        db
          .prepare(`SELECT COUNT(*) AS n FROM usage_log AS u WHERE ${where}`)
          .get(since(days), caller) as {
          n: number;
        }
      ).n,
      rows,
    };
  }

  async function unanswered(days: number): Promise<UnansweredPayload> {
    const zeroHits = db
      .prepare(
        `SELECT CAST(j.value AS TEXT) AS term, COUNT(*) AS n, MAX(u.at) AS last_at
         FROM usage_log AS u, json_each(u.unmatched_terms) AS j
         WHERE u.at >= ? AND u.tool = 'catalog' AND u.unmatched_terms IS NOT NULL
         GROUP BY term ORDER BY n DESC, last_at DESC LIMIT 100`,
      )
      .all(since(days)) as ZeroHitRow[];
    const errors = db
      .prepare(
        `WITH scoped AS (
           SELECT id, at, tool, title, substr(error, 1, ${USAGE_ERROR_GROUP_TEXT_LIMIT}) AS error
           FROM usage_log WHERE at >= ? AND outcome = 'error'
         ), grouped AS (
           SELECT tool, error, COUNT(*) AS n, MAX(at) AS last_at
           FROM scoped GROUP BY tool, error
         )
         SELECT g.*,
                (SELECT s.title FROM scoped AS s
                 WHERE s.tool = g.tool AND s.error = g.error AND s.title IS NOT NULL
                 ORDER BY s.at DESC, s.id DESC LIMIT 1) AS example_title
         FROM grouped AS g ORDER BY n DESC, last_at DESC LIMIT 100`,
      )
      .all(since(days)) as ErrorRow[];
    return { days, zero_hits: zeroHits, errors };
  }

  return { overview, titles, mine, unanswered };
}
