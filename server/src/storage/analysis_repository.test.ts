import { describe, expect, test } from "bun:test";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { semanticSpecOf } from "../test_support/report.js";
import { ANALYSIS_RETENTION_DAYS, createAnalysisRepository } from "./analysis_repository.js";
import { createReportRepository } from "./report_repository.js";

const spec = (id = "result") => ({
  title: "组织人数",
  views: [
    {
      id,
      measures: ["test_people_metrics.active_employee_count"],
      dimensions: ["test_people_metrics.organization_name"],
      time: { cutoff: "2026-07" },
    },
  ],
});

describe("analysis repository", () => {
  test("handle 是持久且按属主隔离的 canonical spec 身份", async () => {
    const repository = createAnalysisRepository(createTestAppDatabase());
    const created = await repository.create("alice@x", semanticSpecOf(spec()));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await repository.resolveOwned(created.id, "alice@x")).spec).toEqual(
      semanticSpecOf(spec()),
    );
    await expect(repository.resolveOwned(created.id, "bob@x")).rejects.toThrow(/无权访问/);
  });

  test("滚动清理只删除超过 180 天且未被报告引用的分析", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const repository = createAnalysisRepository(createTestAppDatabase(), { now: () => now });
    const old = await repository.create("alice@x", semanticSpecOf(spec()));
    now += (ANALYSIS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    await expect(repository.resolveOwned(old.id, "alice@x")).rejects.toThrow(/已过期/);
    const fresh = await repository.create("alice@x", semanticSpecOf(spec("fresh")));
    expect(await repository.removeExpired()).toBe(0);
    expect(await repository.get(old.id)).toBeNull();
    expect(await repository.get(fresh.id)).not.toBeNull();
  });

  test("当前报告与保留历史共同保护超过 180 天的 Analysis", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db, { now: () => now });
    const reports = createReportRepository(db);
    const original = await analyses.create("alice@x", semanticSpecOf(spec()));
    const report = await reports.create({
      owner: "alice@x",
      name: "长期报告",
      analysisId: original.id,
    });

    now += (ANALYSIS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    expect((await analyses.resolveOwned(original.id, "alice@x")).id).toBe(original.id);
    const replacement = await analyses.create("alice@x", semanticSpecOf(spec("replacement")));
    await reports.update(report.id, "alice@x", { analysisId: replacement.id }, report.revision);

    expect(await analyses.removeExpired()).toBe(0);
    expect(await analyses.get(original.id)).not.toBeNull();
    expect((await reports.listRevisions(report.id, "alice@x"))[0]?.analysis_id).toBe(original.id);
  });
});
