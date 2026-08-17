import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnalysisService } from "../application/analysis_service.js";
import type { CatalogService } from "../application/catalog_service.js";
import type { FeedbackService } from "../application/feedback_service.js";
import type { ApplicationRuntime } from "../application/runtime.js";
import type { UsageService } from "../application/usage_service.js";
import type { Principal } from "../engine/cube_security.js";

export type McpServerDependencies = {
  runtime: ApplicationRuntime;
  catalog: CatalogService;
  feedback: FeedbackService;
  usage: UsageService;
  baseUrl: string;
};

export type McpRegistrationContext = {
  server: McpServer;
  dependencies: McpServerDependencies;
  principal: Principal;
  caller: string;
  analysis: Pick<AnalysisService, "run" | "rerun" | "replay" | "ensureOwned">;
};
