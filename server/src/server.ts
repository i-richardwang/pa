import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "./application/analysis_service.js";
import type { CatalogService } from "./application/catalog_service.js";
import type { ExportService } from "./application/export_service.js";
import type { FeedbackService } from "./application/feedback_service.js";
import type { PresentationService } from "./application/presentation_service.js";
import type { RecordProjectionService } from "./application/record_projection_service.js";
import type { ReportService } from "./application/report_service.js";
import type { UsageService } from "./application/usage_service.js";
import type { Principal } from "./contracts/principal.js";
import { registerAnalysisTools } from "./mcp/analysis_tools.js";
import { registerCatalogTools } from "./mcp/catalog_tools.js";
import { SERVER_INSTRUCTIONS } from "./mcp/contracts.js";
import type { McpRegistrationContext } from "./mcp/context.js";
import { registerExportTools } from "./mcp/export_tools.js";
import { registerFeedbackTool } from "./mcp/feedback_tool.js";
import { registerReportTools } from "./mcp/report_tools.js";
import { registerRecordTools } from "./mcp/record_tools.js";
import { registerWidgetResource } from "./mcp/widget_resource.js";
import { PRODUCT_NAME, PRODUCT_VERSION } from "./contracts/product_metadata.js";
import type { Logger } from "./ports/logger.js";

export type McpServerDependencies = {
  logger: Logger;
  analysis: Pick<AnalysisService, "run" | "rerun" | "replay" | "ensureOwned">;
  presentation: Pick<PresentationService, "compile" | "runtimeFallbacks">;
  catalog: Pick<CatalogService, "query" | "dimensionValues">;
  records: Pick<RecordProjectionService, "runAnalysis">;
  reports: Pick<ReportService, "save" | "update" | "listOwned" | "summary">;
  exports: Pick<ExportService, "exportResult" | "readResource">;
  feedback: Pick<FeedbackService, "submit">;
  usage: Pick<UsageService, "wrap">;
  baseUrl: string;
};

export function buildServer(opts: {
  dependencies: McpServerDependencies;
  principal: Principal;
}): McpServer {
  const principal = opts.principal;
  const server = new McpServer(
    {
      name: PRODUCT_NAME,
      title: "PA — People Analytics Service",
      version: PRODUCT_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const context: McpRegistrationContext = {
    server,
    principal,
    logger: opts.dependencies.logger,
  };
  registerCatalogTools({
    ...context,
    catalog: opts.dependencies.catalog,
    usage: opts.dependencies.usage,
  });
  registerAnalysisTools({
    ...context,
    analysis: opts.dependencies.analysis,
    presentation: opts.dependencies.presentation,
    usage: opts.dependencies.usage,
  });
  registerRecordTools({
    ...context,
    records: opts.dependencies.records,
    usage: opts.dependencies.usage,
  });
  registerReportTools({
    ...context,
    reports: opts.dependencies.reports,
    usage: opts.dependencies.usage,
    baseUrl: opts.dependencies.baseUrl,
  });
  registerFeedbackTool({
    ...context,
    feedback: opts.dependencies.feedback,
    usage: opts.dependencies.usage,
  });
  registerExportTools({ ...context, exports: opts.dependencies.exports });
  registerWidgetResource(context);
  return server;
}
