import { z } from "zod";
import { CATALOG_TERMS_INPUT, type CatalogQueryInput } from "../contracts/catalog_query.js";
import type { McpRegistrationContext } from "./context.js";
import type { CatalogService } from "../application/catalog_service.js";
import type { UsageService } from "../application/usage_service.js";
import { projectAgentCatalog } from "./catalog_result.js";
import { safeMcpToolHandler } from "./errors.js";
import {
  CATALOG_OUTPUT_SCHEMA,
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  VALUES_OUTPUT_SCHEMA,
} from "./contracts.js";

export function registerCatalogTools(
  context: McpRegistrationContext & {
    catalog: Pick<CatalogService, "query" | "dimensionValues">;
    usage: Pick<UsageService, "wrap">;
  },
): void {
  const { server, principal, logger, catalog, usage } = context;
  const caller = principal.email;

  server.registerTool(
    "catalog",
    {
      title: "查找可用指标",
      description: TOOL_DESCRIPTIONS.catalog,
      inputSchema: z.strictObject({ terms: CATALOG_TERMS_INPUT }),
      outputSchema: CATALOG_OUTPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    safeMcpToolHandler(
      logger,
      "catalog",
      usage.wrap(
        {
          tool: "catalog",
          caller,
          summarize: (result) => ({
            row_count:
              result.structuredContent.measures.length + result.structuredContent.dimensions.length,
            ...(result.structuredContent.unmatched_terms.length
              ? { unmatched_terms: result.structuredContent.unmatched_terms }
              : {}),
          }),
        },
        async (input: CatalogQueryInput) => {
          const payload = projectAgentCatalog(await catalog.query(principal, input));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        },
      ),
    ),
  );

  server.registerTool(
    "values_of",
    {
      title: "列出维度取值",
      description: TOOL_DESCRIPTIONS.values_of,
      inputSchema: z.strictObject({
        dimension: z.string().min(1).describe("catalog 返回的分类维度 id"),
        contains: z.string().min(1).max(100).optional().describe("可选，只返回包含该文字的取值"),
      }),
      outputSchema: VALUES_OUTPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    safeMcpToolHandler(
      logger,
      "values_of",
      usage.wrap(
        {
          tool: "values_of",
          caller,
          summarize: (result) => ({ row_count: result.structuredContent.values.length }),
        },
        async (input: { dimension: string; contains?: string }) => {
          const payload = await catalog.dimensionValues(principal, input.dimension, input.contains);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        },
      ),
    ),
  );
}
