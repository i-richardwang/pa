import { randomUUID } from "node:crypto";
import { createAnalysisService } from "../application/analysis_service.js";
import { createBoardService } from "../application/board_service.js";
import { createCatalogService } from "../application/catalog_service.js";
import { createBusinessTermService } from "../application/business_term_service.js";
import { createBusinessTermRegistry } from "../application/business_term_registry.js";
import { createFeedbackService } from "../application/feedback_service.js";
import { createUsageService } from "../application/usage_service.js";
import { createExportService } from "../application/export_service.js";
import { createPresentationService } from "../application/presentation_service.js";
import { createQueryExecutionService } from "../application/query_execution_service.js";
import { createRecordProjectionService } from "../application/record_projection_service.js";
import { createReportService } from "../application/report_service.js";
import { createSemanticPlanningService } from "../application/semantic_planning_service.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import type { Logger } from "../ports/logger.js";
import { materializeResultCsv } from "../application/result_csv.js";
import { runExport } from "../engine/export.js";
import type { SqliteDatabase } from "../sqlite.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import { createExportAudit } from "../storage/audit.js";
import { createBoardRepository } from "../storage/board_repository.js";
import { createExportTicketStore } from "../storage/export_ticket.js";
import { createRecordProjectionAudit } from "../storage/record_projection_audit.js";
import { createReportRepository } from "../storage/report_repository.js";
import { createBusinessTermRepository } from "../storage/business_term_repository.js";
import { createFeedbackStore } from "../storage/feedback.js";
import { createUsageLog } from "../storage/usage_log.js";
import { createUsageStats } from "../storage/usage_stats.js";
import type { CanonicalSemanticModel } from "../engine/canonical_semantic_model.js";
import { projectDataCapabilityMap } from "../presentation_core/data_capability_map.js";

export function createApplication(input: {
  db: SqliteDatabase;
  cube: CubeGateway;
  visibilityCube: CubeGateway;
  canonical: CanonicalSemanticModel;
  baseUrl: string;
  logger: Logger;
}) {
  const usage = createUsageService({
    log: createUsageLog(input.db),
    statistics: createUsageStats(input.db),
    logger: input.logger,
  });
  const businessTermRegistry = createBusinessTermRegistry({
    repository: createBusinessTermRepository(input.db),
  });
  const catalog = createCatalogService({
    logger: input.logger,
    cube: input.visibilityCube,
    canonical: input.canonical,
    businessTerms: businessTermRegistry,
  });
  const businessTerms = createBusinessTermService({
    registry: businessTermRegistry,
    catalog,
    usage,
  });
  const feedback = createFeedbackService({
    repository: createFeedbackStore(input.db),
    usage,
  });
  const analyses = createAnalysisRepository(input.db);
  const reports = createReportRepository(input.db);
  const boards = createBoardRepository(input.db);
  const presentation = createPresentationService();
  const semanticPlanning = createSemanticPlanningService({ catalog });
  const queryExecution = createQueryExecutionService({ cube: input.cube });
  const exportService = createExportService({
    analyses,
    semanticPlanning,
    usage,
    cube: input.cube,
    tickets: createExportTicketStore(input.db),
    baseUrl: input.baseUrl,
    audit: createExportAudit(input.db).log,
    runExport: (plan, securityContext) => runExport(input.cube, plan, securityContext),
    runReplayExport: async (viewId, principal) => {
      const identity = await analyses.resolveOwnedView(viewId, principal.email);
      const planned = await semanticPlanning.plan(
        principal,
        identity.analysis.definition,
        identity.view.intent,
        identity.view.preferences,
      );
      const result = await queryExecution.execute(planned);
      return materializeResultCsv(result.fullRowViewBlock, result.payload.data_as_of);
    },
  });
  const analysis = createAnalysisService({
    repository: analyses,
    execute: queryExecution.execute,
    plan: semanticPlanning.plan,
    usage,
    createDelivery: exportService.createDelivery,
  });
  const report = createReportService({
    reports,
    analyses,
    execution: analysis,
    presentation,
    semanticPlanning,
    usage,
  });
  const board = createBoardService({
    boards,
    reports: report,
    usage,
    newId: randomUUID,
  });
  const recordProjection = createRecordProjectionService({
    reports: report,
    boards: board,
    analyses: analysis,
    semanticPlanning,
    cube: input.cube,
    audit: createRecordProjectionAudit(input.db),
  });

  return {
    analysis,
    report,
    board,
    presentation,
    recordProjection,
    export: exportService,
    catalog,
    businessTerms,
    feedback,
    usage,
    capabilityMap: projectDataCapabilityMap(input.canonical.capabilities),
    maintenance: { removeExpiredAnalyses: analyses.removeExpired },
  };
}
