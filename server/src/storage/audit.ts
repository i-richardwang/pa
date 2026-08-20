/**
 * export 审计：链接创建、下载与失败三类事件落应用库。
 * 独立于 auth.db——审计在未启用 OAuth 的部署形态下同样生效。
 */
import type { SqliteDatabase } from "../sqlite.js";
import type { ExportAudit, ExportAuditEvent } from "../ports/export_audit.js";

export function createExportAudit(db: SqliteDatabase): ExportAudit {
  async function log(event: ExportAuditEvent): Promise<void> {
    db.prepare(
      "INSERT INTO export_audit (at, event, caller, query, row_count) VALUES (?, ?, ?, ?, ?)",
    ).run(
      new Date().toISOString(),
      event.event,
      event.caller,
      JSON.stringify(event.query),
      event.row_count ?? null,
    );
  }

  return { log };
}
