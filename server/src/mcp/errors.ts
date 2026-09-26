import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { publicApplicationError, type PublicApplicationError } from "../application/errors.js";
import type { PublicErrorPayload } from "../contracts/error_contract.js";
import type { Logger } from "../ports/logger.js";

type McpToolErrorContent = {
  error: PublicErrorPayload;
};

type McpToolErrorResult = Omit<CallToolResult, "structuredContent"> & {
  content: [{ type: "text"; text: string }];
  structuredContent?: never;
  isError: true;
};

function publicMcpError(logger: Logger, label: string, error: unknown): PublicApplicationError {
  const safe = publicApplicationError(error);
  if (safe.internal) logger.error(`MCP ${label} 失败`, error);
  return safe;
}

/** 错误 JSON 位于 MCP `isError` 的 content；structuredContent 只承载成功 outputSchema。 */
export function safeMcpToolHandler<Args extends unknown[], Result extends CallToolResult>(
  logger: Logger,
  label: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result | McpToolErrorResult> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const safe = publicMcpError(logger, label, error);
      const payload: McpToolErrorContent = {
        error: {
          code: safe.code,
          message: safe.message,
          ...(safe.details ? { details: safe.details } : {}),
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError: true,
      };
    }
  };
}

/** 资源读取没有工具错误结果通道，只抛出经过相同应用错误分类的安全消息。 */
export function safeMcpResourceHandler<Args extends unknown[], Result>(
  logger: Logger,
  label: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const safe = publicMcpError(logger, label, error);
      throw new Error(safe.message, { cause: error });
    }
  };
}
