import { recordingLogger } from "../test_support/logger.js";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageLog } from "./usage_log.js";
import { createUsageStats } from "./usage_stats.js";
import { createUsageService } from "../application/usage_service.js";
import type { SqliteDatabase } from "../sqlite.js";

const createUsage = (db: SqliteDatabase) =>
  createUsageService({
    log: createUsageLog(db),
    statistics: createUsageStats(db),
    logger: recordingLogger(),
  });
import { semanticAnalysisOf } from "../test_support/report.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { createTestAppDatabase } from "../test_support/app_database.js";

let seq = 0;
const runId = randomUUID();
function freshPath() {
  seq += 1;
  return join(tmpdir(), `pa_usage_stats_test_${runId}_${seq}.db`);
}

/** 写入分析成功（带 title）、重跑、目录命中与未命中、分析报错各一类日志 */
async function seed(path: string) {
  const usage = createUsage(createTestAppDatabase(path));
  await usage.log({
    caller: "alice",
    tool: "run_analysis",
    title: "全公司各职级人员结构",
    query_fingerprint: "q-1111111111",
    outcome: "ok",
    row_count: 7,
    has_more: false,
    duration_ms: 100,
  });
  await usage.log({
    caller: "alice",
    tool: "rerun_analysis",
    title: "研发部在职人数趋势",
    outcome: "ok",
    row_count: 42,
    duration_ms: 100,
  });
  await usage.log({
    caller: "bob",
    tool: "catalog",
    term_count: 2,
    outcome: "ok",
    row_count: 1,
    unmatched_terms: ["加班时长"],
    duration_ms: 10,
  });
  await usage.log({
    caller: "bob",
    tool: "catalog",
    term_count: 1,
    outcome: "ok",
    row_count: 4,
    unmatched_terms: [],
    duration_ms: 10,
  });
  await usage.log({
    caller: "bob",
    tool: "run_analysis",
    outcome: "error",
    error: "Cube 'x' not found",
    duration_ms: 20,
  });
}

describe("usage_stats", () => {
  test("空应用库返回空结果", async () => {
    const stats = createUsageStats(createTestAppDatabase());
    expect((await stats.overview(30)).cells).toEqual([]);
    expect((await stats.titles(30, 20, 0)).rows).toEqual([]);
    expect((await stats.unanswered(30)).zero_hits).toEqual([]);
  });

  test("overview 按 tool × outcome 聚合并给出调用者排行", async () => {
    const path = freshPath();
    await seed(path);
    const { cells, callers, days } = await createUsageStats(createTestAppDatabase(path)).overview(
      30,
    );
    expect(days).toBe(30);
    expect(cells).toEqual([
      { tool: "catalog", outcome: "ok", n: 2, truncated: 0 },
      { tool: "rerun_analysis", outcome: "ok", n: 1, truncated: 0 },
      { tool: "run_analysis", outcome: "error", n: 1, truncated: 0 },
      { tool: "run_analysis", outcome: "ok", n: 1, truncated: 0 },
    ]);
    expect(callers.map((c) => [c.caller, c.n])).toEqual([
      ["bob", 3],
      ["alice", 2],
    ]);
  });

  test("titles 只返回成功且带 title 的分析执行（含重跑），按时间倒序", async () => {
    const path = freshPath();
    await seed(path);
    const { rows } = await createUsageStats(createTestAppDatabase(path)).titles(30, 20, 0);
    expect(rows.map((r) => r.title)).toEqual(["研发部在职人数趋势", "全公司各职级人员结构"]);
    expect(rows[1].row_count).toBe(7);
  });

  test("mine 只返回该 caller 成功且带 title 的分析执行", async () => {
    const path = freshPath();
    await seed(path);
    const stats = createUsageStats(createTestAppDatabase(path));
    const alice = await stats.mine("alice", 30, 20, 0);
    expect(alice.rows.map((r) => r.title)).toEqual(["研发部在职人数趋势", "全公司各职级人员结构"]);
    expect((await stats.mine("bob", 30, 20, 0)).rows).toEqual([]);
  });

  test("mine 在 Analysis 已删除时保留使用记录，analysis_id 返回 null", async () => {
    const path = freshPath();
    const db = createTestAppDatabase(path);
    const repository = createAnalysisRepository(db);
    const fixture = semanticAnalysisOf({
      views: [
        {
          id: "result",
          measures: ["test_people_metrics.active_employee_count"],
          time: { cutoff: "2026-07" },
        },
      ],
    });
    const identity = await repository.create("alice", fixture.analysis, fixture.view);
    await createUsage(db).log({
      caller: "alice",
      tool: "run_analysis",
      title: "组织人数",
      outcome: "ok",
      duration_ms: 1,
      analysis_id: identity.analysis.id,
      view_id: identity.view.id,
    });
    const stats = createUsageStats(db);
    expect((await stats.mine("alice", 30, 20, 0)).rows[0]?.view_id).toBe(identity.view.id);
    new Database(path).prepare("DELETE FROM analysis WHERE id = ?").run(identity.analysis.id);
    expect((await stats.mine("alice", 30, 20, 0)).rows[0]?.analysis_id).toBeNull();
  });

  test("unanswered 对部分命中的目录请求逐项聚合未命中词，并聚合报错", async () => {
    const path = freshPath();
    await seed(path);
    const { zero_hits, errors } = await createUsageStats(createTestAppDatabase(path)).unanswered(
      30,
    );
    expect(zero_hits).toHaveLength(1);
    expect(zero_hits[0]).toMatchObject({ term: "加班时长", n: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ tool: "run_analysis", error: "Cube 'x' not found", n: 1 });
  });

  test("unanswered 的 feedback 报错聚合附带最近一条提问原文", async () => {
    const path = freshPath();
    const db = createTestAppDatabase(path);
    const usage = createUsage(db);
    const handler = usage.wrap(
      { tool: "feedback", caller: "alice" },
      async (_args: { ask: string }) => {
        throw new Error("标准值不存在");
      },
    );
    await expect(handler({ ask: "不存在组织有多少人？" })).rejects.toThrow("标准值不存在");
    const { errors } = await createUsageStats(db).unanswered(30);
    expect(errors[0]).toMatchObject({
      tool: "feedback",
      error: "标准值不存在",
      n: 1,
      example_title: "不存在组织有多少人？",
    });
  });

  test("时间窗之外的日志不计入统计", async () => {
    const path = freshPath();
    await seed(path);
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    new Database(path).prepare("UPDATE usage_log SET at = ? WHERE tool = 'catalog'").run(old);
    const stats = createUsageStats(createTestAppDatabase(path));
    const { cells } = await stats.overview(30);
    expect(cells.every((c) => c.tool === "run_analysis" || c.tool === "rerun_analysis")).toBe(true);
    expect((await stats.unanswered(30)).zero_hits).toEqual([]);
    const explicit = await stats.unanswered(366);
    expect(explicit.days).toBe(366);
    expect(explicit.zero_hits).toEqual([expect.objectContaining({ term: "加班时长" })]);
  });
});
