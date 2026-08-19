import { publicApplicationError } from "../application/errors.js";

/** MCP 最外层调用边界：具体工具先完成领域错误映射，未知异常最后统一脱敏。 */
export function safeMcpHandler<Args extends unknown[], Result>(
  label: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const safe = publicApplicationError(error);
      if (safe.internal) console.error(`[pa] MCP ${label} 失败:`, error);
      throw new Error(safe.message, { cause: error });
    }
  };
}
