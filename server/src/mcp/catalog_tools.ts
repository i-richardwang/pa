import { z } from "zod";
import { CATALOG_INPUT, type CatalogToolInput } from "../engine/catalog_spec.js";
import type { McpRegistrationContext } from "./context.js";
import type { CatalogService } from "../application/catalog_service.js";
import type { UsageService } from "../application/usage_service.js";
import {
  CATALOG_OUTPUT,
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  VALUES_OUTPUT,
} from "./contracts.js";

export function registerCatalogTools(
  context: McpRegistrationContext & {
    catalog: Pick<CatalogService, "query" | "dimensionValues">;
    usage: Pick<UsageService, "wrap">;
  },
): void {
  const { server, principal, catalog, usage } = context;
  const caller = principal.email;

  server.registerTool(
    "catalog",
    {
      title: "查找可用指标",
      description: TOOL_DESCRIPTIONS.catalog,
      inputSchema: { terms: CATALOG_INPUT.terms },
      outputSchema: CATALOG_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
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
      async (input: CatalogToolInput) => {
        const payload = await catalog.query(principal, input);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      },
    ),
  );

  server.registerTool(
    "values_of",
    {
      title: "列举维度真实值",
      description: TOOL_DESCRIPTIONS.values_of,
      inputSchema: {
        dimension: z.string().min(1).describe("catalog 返回的可搜索分类维度语义 id"),
        contains: z.string().min(1).max(100).optional().describe("可选的值子串"),
      },
      outputSchema: VALUES_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
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
  );
}
