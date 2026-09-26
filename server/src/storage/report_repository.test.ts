import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestAppDatabase } from "../test_support/app_database.js";
import { createReportService } from "../application/report_service.js";

const usage = { log: async () => {} };
import type { Principal } from "../contracts/principal.js";
import { semanticAnalysisOf } from "../test_support/report.js";
import type { AnalysisSpec } from "../semantic_core/analysis_spec.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { createReportRepository } from "./report_repository.js";
import { ReportConflictError } from "../ports/report_repository.js";
import type { AnalysisRepository } from "../ports/analysis_repository.js";
import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import { semanticAccessStub } from "../test_support/dashboard.js";
import { InvalidRequestError } from "../application/errors.js";

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
  accessScope: { kind: "all" },
});
const execution = {
  executeReferenced: async () => {
    throw new Error("本测试不执行报告");
  },
};
const presentation = { renderShape: () => null };
const semanticPlanning = {
  plan: async (caller: Principal, semantic: AnalysisDefinition, _intent: SemanticViewIntent) => ({
    plan: planExecution(
      {
        ...(semantic.title ? { title: semantic.title } : {}),
        views: [{ ...semantic.query, id: "query" }],
      } as AnalysisSpec,
      { delivery: "identity" },
    ),
    presentation: { type: "table" as const },
    render_decl: { type: "table" as const },
    routes: [],
    record_projection_bindings: { views: [] },
    access: semanticAccessStub(caller),
  }),
};

async function createOwned(analyses: AnalysisRepository, owner: string, value: AnalysisSpec) {
  const fixture = semanticAnalysisOf(value);
  return analyses.create(owner, fixture.analysis, fixture.view);
}

describe("report aggregate", () => {
  test("报告与版本只存 view_id，定义与视图各自只物化一次", async () => {
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
    const logical = semanticAnalysisOf(derived);
    const analysisRecord = await analyses.create("alice@x", logical.analysis, logical.view);
    const created = await reports.create({
      owner: "alice@x",
      name: "派生报告",
      viewId: analysisRecord.view.id,
    });
    expect(created.view_id).toBe(analysisRecord.view.id);
    expect(created).not.toHaveProperty("spec");
    expect(db.prepare("SELECT COUNT(*) AS n FROM analysis").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT view_id FROM report WHERE id = ?").get(created.id)).toEqual({
      view_id: analysisRecord.view.id,
    });
  });

  test("只能从本人的 View 保存报告，revision 乐观锁与归档生效", async () => {
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
    const identity = await createOwned(analyses, "alice@x", spec());
    await expect(
      service.save({
        principal: principal("alice@x"),
        viewId: identity.view.id,
        name: " ",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      service.save({
        principal: principal("bob@x"),
        viewId: identity.view.id,
        name: "越权",
      }),
    ).rejects.toThrow(/无权访问/);

    const saved = await service.save({
      principal: principal("alice@x"),
      viewId: identity.view.id,
      name: " 组织报告 ",
    });
    expect(saved.name).toBe("组织报告");
    expect(saved.revision).toBe(1);
    const renamed = await service.update(
      principal("alice@x"),
      saved.id,
      { type: "rename", name: " 组织人数报告 " },
      1,
    );
    expect(renamed.name).toBe("组织人数报告");
    expect(renamed.revision).toBe(2);
    await expect(
      service.update(principal("alice@x"), saved.id, { type: "rename", name: "冲突" }, 1),
    ).rejects.toBeInstanceOf(ReportConflictError);
    const archived = await service.update(principal("alice@x"), saved.id, { type: "archive" }, 2);
    expect(archived.archived_at).not.toBeNull();
    expect(await reports.listOwned("alice@x")).toEqual([]);
    expect(await reports.listOwned("alice@x", undefined, "all")).toHaveLength(1);
  });

  test("报告重放只解析一次 Analysis 与 View", async () => {
    const db = createTestAppDatabase();
    const analyses = createAnalysisRepository(db);
    const reports = createReportRepository(db);
    const identity = await createOwned(analyses, "alice@x", spec());
    const report = await reports.create({
      owner: "alice@x",
      name: "组织报告",
      viewId: identity.view.id,
    });
    let viewReads = 0;
    let analysisReads = 0;
    const countingAnalyses: AnalysisRepository = {
      ...analyses,
      getView: async (id) => {
        viewReads += 1;
        return analyses.getView(id);
      },
      getAnalysis: async (id) => {
        analysisReads += 1;
        return analyses.getAnalysis(id);
      },
    };
    const resultView = {
      id: "result",
      columns: [],
      column_roles: {},
      rows: [],
      row_count: 0,
      time: {
        grain: "total" as const,
        coordinates: [{ role: "primary" as const, from: "2026-07", to: "2026-07" }],
        buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
      },
      query_notes: [],
    };
    const service = createReportService({
      reports,
      analyses: countingAnalyses,
      semanticPlanning: {
        plan: async (caller) => ({
          plan: planExecution(spec(), { delivery: "identity" }),
          presentation: {
            type: "table" as const,
          },
          render_decl: {
            type: "table" as const,
          },
          routes: [],
          record_projection_bindings: { views: [] },
          access: semanticAccessStub(caller),
        }),
      },
      presentation,
      usage,
      execution: {
        executeReferenced: async (_caller, current, planned) => ({
          analysis_id: current.analysis.id,
          view_id: current.view.id,
          definition: current.analysis.definition,
          intent: current.view.intent,
          preferences: current.view.preferences,
          presentation: planned.presentation,
          record_projection_bindings: planned.record_projection_bindings,
          payload: {
            analysis_id: current.analysis.id,
            view_id: current.view.id,
            observation_scopes: ["统计范围"],
            data_as_of: "2026-07",
            time_context: [],
            view: resultView,
          },
          fullRowViewBlock: resultView,
          decl: planned.render_decl,
        }),
      },
    });

    expect((await service.runOwned(principal("alice@x"), report.id)).report.id).toBe(report.id);
    expect({ viewReads, analysisReads }).toEqual({ viewReads: 1, analysisReads: 1 });
  });

  test("并发更新由 SQL revision 条件保证只有一方提交", async () => {
    const dbPath = path();
    const firstDb = createTestAppDatabase(dbPath);
    const first = createReportRepository(firstDb);
    const second = createReportRepository(createTestAppDatabase(dbPath));
    const analysis = await createOwned(createAnalysisRepository(firstDb), "alice@x", spec());
    const report = await first.create({
      owner: "alice@x",
      name: "初始",
      viewId: analysis.view.id,
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

  test("每次更新保存更新前的版本，只保留最近 20 版，恢复会追加新 revision", async () => {
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
    const analysis = await createOwned(analyses, "alice@x", spec());
    let current = await reports.create({
      owner: "alice@x",
      name: "版本 1",
      viewId: analysis.view.id,
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
    const analysis = await createOwned(analyses, "alice@x", spec());
    await reports.create({
      owner: "alice@x",
      name: "人数_100%",
      viewId: analysis.view.id,
    });
    await reports.create({
      owner: "alice@x",
      name: "人数汇总",
      viewId: analysis.view.id,
    });
    expect(await reports.listOwned("alice@x", "_100%")).toHaveLength(1);
    expect((await reports.listOwned("alice@x", "_100%"))[0]?.name).toBe("人数_100%");
  });

  test("写入 render_shape 缓存不递增 revision，非当前 view_id 不能覆盖缓存", async () => {
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
    const identity = await createOwned(analyses, "alice@x", spec());
    const saved = await service.save({
      principal: principal("alice@x"),
      viewId: identity.view.id,
      name: "报告",
    });
    await service.cacheRenderShape(saved, "table");
    expect(await reports.get(saved.id)).toMatchObject({
      render_shape: "table",
      revision: 1,
    });
    const next = await createOwned(analyses, "alice@x", spec("next"));
    const updated = await service.update(principal("alice@x"), saved.id, {
      type: "replace_view",
      view_id: next.view.id,
    });
    expect(updated).toMatchObject({ render_shape: null, revision: 2 });
    await service.cacheRenderShape(saved, "kpi");
    expect(await reports.get(saved.id)).toMatchObject({
      render_shape: null,
      revision: 2,
    });
  });
});
