import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestAppDatabase } from "./app_database.js";
import { CatalogInputError } from "../application/catalog_service.js";
import { dashboardRoutes } from "../dashboard/index.js";
import { createFeedbackStore } from "../storage/feedback.js";
import type { AnalysisSpec, ExprNode } from "../semantic_core/analysis_spec.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import type { ViewPreferences } from "../presentation_core/view_preferences.js";
import { bindSemanticFilter } from "../semantic_core/query_intent.js";
import {
  isSemanticDerivedView,
  type SemanticColumnOperand,
  type SemanticExprNode,
  type SemanticLiteralOperand,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import { createBoardRepository } from "../storage/board_repository.js";
import { createReportRepository as createReports } from "../storage/report_repository.js";
import { createUsageLog } from "../storage/usage_log.js";
import { createUsageStats } from "../storage/usage_stats.js";
import { createUsageService } from "../application/usage_service.js";
import type { SqliteDatabase } from "../sqlite.js";
import { compileTimeIntent } from "../semantic_core/time_contract.js";
import type { Principal } from "../contracts/principal.js";
import type { DashboardDependencies } from "../dashboard/types.js";
import { createPresentationService } from "../application/presentation_service.js";
import type { AuthorizedSemanticContext } from "../application/catalog_service.js";
import type { AuthorizedAnalysisPlan } from "../application/semantic_planning_service.js";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import type { ExecutionPlan } from "../semantic_core/execution_plan.js";

export {
  CatalogInputError,
  createBoardRepository,
  createFeedbackStore,
  createReports,
  createUsageLog,
  createUsageStats,
  dashboardRoutes,
};

export function createTestUsage(db: SqliteDatabase) {
  return createUsageService({ log: createUsageLog(db), statistics: createUsageStats(db) });
}

let sequence = 0;
const runId = randomUUID();

export function freshPath(): string {
  sequence += 1;
  return join(tmpdir(), `pa_dashboard_test_${runId}_${sequence}.db`);
}

export { createTestAppDatabase };

export const STRUCTURE_ARGS: AnalysisSpec = {
  title: "全公司各职级人员结构",
  views: [
    {
      id: "structure",
      view_title: "职级人员结构数据",
      measures: ["measure:active_employee_count"],
      dimensions: ["dimension:category_level"],
      time: { cutoff: "2026-07" },
    },
  ],
};

export async function seedUsage(path: string): Promise<void> {
  const db = createTestAppDatabase(path);
  const usage = createUsageLog(db);
  await usage.log({
    caller: "alice",
    tool: "run_analysis",
    title: "全公司各职级人员结构",
    query_fingerprint: "q-1111111111",
    outcome: "ok",
    row_count: 7,
    has_more: false,
    duration_ms: 100,
  });
  await usage.log({
    caller: "alice",
    tool: "run_analysis",
    title: "研发部在职人数",
    outcome: "ok",
    row_count: 42,
    duration_ms: 100,
  });
  await usage.log({
    caller: "alice",
    tool: "rerun_analysis",
    title: "全公司各职级人员结构",
    outcome: "ok",
    row_count: 7,
    duration_ms: 40,
  });
  await usage.log({
    caller: "bob",
    tool: "catalog",
    term_count: 2,
    outcome: "ok",
    row_count: 1,
    unmatched_terms: ["加班时长"],
    duration_ms: 10,
  });
  await usage.log({
    caller: "bob",
    tool: "catalog",
    term_count: 1,
    outcome: "ok",
    row_count: 4,
    unmatched_terms: [],
    duration_ms: 10,
  });
  await usage.log({
    caller: "bob",
    tool: "run_analysis",
    outcome: "error",
    error: "Cube 'x' not found",
    duration_ms: 20,
  });
  db.close();
}

export type StubUser = {
  email: string;
  name: string;
  role?: string | null;
  org_scope?: string | null;
};

export const scopeWrites: { userId: string; orgScope: string }[] = [];

export function semanticAccessStub(principal: Principal): AuthorizedSemanticContext {
  return {
    principal,
    cubeContext: cubeSecurityContext(principal),
    views: [],
    compiler: {
      default_population_scope: "测试口径",
      views: [],
      metric_domains: [],
      measures: [],
      dimensions: [],
    },
    timeContext: { dataAsOf: "2026-07", sources: {} },
  };
}

/** 测试里的执行服务也只接收正式的已授权规划工件。 */
export function authorizeTestAnalysisPlan(input: {
  principal: Principal;
  plan: ExecutionPlan;
  presentation: PresentationSpec;
  views: CubeView[];
  timeContext: TimeContext;
}): AuthorizedAnalysisPlan {
  const cubeContext = cubeSecurityContext(input.principal);
  return {
    plan: input.plan,
    presentation: input.presentation,
    render_decl: input.presentation,
    routes: [],
    record_projection_bindings: { views: [] },
    access: {
      ...semanticAccessStub(input.principal),
      cubeContext,
      views: input.views,
      timeContext: input.timeContext,
    },
  };
}

const testExpressionOperand = (
  node: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand,
): ExprNode | { col: string; source: string } | SemanticLiteralOperand => {
  if ("lit" in node) return node;
  if ("member" in node) return { source: node.source, col: memberShortName(node.member) };
  return {
    op: node.op,
    left: testExpressionOperand(node.left),
    right: testExpressionOperand(node.right),
  };
};

const testExpression = (node: SemanticExprNode): ExprNode => ({
  op: node.op,
  left: testExpressionOperand(node.left),
  right: testExpressionOperand(node.right),
});

export const semanticPlanningStub = {
  plan: async (
    principal: Principal,
    semantic: AnalysisDefinition,
    declared: SemanticViewIntent,
    preferences: ViewPreferences = {},
  ) => {
    const analysis: AnalysisSpec = {
      ...(semantic.title ? { title: semantic.title } : {}),
      views: semantic.views.map((view) => {
        if (!isSemanticDerivedView(view)) {
          const { filters, group_sort: groupSort, time, ...query } = view;
          return {
            ...query,
            ...(filters
              ? { filters: filters.map((filter) => bindSemanticFilter(filter, filter.member)) }
              : {}),
            time: compileTimeIntent(time),
            ...(groupSort?.max_items
              ? {
                  selection: {
                    type: "top_n" as const,
                    dimensions: [groupSort.dimension],
                    by: groupSort.by === "name" ? groupSort.dimension : groupSort.by,
                    window: "anchor" as const,
                    count: groupSort.max_items,
                    direction: groupSort.direction,
                  },
                }
              : groupSort
                ? {
                    order: [
                      {
                        member: groupSort.by === "name" ? groupSort.dimension : groupSort.by,
                        direction: groupSort.direction,
                      },
                    ],
                  }
                : {}),
          };
        }
        const { join: semanticJoin, ...derived } = view;
        return {
          ...derived,
          ...(semanticJoin
            ? {
                join: {
                  ...semanticJoin,
                  on: semanticJoin.on.map((member) => ({
                    left: memberShortName(member),
                    right: memberShortName(member),
                  })),
                },
              }
            : {}),
          columns: view.columns.map((column) =>
            "member" in column
              ? { source: column.source, col: memberShortName(column.member), as: column.as }
              : {
                  expr: testExpression(column.expr),
                  as: column.as,
                  ...(column.format ? { format: column.format } : {}),
                },
          ),
        };
      }),
    };
    const presentation: PresentationSpec =
      declared.type === "table" || declared.type === "kpi"
        ? {
            type: declared.type,
            y: [],
            tableLayout: { rows: [], columns: [] },
            ...(declared.type === "table" && preferences.table_shading
              ? { shading: preferences.table_shading }
              : {}),
          }
        : {
            type: declared.type,
            tableLayout: { rows: [], columns: [] },
            ...(declared.category ? { x: declared.category } : {}),
            y: declared.series ?? [],
            ...(declared.annotations ? { annotations: declared.annotations } : {}),
            ...(declared.group_by ? { groupBy: declared.group_by } : {}),
            ...(declared.stack !== undefined ? { stack: declared.stack } : {}),
            ...(preferences.series
              ? {
                  display: Object.fromEntries(
                    Object.entries(preferences.series).map(([member, style]) => [
                      member,
                      {
                        ...(style.color ? { color: style.color } : {}),
                        ...(style.mark ? { type: style.mark } : {}),
                        ...(style.axis ? { yAxis: style.axis } : {}),
                      },
                    ]),
                  ),
                }
              : {}),
            ...(preferences.value_labels ? { valueLabels: preferences.value_labels } : {}),
          };
    const plan = planExecution(analysis);
    return {
      plan,
      presentation,
      render_decl: presentation,
      routes: [],
      record_projection_bindings: { views: [] },
      access: {
        ...semanticAccessStub(principal),
      },
    };
  },
};

function unavailableService<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get() {
      return () => {
        throw new Error(`测试未提供 ${label} 服务`);
      };
    },
  });
}

export function dashboardTestDependencies(
  user: StubUser | null,
  dbPath = freshPath(),
  overrides: Partial<DashboardDependencies> = {},
): DashboardDependencies {
  const db = createTestAppDatabase(dbPath);
  const sessionUser = user ? { role: "user", org_scope: "*", ...user } : null;
  return {
    auth: { api: { getSession: async () => (sessionUser ? { user: sessionUser } : null) } },
    usage: createTestUsage(db),
    html: async () => "<!doctype html><title>console</title>",
    setOrgScope: async (userId, orgScope) => {
      scopeWrites.push({ userId, orgScope });
    },
    analyses: unavailableService("analysis"),
    reportService: unavailableService("report"),
    presentation: createPresentationService(),
    boardService: unavailableService("board"),
    feedback: unavailableService("feedback"),
    catalog: unavailableService("catalog"),
    businessTerms: unavailableService("business term"),
    records: unavailableService("record projection"),
    capabilityMap: { facts: [], dimension_groups: [], metric_domains: [] },
    ...overrides,
  };
}

export function buildDashboardApp(user: StubUser | null, dbPath = freshPath()) {
  return dashboardRoutes(dashboardTestDependencies(user, dbPath));
}
