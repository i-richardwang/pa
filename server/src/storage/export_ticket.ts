import { randomBytes } from "node:crypto";
import type {
  ExportTicketClaims,
  ExportTicketRepository,
} from "../ports/export_ticket_repository.js";
import { EXPORT_PLAN_SCHEMA, type ExportPlan } from "../engine/export.js";
import type { SqliteDatabase } from "../sqlite.js";
import { EXPORT_TICKET_TTL_MS } from "../contracts/export_contract.js";

const TICKET_PATTERN = /^e_[A-Za-z0-9_-]{32}$/;

type TicketRow = {
  query: string;
  caller: string;
  expires_at: string;
};

export function createExportTicketStore(
  db: SqliteDatabase,
  opts: { ttlMs?: number; now?: () => number } = {},
): ExportTicketRepository<ExportPlan> {
  const ttlMs = opts.ttlMs ?? EXPORT_TICKET_TTL_MS;
  const now = opts.now ?? Date.now;

  return {
    async create(plan: ExportPlan, caller: string): Promise<{ id: string; expires_at: string }> {
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const id = `e_${randomBytes(24).toString("base64url")}`;
      db.prepare("DELETE FROM export_ticket WHERE expires_at <= ?").run(createdAt);
      db.prepare(
        "INSERT INTO export_ticket " +
          "(id, created_at, expires_at, caller, query) " +
          "VALUES (?, ?, ?, ?, ?)",
      ).run(id, createdAt, expiresAt, caller, JSON.stringify(plan));
      return { id, expires_at: expiresAt };
    },

    async resolve(id: string): Promise<ExportTicketClaims<ExportPlan> | null> {
      if (!TICKET_PATTERN.test(id)) return null;
      const row = db
        .prepare("SELECT query, caller, expires_at " + "FROM export_ticket WHERE id = ? LIMIT 1")
        .all(id)[0] as TicketRow | undefined;
      if (!row || Date.parse(row.expires_at) <= now()) return null;
      try {
        return {
          plan: EXPORT_PLAN_SCHEMA.parse(JSON.parse(row.query)),
          caller: row.caller,
        };
      } catch {
        return null;
      }
    },
  };
}
