export type RecordProjectionAuditSource =
  | { kind: "analysis"; id: string; revision: 1 }
  | { kind: "report"; id: string; revision: number }
  | { kind: "board"; id: string; revision: number; reference_id: string };

export type RecordProjectionAuditEvent = {
  caller: string;
  source: RecordProjectionAuditSource;
  metric_id: string;
  coordinates: unknown;
  offset?: number;
  row_count?: number;
  outcome: "ok" | "error";
  error?: string;
};

export type RecordProjectionAudit = {
  log(event: RecordProjectionAuditEvent): Promise<void>;
};
