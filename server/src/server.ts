import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "./application/analysis_service.js";
import type { Principal } from "./engine/cube_security.js";
import { registerAnalysisTools } from "./mcp/analysis_tools.js";
import { registerCatalogTools } from "./mcp/catalog_tools.js";
import {
  SERVER_INSTRUCTIONS,
  UI_RESOURCE_META,
  UI_RESOURCE_URI,
  RECORDS_UI_RESOURCE_URI,
  OPENAI_WIDGET_CSP,
  TOOL_DESCRIPTIONS,
} from "./mcp/contracts.js";
import type { McpRegistrationContext, McpServerDependencies } from "./mcp/context.js";
import { registerExportTools } from "./mcp/export_tools.js";
import { registerFeedbackTool } from "./mcp/feedback_tool.js";
import { registerReportTools } from "./mcp/report_tools.js";
import { registerRecordTools } from "./mcp/record_tools.js";
import { registerWidgetResource } from "./mcp/widget_resource.js";
import { PRODUCT_NAME, PRODUCT_VERSION } from "./contracts/product_metadata.js";

export {
  OPENAI_WIDGET_CSP,
  SERVER_INSTRUCTIONS,
  TOOL_DESCRIPTIONS,
  UI_RESOURCE_META,
  UI_RESOURCE_URI,
  RECORDS_UI_RESOURCE_URI,
};
export type { McpServerDependencies };

const LOCAL_PRINCIPAL: Principal = {
  email: "local",
  roles: ["admin"],
  orgScope: "*",
};

export function buildServer(opts: {
  dependencies: McpServerDependencies;
  principal?: Principal;
  analysis?: Pick<AnalysisService, "run" | "rerun" | "replay" | "ensureOwned">;
}): McpServer {
  const principal = opts.principal ?? LOCAL_PRINCIPAL;
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
    dependencies: opts.dependencies,
    principal,
    caller: principal.email,
    analysis: opts.analysis ?? opts.dependencies.runtime.analysis,
  };

  registerCatalogTools(context);
  registerAnalysisTools(context);
  registerRecordTools(context);
  registerReportTools(context);
  registerFeedbackTool(context);
  registerExportTools(context);
  registerWidgetResource(context);
  return server;
}
