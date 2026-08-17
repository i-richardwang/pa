import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EXPORT_RESOURCE_MIME_TYPE,
  EXPORT_RESOURCE_URI_TEMPLATE,
  ExportIncompleteError,
} from "../engine/export.js";
import type { McpRegistrationContext } from "./context.js";
import {
  EXPORT_OUTPUT,
  OAUTH_SECURITY_SCHEMES,
  TOOL_DESCRIPTIONS,
  WRITE_ANNOTATIONS,
} from "./contracts.js";

export function registerExportTools(context: McpRegistrationContext): void {
  const { server, dependencies, principal, caller } = context;
  const { runtime } = dependencies;

  server.registerTool(
    "export_result",
    {
      title: "导出分析结果",
      description: TOOL_DESCRIPTIONS.export_result,
      inputSchema: {
        analysis_id: z.string().uuid(),
      },
      outputSchema: EXPORT_OUTPUT,
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    async (input: { analysis_id: string }) => {
      const payload = await runtime.exportResult.exportResult(principal, input.analysis_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerResource(
    "export_csv",
    new ResourceTemplate(EXPORT_RESOURCE_URI_TEMPLATE, { list: undefined }),
    {
      title: "PA CSV 导出",
      description: "读取当前查询生成的限时 CSV 导出资源。",
      mimeType: EXPORT_RESOURCE_MIME_TYPE,
    },
    async (uri, variables) => {
      const rawTicket = variables.ticket;
      const ticket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
      const claims =
        typeof ticket === "string" ? await runtime.exports.resolveTicket(ticket) : null;
      if (!claims || claims.caller !== caller) {
        throw new Error("下载资源无效、已过期或不属于当前用户，请重新查询。");
      }
      try {
        const { csv } = await runtime.exports.materialize(claims);
        return {
          contents: [{ uri: uri.href, mimeType: EXPORT_RESOURCE_MIME_TYPE, text: csv }],
        };
      } catch (error) {
        if (error instanceof ExportIncompleteError) {
          throw new Error(`${error.message}；请增加过滤条件后重新导出。`);
        }
        console.error("[pa] MCP export resource failed:", error);
        throw new Error("导出执行失败，请重新查询后再试。");
      }
    },
  );
}
