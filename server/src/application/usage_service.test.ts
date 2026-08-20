import { describe, expect, spyOn, test } from "bun:test";
import type { UsageLog } from "../ports/usage_log.js";
import type { UsageStatistics } from "../ports/usage_statistics.js";
import { createUsageService } from "./usage_service.js";
import type { Principal } from "../contracts/principal.js";
import { ForbiddenError } from "./errors.js";

const admin: Principal = { email: "admin@x", roles: ["admin"], accessScope: { kind: "all" } };
const alice: Principal = { email: "alice@x", roles: ["user"], accessScope: { kind: "all" } };

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

const statistics = {
  overview: unused,
  titles: unused,
  mine: unused,
  unanswered: unused,
} satisfies UsageStatistics;

function failingLog(): UsageLog {
  return {
    log: async () => {
      throw new Error("log unavailable");
    },
    removeExpired: () => 0,
  };
}

describe("usage service 旁路失败隔离", () => {
  test("直接观察失败不改变业务结果", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const usage = createUsageService({ log: failingLog(), statistics });
      await expect(
        usage.log({
          caller: "alice@x",
          tool: "save_report",
          outcome: "ok",
          duration_ms: 1,
        }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  test("包装器保留成功返回值和原始业务异常", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const usage = createUsageService({ log: failingLog(), statistics });
      const succeed = usage.wrap({ tool: "catalog", caller: "alice@x" }, async () => "ok");
      await expect(succeed({})).resolves.toBe("ok");

      const businessError = new Error("business failed");
      const fail = usage.wrap({ tool: "catalog", caller: "alice@x" }, async () => {
        throw businessError;
      });
      await expect(fail({})).rejects.toBe(businessError);
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });

  test("统计时间与分页策略只在 Application 规范化", async () => {
    const calls: unknown[] = [];
    const usage = createUsageService({
      log: { log: async () => {}, removeExpired: () => 0 },
      statistics: {
        overview: async (days) => {
          calls.push({ kind: "overview", days });
          return { days, cells: [], callers: [] };
        },
        titles: async (days, limit, offset) => {
          calls.push({ kind: "titles", days, limit, offset });
          return { days, rows: [], total: 0 };
        },
        mine: async (_caller, days, limit, offset) => {
          calls.push({ kind: "mine", days, limit, offset });
          return { days, rows: [], total: 0 };
        },
        unanswered: async (days) => ({ days, zero_hits: [], errors: [] }),
      },
    });
    await usage.overview(admin, Number.NaN);
    await usage.titles(admin, 999, 999, -4);
    await usage.mine(alice, 0, Number.NaN, Number.NaN);
    await expect(usage.overview(alice, 30)).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toEqual([
      { kind: "overview", days: 30 },
      { kind: "titles", days: 90, limit: 200, offset: 0 },
      { kind: "mine", days: 30, limit: 20, offset: 0 },
    ]);
  });
});
