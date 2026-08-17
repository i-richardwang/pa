import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { createReportService } from "../application/report_service.js";

const usage = { log: async () => {} };
import type { Principal } from "../engine/cube_security.js";
import { semanticSpecOf } from "../test_support/report.js";
import type { AnalysisSpec } from "../semantic_core/analysis_spec.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { ReportConflictError, createReportRepository } from "./report_repository.js";

const path = () => join(tmpdir(), `pa_repository_${randomUUID()}.db`);
const spec = (id = "result") => ({
  title: "组织人数",
  views: [
    {
      id,
      view_title: "组织人数数据",
      measures: ["test_people_metrics.active_employee_count"],
      dimensions: ["test_people_metrics.organization_name"],
      time: { cutoff: "2026-07" },
    },
  ],
});
const principal = (email: string): Principal => ({
  email,
  roles: ["user"],
  orgScope: "*",
});
const execution = {
  executeReferenced: async () => {
    throw new Error("本测试不执行报告");
  },
};
const presentation = { renderShape: () => null };
const semanticPlanning = {
  compile: async (_principal: unknown, semantic: ReturnType<typeof semanticSpecOf>) => ({
    plan: planExecution({
      ...(semantic.analysis.title ? { title: semantic.analysis.title } : {}),
      views: semantic.analysis.views.filter((view) => !("from" in view)),
    } as AnalysisSpec),
    presentation: { type: "table" as const, y: [] },
    routes: [],
    record_projection_bindings: { views: [] },
  }),
};

describe("report aggregate", () => {
  test("报告与版本只存 analysis_id，逻辑规格只物化在 analysis", async () => {
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db);
    const reports = createReportRepository(db);
    const analysis = spec();
    const derived: AnalysisSpec = {
      ...analysis,
      views: [
        ...analysis.views,
        {
          id: "summary",
          view_title: "汇总",
          from: ["result"],
          columns: [{ col: "active_employee_count", source: "result" }],
        },
      ],
    };
    const logical = semanticSpecOf(derived);
    const analysisRecord = await analyses.create("alice@x", logical);
    const created = await reports.create({
      owner: "alice@x",
      name: "派生报告",
      analysisId: analysisRecord.id,
    });
    expect(created.analysis_id).toBe(analysisRecord.id);
    expect(created).not.toHaveProperty("spec");
    expect(db.prepare("SELECT COUNT(*) AS n FROM analysis").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT analysis_id FROM report WHERE id = ?").get(created.id)).toEqual({
      analysis_id: analysisRecord.id,
    });
  });

  test("只从本人 handle 保存，revision 乐观锁与归档生效", async () => {
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db);
    const reports = createReportRepository(db);
    const service = createReportService({
      reports,
      analyses,
      execution,
      presentation,
      semanticPlanning,
      usage,
    });
    const handle = await analyses.create("alice@x", semanticSpecOf(spec()));
    await expect(
      service.save({
        principal: principal("bob@x"),
        analysisId: handle.id,
        name: "越权",
      }),
    ).rejects.toThrow(/无权访问/);

    const saved = await service.save({
      principal: principal("alice@x"),
      analysisId: handle.id,
      name: "组织报告",
    });
    expect(saved.revision).toBe(1);
    const renamed = await service.update(
      principal("alice@x"),
      saved.id,
      { type: "rename", name: "组织人数报告" },
      1,
    );
    expect(renamed.revision).toBe(2);
    await expect(
      service.update(principal("alice@x"), saved.id, { type: "rename", name: "冲突" }, 1),
    ).rejects.toBeInstanceOf(ReportConflictError);
    const archived = await service.update(principal("alice@x"), saved.id, { type: "archive" }, 2);
    expect(archived.archived_at).not.toBeNull();
    expect(await reports.listOwned("alice@x")).toEqual([]);
    expect(await reports.listOwned("alice@x", undefined, true)).toHaveLength(1);
  });

  test("并发更新由 SQL revision 条件保证只有一方提交", async () => {
    const dbPath = path();
    const firstDb = createTestAppDatabase(dbPath);
    const first = createReportRepository(firstDb);
    const second = createReportRepository(createTestAppDatabase(dbPath));
    const analysis = await createAnalysisRepository(firstDb).create(
      "alice@x",
      semanticSpecOf(spec()),
    );
    const report = await first.create({
      owner: "alice@x",
      name: "初始",
      analysisId: analysis.id,
    });
    const settled = await Promise.allSettled([
      first.update(report.id, "alice@x", { name: "甲" }, 1),
      second.update(report.id, "alice@x", { name: "乙" }, 1),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((item) => item.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
      ReportConflictError,
    );
    expect((await first.get(report.id))?.revision).toBe(2);
    expect(await first.listRevisions(report.id, "alice@x")).toHaveLength(1);
  });

  test("每次更新快照上一版、只留最近 20 版，恢复追加新 revision", async () => {
    const db = createTestAppDatabase();
    const reports = createReportRepository(db);
    const analyses = createAnalysisRepository(db);
    const service = createReportService({
      reports,
      analyses,
      execution,
      presentation,
      semanticPlanning,
      usage,
    });
    const analysis = await analyses.create("alice@x", semanticSpecOf(spec()));
    let current = await reports.create({
      owner: "alice@x",
      name: "版本 1",
      analysisId: analysis.id,
    });
    for (let revision = 2; revision <= 26; revision += 1) {
      current = await reports.update(
        current.id,
        "alice@x",
        { name: `版本 ${revision}` },
        current.revision,
      );
    }
    const revisions = await reports.listRevisions(current.id, "alice@x");
    expect(revisions).toHaveLength(20);
    expect(revisions.map((row) => row.revision)).toEqual(
      Array.from({ length: 20 }, (_, index) => 25 - index),
    );
    const restored = await service.update(
      principal("alice@x"),
      current.id,
      { type: "restore", revision: 6 },
      26,
    );
    expect(restored).toMatchObject({ name: "版本 6", revision: 27 });
    const afterRestore = await reports.listRevisions(current.id, "alice@x");
    expect(afterRestore).toHaveLength(20);
    expect(afterRestore[0]).toMatchObject({ revision: 26, name: "版本 26" });
  });

  test("报告检索把通配符按名称字面量匹配", async () => {
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db);
    const reports = createReportRepository(db);
    const analysis = await analyses.create("alice@x", semanticSpecOf(spec()));
    await reports.create({
      owner: "alice@x",
      name: "人数_100%",
      analysisId: analysis.id,
    });
    await reports.create({
      owner: "alice@x",
      name: "人数汇总",
      analysisId: analysis.id,
    });
    expect(await reports.listOwned("alice@x", "_100%")).toHaveLength(1);
    expect((await reports.listOwned("alice@x", "_100%"))[0]?.name).toBe("人数_100%");
  });

  test("render shape 缓存不递增 revision，旧 analysis_id 不能覆盖新缓存", async () => {
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db);
    const reports = createReportRepository(db);
    const service = createReportService({
      reports,
      analyses,
      execution,
      presentation,
      semanticPlanning,
      usage,
    });
    const handle = await analyses.create("alice@x", semanticSpecOf(spec()));
    const saved = await service.save({
      principal: principal("alice@x"),
      analysisId: handle.id,
      name: "报告",
    });
    await service.cacheRenderShape(saved, "table");
    expect(await reports.get(saved.id)).toMatchObject({
      render_shape: "table",
      revision: 1,
    });
    const next = await analyses.create("alice@x", semanticSpecOf(spec("next")));
    const updated = await service.update(principal("alice@x"), saved.id, {
      type: "replace_analysis",
      analysis_id: next.id,
    });
    expect(updated).toMatchObject({ render_shape: null, revision: 2 });
    await service.cacheRenderShape(saved, "kpi");
    expect(await reports.get(saved.id)).toMatchObject({
      render_shape: null,
      revision: 2,
    });
  });
});
