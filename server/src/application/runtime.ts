import { randomUUID } from "node:crypto";
import type { UsageLog } from "../ports/usage_log.js";
import type { ExportAudit } from "../ports/export_audit.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import type { ExportRuntime } from "../engine/export.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import { createReportRepository } from "../storage/report_repository.js";
import { createBoardRepository } from "../storage/board_repository.js";
import { createAnalysisService } from "./analysis_service.js";
import { createExportService } from "./export_service.js";
import { createPresentationService } from "./presentation_service.js";
import { createQueryExecutionService } from "./query_execution_service.js";
import { createReportService } from "./report_service.js";
import { createBoardService } from "./board_service.js";
import { createSemanticPlanningService } from "./semantic_planning_service.js";
import type { CatalogService } from "./catalog_service.js";
import { createRecordProjectionAudit } from "../storage/record_projection_audit.js";
import { createRecordProjectionService } from "./record_projection_service.js";
import type { SqliteDatabase } from "../sqlite.js";

export function createApplicationRuntime(input: {
  db: SqliteDatabase;
  usage: Pick<UsageLog, "log">;
  cube: CubeGateway;
  exports: ExportRuntime;
  exportAudit: ExportAudit;
  catalog: CatalogService;
}) {
  const analyses = createAnalysisRepository(input.db);
  const reports = createReportRepository(input.db);
  const boards = createBoardRepository(input.db, reports);
  const presentation = createPresentationService();
  const semanticPlanning = createSemanticPlanningService({ catalog: input.catalog });
  const recordProjectionAudit = createRecordProjectionAudit(input.db);
  const queryExecution = createQueryExecutionService({
    cube: input.cube,
    exports: input.exports,
    audit: input.exportAudit.log,
  });
  const analysis = createAnalysisService({
    repository: analyses,
    execute: queryExecution.execute,
    compile: semanticPlanning.compile,
    usage: input.usage,
  });
  const report = createReportService({
    reports,
    analyses,
    execution: analysis,
    presentation,
    semanticPlanning,
    usage: input.usage,
  });
  const board = createBoardService({
    boards,
    reports: report,
    usage: input.usage,
    newId: randomUUID,
  });
  const recordProjection = createRecordProjectionService({
    reports,
    boards,
    analyses,
    semanticPlanning,
    catalog: input.catalog,
    cube: input.cube,
    audit: recordProjectionAudit,
  });
  const exportResult = createExportService({
    analyses,
    semanticPlanning,
    usage: input.usage,
    cube: input.cube,
    exports: input.exports,
    audit: input.exportAudit.log,
  });
  return {
    analyses,
    presentation,
    semanticPlanning,
    queryExecution,
    analysis,
    report,
    board,
    recordProjection,
    exportResult,
    exports: input.exports,
  };
}

export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>;
