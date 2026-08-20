import type { SqliteDatabase } from "../sqlite.js";
import type {
  RecordProjectionAudit,
  RecordProjectionAuditEvent,
} from "../ports/record_projection_audit.js";

export function createRecordProjectionAudit(db: SqliteDatabase): RecordProjectionAudit {
  async function log(event: RecordProjectionAuditEvent): Promise<void> {
    db.prepare(
      `INSERT INTO record_projection_audit
         (at, caller, source_kind, source_id, source_reference_id, source_revision,
          metric_id, coordinates, offset, row_count, outcome, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(),
      event.caller,
      event.source.kind,
      event.source.id,
      event.source.kind === "board" ? event.source.reference_id : null,
      event.source.revision,
      event.metric_id,
      JSON.stringify(event.coordinates),
      event.offset ?? 0,
      event.row_count ?? null,
      event.outcome,
      event.error ?? null,
    );
  }

  return { log };
}
