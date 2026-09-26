import type { Logger } from "../ports/logger.js";

/** 写到进程的 stdout / stderr，由容器运行时收集。 */
export const consoleLogger: Logger = {
  info: (message) => console.log(`[pa] ${message}`),
  error: (message, error) => console.error(`[pa] ${message}:`, error),
};
