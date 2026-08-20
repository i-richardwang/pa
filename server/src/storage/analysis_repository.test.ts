import { describe, expect, test } from "bun:test";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { semanticAnalysisOf } from "../test_support/report.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { ANALYSIS_RETENTION_DAYS } from "../ports/analysis_repository.js";
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
  test("Analysis 与 View 分列持久化，并按属主隔离", async () => {
    const repository = createAnalysisRepository(createTestAppDatabase());
    const preferences = {
      table_shading: { palette: "red_blue" as const, flipped: true },
    };
    const fixture = semanticAnalysisOf(spec());
    const created = await repository.create("alice@x", fixture.analysis, fixture.view, preferences);
    expect(created.analysis.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.view.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repository.resolveOwnedView(created.view.id, "alice@x")).toMatchObject({
      analysis: { definition: fixture.analysis },
      view: { intent: fixture.view, preferences: preferences },
    });
    await expect(repository.resolveOwnedView(created.view.id, "bob@x")).rejects.toThrow(/无权访问/);
  });

  test("滚动清理只删除超过 180 天且未被报告引用的分析", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const repository = createAnalysisRepository(createTestAppDatabase(), { now: () => now });
    const oldFixture = semanticAnalysisOf(spec());
    const old = await repository.create("alice@x", oldFixture.analysis, oldFixture.view);
    now += (ANALYSIS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    await expect(repository.resolveOwnedView(old.view.id, "alice@x")).rejects.toThrow(/已过期/);
    const freshFixture = semanticAnalysisOf(spec("fresh"));
    const fresh = await repository.create("alice@x", freshFixture.analysis, freshFixture.view);
    expect(await repository.removeExpired()).toBe(0);
    expect(await repository.getAnalysis(old.analysis.id)).toBeNull();
    expect(await repository.getAnalysis(fresh.analysis.id)).not.toBeNull();
  });

  test("当前报告与保留历史共同保护超过 180 天的 Analysis", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db, { now: () => now });
    const reports = createReportRepository(db);
    const originalFixture = semanticAnalysisOf(spec());
    const original = await analyses.create(
      "alice@x",
      originalFixture.analysis,
      originalFixture.view,
    );
    const report = await reports.create({
      owner: "alice@x",
      name: "长期报告",
      viewId: original.view.id,
    });

    now += (ANALYSIS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    expect((await analyses.resolveOwnedView(original.view.id, "alice@x")).view.id).toBe(
      original.view.id,
    );
    const replacementFixture = semanticAnalysisOf(spec("replacement"));
    const replacement = await analyses.create(
      "alice@x",
      replacementFixture.analysis,
      replacementFixture.view,
    );
    await reports.update(report.id, "alice@x", { viewId: replacement.view.id }, report.revision);

    expect(await analyses.removeExpired()).toBe(0);
    expect(await analyses.getAnalysis(original.analysis.id)).not.toBeNull();
    expect((await reports.listRevisions(report.id, "alice@x"))[0]?.view_id).toBe(original.view.id);
  });
});
