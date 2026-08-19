import type { UsageLog, UsageSummary } from "../ports/usage_log.js";
import type { UsageStatistics } from "../ports/usage_statistics.js";

type UsageSpan<Result> = {
  tool: string;
  caller: string;
  summarize?: (result: Result) => UsageSummary;
};

/** 使用观察用例：统一工具调用记录与控制台统计读取，transport 不接触日志存储。 */
export function createUsageService(deps: { log: UsageLog; statistics: UsageStatistics }) {
  function wrap<Args extends Record<string, unknown>, Rest extends unknown[], Result>(
    span: UsageSpan<Result>,
    handler: (args: Args, ...rest: Rest) => Promise<Result>,
  ): (args: Args, ...rest: Rest) => Promise<Result> {
    return async (args, ...rest) => {
      const started = performance.now();
      const analysisTitle = (args.analysis as { title?: unknown } | undefined)?.title;
      const base = {
        caller: span.caller,
        tool: span.tool,
        analysis_id: typeof args.analysis_id === "string" ? args.analysis_id : undefined,
        view_id: typeof args.view_id === "string" ? args.view_id : undefined,
        title:
          typeof analysisTitle === "string"
            ? analysisTitle
            : typeof args.title === "string"
              ? args.title
              : typeof args.ask === "string"
                ? args.ask
                : undefined,
        args,
      };
      try {
        const result = await handler(args, ...rest);
        let summary: UsageSummary = {};
        try {
          summary = span.summarize?.(result) ?? {};
        } catch {
          // 摘要失败不吞成功日志。
        }
        await deps.log.log({
          ...base,
          outcome: "ok",
          ...summary,
          duration_ms: performance.now() - started,
        });
        return result;
      } catch (error) {
        await deps.log.log({
          ...base,
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
          duration_ms: performance.now() - started,
        });
        throw error;
      }
    };
  }

  return {
    log: (record: Parameters<UsageLog["log"]>[0]) => deps.log.log(record),
    wrap,
    overview: (days: number) => deps.statistics.overview(days),
    titles: (days: number, limit?: number, offset?: number) =>
      deps.statistics.titles(days, limit, offset),
    mine: (caller: string, days: number, limit?: number, offset?: number) =>
      deps.statistics.mine(caller, days, limit, offset),
    unanswered: (days: number) => deps.statistics.unanswered(days),
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
