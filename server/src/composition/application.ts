import { randomUUID } from "node:crypto";
import { createAnalysisService } from "../application/analysis_service.js";
import { createBoardService } from "../application/board_service.js";
import type { CatalogService } from "../application/catalog_service.js";
import { createExportService } from "../application/export_service.js";
import { createPresentationService } from "../application/presentation_service.js";
import { createQueryExecutionService } from "../application/query_execution_service.js";
import { createRecordProjectionService } from "../application/record_projection_service.js";
import { createReportService } from "../application/report_service.js";
import { createSemanticPlanningService } from "../application/semantic_planning_service.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import { runExport } from "../engine/export.js";
import type { SqliteDatabase } from "../sqlite.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import { createExportAudit } from "../storage/audit.js";
import { createBoardRepository } from "../storage/board_repository.js";
import { createExportTicketStore } from "../storage/export_ticket.js";
import { createRecordProjectionAudit } from "../storage/record_projection_audit.js";
import { createReportRepository } from "../storage/report_repository.js";

export function createApplication(input: {
  db: SqliteDatabase;
  usage: Pick<UsageLog, "log">;
  cube: CubeGateway;
  catalog: CatalogService;
  baseUrl: string;
}) {
  const analyses = createAnalysisRepository(input.db);
  const reports = createReportRepository(input.db);
  const boards = createBoardRepository(input.db, reports);
  const presentation = createPresentationService();
  const semanticPlanning = createSemanticPlanningService({ catalog: input.catalog });
  const exportService = createExportService({
    analyses,
    semanticPlanning,
    usage: input.usage,
    cube: input.cube,
    tickets: createExportTicketStore(input.db),
    baseUrl: input.baseUrl,
    audit: createExportAudit(input.db).log,
    runExport: (plan, securityContext) => runExport(input.cube, plan, securityContext),
  });
  const queryExecution = createQueryExecutionService({
    cube: input.cube,
    exports: exportService,
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
    audit: createRecordProjectionAudit(input.db),
  });

  return {
    analysis,
    report,
    board,
    presentation,
    semanticPlanning,
    recordProjection,
    export: exportService,
    maintenance: { removeExpiredAnalyses: analyses.removeExpired },
  };
}
