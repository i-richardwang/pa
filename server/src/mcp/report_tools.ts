import { z } from "zod";
import { MCP_REPORT_UPDATE_ACTION, type ReportUpdateAction } from "../contracts/report_action.js";
import type { McpRegistrationContext } from "./context.js";
import {
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  WRITE_ANNOTATIONS,
} from "./contracts.js";

export function registerReportTools(context: McpRegistrationContext): void {
  const { server, dependencies, principal, caller } = context;
  const { runtime } = dependencies;

  server.registerTool(
    "save_report",
    {
      title: "保存报告",
      description: TOOL_DESCRIPTIONS.save_report,
      inputSchema: {
        analysis_id: z.string().uuid(),
        name: z.string().min(1).max(100),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        revision: z.number().int().positive(),
        updated_at: z.string(),
      },
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    dependencies.usage.wrap({ tool: "save_report", caller }, async (input) => {
      const report = await runtime.report.save({
        principal,
        analysisId: input.analysis_id,
        name: input.name,
      });
      const payload = {
        id: report.id,
        name: report.name,
        revision: report.revision,
        updated_at: report.updated_at,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }),
  );

  server.registerTool(
    "update_report",
    {
      title: "更新报告",
      description: TOOL_DESCRIPTIONS.update_report,
      inputSchema: {
        id: z.string().uuid(),
        action: MCP_REPORT_UPDATE_ACTION,
        if_revision: z.number().int().positive().optional(),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        revision: z.number().int(),
        updated_at: z.string(),
      },
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    dependencies.usage.wrap(
      { tool: "update_report", caller },
      async (input: { id: string; action: ReportUpdateAction; if_revision?: number }) => {
        const report = await runtime.report.update(
          principal,
          input.id,
          input.action,
          input.if_revision,
        );
        const payload = {
          id: report.id,
          name: report.name,
          revision: report.revision,
          updated_at: report.updated_at,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      },
    ),
  );

  server.registerTool(
    "find_report",
    {
      title: "查找报告",
      description: TOOL_DESCRIPTIONS.find_report,
      inputSchema: { query: z.string().max(100).optional() },
      outputSchema: {
        reports: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            analysis_id: z.string().uuid(),
            result_view_id: z.string(),
            presentation_type: z.enum(["table", "kpi", "line", "bar", "pie"]),
            revision: z.number().int(),
            updated_at: z.string(),
            url: z.string(),
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    dependencies.usage.wrap({ tool: "find_report", caller }, async (input: { query?: string }) => {
      const reports = (await runtime.report.listOwned(caller, input.query)).map((report) => ({
        ...runtime.report.summary(report),
        url: `${dependencies.baseUrl}/dashboard#/report/${report.id}`,
      }));
      const payload = { reports };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }),
  );
}
