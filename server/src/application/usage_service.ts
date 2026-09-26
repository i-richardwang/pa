import { USAGE_LOG_RETENTION_DAYS, type UsageLog, type UsageSummary } from "../ports/usage_log.js";
import type { UsageStatistics } from "../ports/usage_statistics.js";
import { normalizePagination } from "../contracts/pagination_contract.js";
import type { Principal } from "../contracts/principal.js";
import { ForbiddenError } from "./errors.js";

type UsageSpan<Result> = {
  tool: string;
  caller: string;
  summarize?: (result: Result) => UsageSummary;
};

/** 工具调用日志的写入与控制台统计读取；transport 层不直接访问日志存储。 */
export function createUsageService(deps: { log: UsageLog; statistics: UsageStatistics }) {
  const assertAdmin = (principal: Principal) => {
    if (!principal.roles.includes("admin")) throw new ForbiddenError("需要管理员权限");
  };
  const days = (value: number) =>
    Math.min(
      Math.max(Number.isFinite(value) ? Math.trunc(value) || 30 : 30, 1),
      USAGE_LOG_RETENTION_DAYS,
    );
  async function log(record: Parameters<UsageLog["log"]>[0]): Promise<void> {
    try {
      await deps.log.log(record);
    } catch (error) {
      console.error("[pa] usage log 写入失败（不影响业务）:", error);
    }
  }

  function wrap<Args extends Record<string, unknown>, Rest extends unknown[], Result>(
    span: UsageSpan<Result>,
    handler: (args: Args, ...rest: Rest) => Promise<Result>,
  ): (args: Args, ...rest: Rest) => Promise<Result> {
    return async (args, ...rest) => {
      const started = performance.now();
      const analysisTitle = (args.analysis as { title?: unknown } | undefined)?.title;
      const termCount = Array.isArray(args.terms) ? args.terms.length : undefined;
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
        ...(termCount === undefined ? {} : { term_count: termCount }),
      };
      try {
        const result = await handler(args, ...rest);
        let summary: UsageSummary = {};
        try {
          summary = span.summarize?.(result) ?? {};
        } catch {
          // 摘要计算失败时仍记录成功日志。
        }
        await log({
          ...base,
          outcome: "ok",
          ...summary,
          duration_ms: performance.now() - started,
        });
        return result;
      } catch (error) {
        await log({
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
    log,
    wrap,
    mine: async (principal: Principal, rawDays: number, limit?: number, offset?: number) => {
      const page = normalizePagination(limit, offset);
      return deps.statistics.mine(principal.email, days(rawDays), page.limit, page.offset);
    },
    overview: async (principal: Principal, rawDays: number) => {
      assertAdmin(principal);
      return deps.statistics.overview(days(rawDays));
    },
    titles: async (principal: Principal, rawDays: number, limit?: number, offset?: number) => {
      assertAdmin(principal);
      const page = normalizePagination(limit, offset);
      return deps.statistics.titles(days(rawDays), page.limit, page.offset);
    },
    unanswered: async (principal: Principal, rawDays: number) => {
      assertAdmin(principal);
      return deps.statistics.unanswered(days(rawDays));
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
