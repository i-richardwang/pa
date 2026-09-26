// 导出审计写应用库而非 auth.db，未启用 OAuth 的部署也会记录。
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
