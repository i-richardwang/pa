import type { Logger } from "../ports/logger.js";

export type LogEntry =
  | { level: "info"; message: string }
  | { level: "error"; message: string; error: unknown };

/** 把日志收进数组，供测试断言；不写到终端。 */
export function recordingLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    error: (message, error) => entries.push({ level: "error", message, error }),
  };
}
