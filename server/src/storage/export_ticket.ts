/**
 * 导出短票据：只持久化已授权查询与时效，不存 CSV/名单。随机 id 是可转授的 bearer capability，
 * 供 MCP Apps 下载桥与无 UI 的 Agent 共用；URL 只携带随机票据，查询内容保存在服务端。
 */
import { randomBytes } from "node:crypto";
import { isCubeSecurityContext, type CubeSecurityContext } from "../ports/cube_gateway.js";
import type {
  ExportTicketClaims,
  ExportTicketRepository,
} from "../ports/export_ticket_repository.js";
import { parseMetricQueryPlan, type MetricQueryPlan } from "../engine/metric_planner.js";
import type { SqliteDatabase } from "../sqlite.js";

const EXPORT_TICKET_TTL_MS = 24 * 60 * 60 * 1000;
const TICKET_PATTERN = /^e_[A-Za-z0-9_-]{32}$/;

export type { ExportTicketClaims } from "../ports/export_ticket_repository.js";

type TicketRow = {
  query: string;
  caller: string;
  security_context: string | null;
  expires_at: string;
};

export function createExportTicketStore(
  db: SqliteDatabase,
  opts: { ttlMs?: number; now?: () => number } = {},
): ExportTicketRepository<MetricQueryPlan> {
  const ttlMs = opts.ttlMs ?? EXPORT_TICKET_TTL_MS;
  const now = opts.now ?? Date.now;

  return {
    async create(
      plan: MetricQueryPlan,
      caller: string,
      securityContext: CubeSecurityContext,
    ): Promise<{ id: string; expires_at: string }> {
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const id = `e_${randomBytes(24).toString("base64url")}`;
      db.prepare("DELETE FROM export_ticket WHERE expires_at <= ?").run(createdAt);
      db.prepare(
        "INSERT INTO export_ticket " +
          "(id, created_at, expires_at, caller, query, security_context) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        createdAt,
        expiresAt,
        caller,
        JSON.stringify(plan),
        JSON.stringify(securityContext),
      );
      return { id, expires_at: expiresAt };
    },

    async resolve(id: string): Promise<ExportTicketClaims<MetricQueryPlan> | null> {
      if (!TICKET_PATTERN.test(id)) return null;
      const row = db
        .prepare(
          "SELECT query, caller, security_context, expires_at " +
            "FROM export_ticket WHERE id = ? LIMIT 1",
        )
        .all(id)[0] as TicketRow | undefined;
      if (!row || Date.parse(row.expires_at) <= now()) return null;
      try {
        const securityContext = JSON.parse(row.security_context ?? "null") as unknown;
        if (!isCubeSecurityContext(securityContext)) return null;
        return {
          plan: parseMetricQueryPlan(JSON.parse(row.query)),
          caller: row.caller,
          securityContext,
          exp: Date.parse(row.expires_at),
        };
      } catch {
        return null;
      }
    },
  };
}
