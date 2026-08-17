import type { AnalysisService } from "../application/analysis_service.js";
import type { CatalogService } from "../application/catalog_service.js";
import type { RecordProjectionService } from "../application/record_projection_service.js";
import type { PresentationService } from "../application/presentation_service.js";
import type { ReportService } from "../application/report_service.js";
import type { BoardService } from "../application/board_service.js";
import type { SemanticPlanningService } from "../application/semantic_planning_service.js";
import type { BusinessTermService } from "../application/business_term_service.js";
import type { FeedbackService } from "../application/feedback_service.js";
import type { UsageService } from "../application/usage_service.js";
import type { Principal } from "../engine/cube_security.js";
import type { MePayload } from "../contracts/dashboard_contract.js";
import type { DataCapabilityMapData } from "../presentation_core/data_capability_map.js";

export type SessionUser = {
  email: string;
  name: string;
  role?: string | null;
  org_scope?: string | null;
};

export type SessionProvider = {
  api: {
    getSession(opts: { headers: Headers }): Promise<{ user: SessionUser } | null>;
  };
};

export type DashboardEnv = {
  Variables: { me: MePayload; principal: Principal };
};

export type DashboardDependencies = {
  auth: SessionProvider;
  usage: UsageService;
  html: () => Promise<string>;
  setOrgScope?: (userId: string, orgScope: string) => Promise<void>;
  analyses?: AnalysisService;
  reportService?: ReportService;
  presentation?: PresentationService;
  boardService?: BoardService;
  feedback?: FeedbackService;
  catalog?: CatalogService;
  businessTerms?: BusinessTermService;
  semanticPlanning?: SemanticPlanningService;
  records?: RecordProjectionService;
  capabilityMap?: DataCapabilityMapData;
};
