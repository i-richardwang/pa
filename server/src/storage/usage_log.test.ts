/**
 * 使用日志单测：包装层的成败落行、完整入参与摘要、摘要容错。
 * 真实查数工具链路由 scripts/smoke.ts 端到端覆盖；feedback 存取另见 feedback.test.ts。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { createUsageService } from "../application/usage_service.js";
import { createUsageStats } from "./usage_stats.js";
import { createUsageLog, USAGE_LOG_RETENTION_DAYS } from "./usage_log.js";

let seq = 0;
const runId = randomUUID();
function fresh() {
  seq += 1;
  const path = join(tmpdir(), `pa_usage_log_test_${runId}_${seq}.db`);
  const db = createTestAppDatabase(path);
  return {
    usage: createUsageService({ log: createUsageLog(db), statistics: createUsageStats(db) }),
    path,
  };
}

type Row = Record<string, string | number | null>;
function rows(path: string): Row[] {
  return new Database(path).query("SELECT * FROM usage_log ORDER BY id").all() as Row[];
}

describe("usage_log.wrap", () => {
  test("成功查询写分析指纹，同一规格可聚合为重复查询", async () => {
    const { usage, path } = fresh();
    const views = [
      {
        id: "result",
        measures: ["active_employee_count"],
        dimensions: ["organization_name"],
        time: {
          window: { kind: "current_month", month: "2026-06" },
        },
      },
    ];
    for (const title of ["组织人数", "再看一次组织人数"]) {
      await usage.log({
        caller: "tester",
        tool: "run_analysis",
        title,
        args: { spec: { version: 2, analysis: { title, views }, presentation: { type: "table" } } },
        outcome: "ok",
        duration_ms: 1,
      });
    }
    const groups = new Database(path)
      .prepare(
        `SELECT query_fingerprint, COUNT(*) AS n
         FROM usage_log GROUP BY query_fingerprint`,
      )
      .all() as Array<{ query_fingerprint: string | null; n: number }>;
    expect(groups).toHaveLength(1);
    expect(groups[0].query_fingerprint).toMatch(/^q-[0-9a-f]{10}$/);
    expect(groups[0].n).toBe(2);
  });

  test("成功调用落行：title 取自入参，摘要取自应答", async () => {
    const { usage, path } = fresh();
    const handler = usage.wrap(
      {
        tool: "query",
        caller: "tester",
        summarize: (res: { structuredContent: { row_count: number } }) => ({
          row_count: res.structuredContent.row_count,
          has_more: false,
        }),
      },
      async (_args: { title?: string; measures?: string[] }) => ({
        structuredContent: { row_count: 7 },
      }),
    );
    const result = await handler({
      title: "各职级人员结构",
      measures: ["m.active_employee_count"],
    });
    expect(result.structuredContent.row_count).toBe(7);

    const [row] = rows(path);
    expect(row.tool).toBe("query");
    expect(row.caller).toBe("tester");
    expect(row.title).toBe("各职级人员结构");
    expect(row.outcome).toBe("ok");
    expect(row.row_count).toBe(7);
    expect(row.has_more).toBe(0);
    expect(JSON.parse(String(row.args)).measures).toEqual(["m.active_employee_count"]);
    expect(Number(row.duration_ms)).toBeGreaterThanOrEqual(0);
  });

  test("terms 精确保留在 args，逐项缺口来自摘要", async () => {
    const { usage, path } = fresh();
    const handler = usage.wrap(
      {
        tool: "catalog",
        caller: "tester",
        summarize: () => ({ unmatched_terms: ["股票期权"] }),
      },
      async (_args: { terms?: string[] }) => ({ content: [] }),
    );
    await handler({ terms: ["离职率", "股票期权"] });

    const [row] = rows(path);
    expect(JSON.parse(String(row.args)).terms).toEqual(["离职率", "股票期权"]);
    expect(JSON.parse(String(row.unmatched_terms))).toEqual(["股票期权"]);
    expect(row.title).toBeNull();
    expect(row.row_count).toBeNull();
  });

  test("feedback 成功调用以 ask 作为日志 title", async () => {
    const { usage, path } = fresh();
    const handler = usage.wrap(
      { tool: "feedback", caller: "tester" },
      async (_args: { ask: string }) => "ok" as const,
    );
    await handler({ ask: "能否查看工时？" });
    expect(rows(path)[0].title).toBe("能否查看工时？");
  });

  test("带 analysis_id 的工具包装器把句柄写入观察日志", async () => {
    const { usage, path } = fresh();
    const analysisId = randomUUID();
    const handler = usage.wrap(
      { tool: "save_report", caller: "tester" },
      async (_args: { analysis_id: string; name: string }) => "ok" as const,
    );
    await handler({ analysis_id: analysisId, name: "组织报告" });
    expect(rows(path)[0]).toMatchObject({ tool: "save_report", analysis_id: analysisId });
  });

  test("feedback 报错调用仍以 ask 落 title，并原样上抛", async () => {
    const { usage, path } = fresh();
    const handler = usage.wrap(
      { tool: "feedback", caller: "tester" },
      async (_args: { ask: string }) => {
        throw new Error("标准值不存在");
      },
    );
    await expect(handler({ ask: "不存在组织有多少人？" })).rejects.toThrow("标准值不存在");

    const [row] = rows(path);
    expect(row.outcome).toBe("error");
    expect(row.title).toBe("不存在组织有多少人？");
    expect(row.error).toBe("标准值不存在");
    expect(row.row_count).toBeNull();
  });

  test("摘要抛错不影响成功日志与应答", async () => {
    const { usage, path } = fresh();
    const handler = usage.wrap(
      {
        tool: "query",
        caller: "tester",
        summarize: () => {
          throw new Error("bad summary");
        },
      },
      async (_args: Record<string, never>) => "ok" as const,
    );
    expect(await handler({})).toBe("ok");

    const [row] = rows(path);
    expect(row.outcome).toBe("ok");
    expect(row.row_count).toBeNull();
  });

  test("启动时清理超过 366 天的观察日志，边界内记录保留", () => {
    const path = join(tmpdir(), `pa_usage_retention_${runId}_${++seq}.db`);
    const db = createTestAppDatabase(path);
    const now = Date.UTC(2026, 6, 29);
    const insert = db.prepare(
      `INSERT INTO usage_log
       (at, caller, tool, args, outcome, duration_ms)
       VALUES (?, ?, 'catalog', '{}', 'ok', 1)`,
    );
    insert.run(
      new Date(now - (USAGE_LOG_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
      "expired",
    );
    insert.run(
      new Date(now - USAGE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      "boundary",
    );

    createUsageLog(db, { now: () => now });

    expect(db.prepare("SELECT caller FROM usage_log ORDER BY caller").all()).toEqual([
      { caller: "boundary" },
    ]);
    db.close();
  });
});
