import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ExportIncompleteError,
  ExportTicketUnavailableError,
  type ExportService,
} from "../application/export_service.js";
import {
  EXPORT_RESOURCE_MIME_TYPE,
  EXPORT_RESOURCE_URI_TEMPLATE,
} from "../contracts/export_contract.js";
import type { McpRegistrationContext } from "./context.js";
import {
  EXPORT_OUTPUT,
  OAUTH_SECURITY_SCHEMES,
  TOOL_DESCRIPTIONS,
  WRITE_ANNOTATIONS,
} from "./contracts.js";

export function registerExportTools(
  context: McpRegistrationContext & {
    exports: Pick<ExportService, "exportResult" | "readResource">;
  },
): void {
  const { server, principal, exports } = context;

  server.registerTool(
    "export_result",
    {
      title: "导出分析结果",
      description: TOOL_DESCRIPTIONS.export_result,
      inputSchema: {
        view_id: z.string().uuid(),
      },
      outputSchema: EXPORT_OUTPUT,
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    async (input: { view_id: string }) => {
      const payload = await exports.exportResult(principal, input.view_id);
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
      try {
        if (typeof ticket !== "string") {
          throw new ExportTicketUnavailableError("下载资源无效，请重新查询。");
        }
        const { csv } = await exports.readResource(principal, ticket);
        return {
          contents: [{ uri: uri.href, mimeType: EXPORT_RESOURCE_MIME_TYPE, text: csv }],
        };
      } catch (error) {
        if (error instanceof ExportTicketUnavailableError) throw error;
        if (error instanceof ExportIncompleteError) {
          throw new Error(`${error.message}；请增加过滤条件后重新导出。`);
        }
        console.error("[pa] MCP export resource failed:", error);
        throw new Error("导出执行失败，请重新查询后再试。");
      }
    },
  );
}
