export type ExportAuditEvent = {
  event: "export_created" | "export_downloaded" | "export_failed";
  caller: string;
  query: unknown;
  row_count?: number;
};

export type ExportAudit = {
  log(event: ExportAuditEvent): Promise<void>;
};
