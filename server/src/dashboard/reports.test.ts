import { describe, expect, test } from "bun:test";
import { createAnalysisService } from "../application/analysis_service.js";
import { createPresentationService } from "../application/presentation_service.js";
import { createReportService } from "../application/report_service.js";
import { RecordProjectionRequestError } from "../application/record_projection_service.js";
import {
  STRUCTURE_ARGS,
  createReports,
  createTestAppDatabase,
  createTestUsage,
  dashboardRoutes,
  freshPath,
  semanticPlanningStub,
} from "../test_support/dashboard.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { semanticSpecOf } from "../test_support/report.js";
import { REPLAY_PAYLOAD_SCHEMA } from "../contracts/replay_contract.js";
import {
  REPORT_DETAIL_SCHEMA,
  REPORT_ROW_PAYLOAD_SCHEMA,
  REPORTS_PAYLOAD_SCHEMA,
} from "../contracts/report_contract.js";
import { SemanticQueryIncompatibleError } from "../engine/semantic_analysis_compiler.js";
import type { SemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";

const emptyStructureView = {
  id: "structure",
  columns: ["category_level", "active_employee_count"],
  column_roles: { category_level: "dimension" as const, active_employee_count: "measure" as const },
  column_formats: { active_employee_count: "number" as const },
  rows: [],
  row_count: 0,
  time: {
    grain: "total" as const,
    coordinates: [{ role: "primary" as const, from: "2026-07", to: "2026-07" }],
    buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
  },
  query_notes: [],
};

const result = {
  payload: {
    title: "组织人数",
    default_population_scope: "统计范围",
    data_as_of: "2026-07",
    time_context: [],
    view: emptyStructureView,
  },
  fullRowViewBlock: emptyStructureView,
  decl: { type: "table" as const, y: [] },
};

const emptyChartResult = {
  ...result,
  decl: {
    type: "bar" as const,
    x: "test_people_metrics.category_level",
    y: ["test_people_metrics.active_employee_count"],
  },
};

describe("dashboard report routes", () => {
  const recordProjectionBody = {
    revision: 1,
    view_id: "result",
    metric_id: "measure:active_employee_count",
    coordinates: [],
    time_coordinate: { from: "2026-07", to: "2026-07" },
    data_as_of: "2026-07",
  };

  test("明细路由只返回业务错误，不向浏览器泄漏模型或引擎异常", async () => {
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase()),
      html: async () => "",
      records: {
        runReport: async () => {
          throw new Error(
            "Binder Error: test_people_metrics.employee_name not found in generated SQL",
          );
        },
      } as never,
    });
    const response = await app.request("/api/reports/report_1/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recordProjectionBody),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "人员明细暂时无法加载，请稍后重试",
    });
  });

  test("明细业务校验错误保留可执行改法", async () => {
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase()),
      html: async () => "",
      records: {
        runReport: async () => {
          throw new RecordProjectionRequestError("当前指标不提供人员明细");
        },
      } as never,
    });
    const response = await app.request("/api/reports/report_1/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recordProjectionBody),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "当前指标不提供人员明细" });
  });

  test("报告列表读取失败时返回统一执行错误", async () => {
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase()),
      html: async () => "",
      reportService: {
        listOwned: async () => {
          throw new Error("报告规格无法读取");
        },
      } as never,
    });

    const response = await app.request("/api/reports");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "报告规格无法读取" });
  });

  test("从本人 analysis handle 保存、列出、查看并重放报告", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const usage = { log: async () => {} };
    const analyses = createAnalysisService({
      repository,
      compile: semanticPlanningStub.compile,
      execute: async () => result,
      usage,
    });
    const presentation = createPresentationService();
    const reportService = createReportService({
      reports,
      analyses: repository,
      execution: analyses,
      presentation,
      semanticPlanning: semanticPlanningStub,
      usage,
    });
    const handle = await repository.create("alice@x", semanticSpecOf(STRUCTURE_ARGS));
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      analyses,
      reportService,
      presentation,
    });

    const createdResponse = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis_id: handle.id, name: "组织人数报告" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = REPORT_ROW_PAYLOAD_SCHEMA.parse(await createdResponse.json());
    expect(created.revision).toBe(1);
    expect(created.analysis_id).toBe(handle.id);

    expect(
      REPORTS_PAYLOAD_SCHEMA.parse(await (await app.request("/api/reports")).json()),
    ).toMatchObject({
      total: 1,
      rows: [{ id: created.id, name: "组织人数报告", result_view_id: "structure" }],
    });
    expect((await app.request(`/api/reports/${created.id}`)).status).toBe(200);
    expect(
      REPORT_DETAIL_SCHEMA.parse(await (await app.request(`/api/reports/${created.id}`)).json()),
    ).toMatchObject({
      owner: "alice@x",
      spec: semanticSpecOf(STRUCTURE_ARGS),
    });
    const replayed = await app.request(`/api/reports/${created.id}/replay`);
    expect(replayed.status).toBe(200);
    expect(REPLAY_PAYLOAD_SCHEMA.parse(await replayed.json())).toMatchObject({
      caller: "alice@x",
      analysis_id: handle.id,
      payload: { analysis_id: handle.id, title: "组织人数" },
    });
  });

  test("语义草稿由服务端规划并原子保存，重放时按当前身份重新规划", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const presentation = createPresentationService();
    const usage = { log: async () => {} };
    const analyses = createAnalysisService({
      repository,
      compile: semanticPlanningStub.compile,
      execute: async () => emptyChartResult,
      usage,
    });
    const semanticSpec = {
      version: 2 as const,
      analysis: {
        views: [
          {
            id: "structure",
            measures: ["measure:active_employee_count"],
            dimensions: ["dimension:category_level"],
            time: {
              window: { kind: "current_month" as const, month: "2026-07" },
            },
          },
        ],
      },
      presentation: {
        type: "bar" as const,
        category: "dimension:category_level",
        series: ["measure:active_employee_count"],
      },
    };
    const initialSemanticSpec = {
      ...semanticSpec,
      presentation: { type: "table" as const },
    };
    const compiledPresentation = {
      type: "bar" as const,
      x: "test_people_metrics.category_level",
      y: ["test_people_metrics.active_employee_count"],
    };
    const plannedFor: string[] = [];
    const semanticPlanning = {
      compile: async (principal: { email: string }, candidate: SemanticAnalysisSpec) => {
        plannedFor.push(principal.email);
        if (candidate.analysis.title === "不兼容") {
          throw new SemanticQueryIncompatibleError("所选业务字段无法安全组合", [
            {
              status: "incompatible",
              view_id: "structure",
              reason: "所选业务字段无法安全组合",
            },
          ]);
        }
        return {
          plan: planExecution(STRUCTURE_ARGS),
          presentation: compiledPresentation,
          routes: [{ status: "direct" as const, view_id: "structure" }],
          record_projection_bindings: { views: [] },
        };
      },
    };
    const reportService = createReportService({
      reports,
      analyses: repository,
      execution: analyses,
      presentation,
      semanticPlanning,
      usage,
    });
    const initialAnalysis = await repository.create("alice@x", initialSemanticSpec);
    const report = await reports.create({
      owner: "alice@x",
      name: "待更新",
      analysisId: initialAnalysis.id,
    });
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      analyses,
      reportService,
      presentation,
      semanticPlanning,
    });

    const preview = await app.request("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: semanticSpec }),
    });
    expect(preview.status).toBe(200);
    const previewPayload = REPLAY_PAYLOAD_SCHEMA.parse(await preview.json());
    expect(previewPayload).toMatchObject({
      spec: semanticSpec,
      presentation_notes: [
        {
          view_id: "structure",
          kind: "empty_result",
          note: expect.stringContaining("结果为空"),
        },
      ],
    });

    const incompatible = await app.request("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: {
          ...semanticSpec,
          analysis: { ...semanticSpec.analysis, title: "不兼容" },
        },
      }),
    });
    expect(incompatible.status).toBe(400);
    expect(await incompatible.json()).toEqual({
      error: "所选业务字段无法安全组合",
      routes: [
        {
          status: "incompatible",
          view_id: "structure",
          reason: "所选业务字段无法安全组合",
        },
      ],
    });

    const saved = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: {
          type: "replace_analysis",
          analysis_id: previewPayload.analysis_id,
          name: "语义报告",
        },
        if_revision: report.revision,
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      name: "语义报告",
      revision: 2,
      spec: semanticSpec,
    });
    expect((await reports.get(report.id))?.analysis_id).toBe(previewPayload.analysis_id);
    expect((await reports.listRevisions(report.id, "alice@x"))[0].analysis_id).toBe(
      initialAnalysis.id,
    );

    const replayed = await app.request(`/api/reports/${report.id}/replay`);
    expect(replayed.status).toBe(200);
    expect(REPLAY_PAYLOAD_SCHEMA.parse(await replayed.json())).toMatchObject({
      spec: semanticSpec,
    });
    expect(plannedFor).toEqual(["alice@x", "alice@x", "alice@x"]);
  });

  test("派生报告通过新 Analysis 指针与名称原子更新", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const logs: Array<{ args: unknown }> = [];
    const usage = {
      log: async (entry: { args: unknown }) => {
        logs.push(entry);
      },
    };
    const analyses = createAnalysisService({
      repository,
      compile: semanticPlanningStub.compile,
      execute: async () => result,
      usage,
    });
    const presentation = createPresentationService();
    const reportService = createReportService({
      reports,
      analyses: repository,
      execution: analyses,
      presentation,
      semanticPlanning: semanticPlanningStub,
      usage,
    });
    const derivedAnalysis = {
      ...STRUCTURE_ARGS,
      views: [
        STRUCTURE_ARGS.views[0],
        {
          id: "summary",
          view_title: "汇总",
          from: ["structure"],
          columns: [{ col: "measure:active_employee_count", source: "structure" }],
        },
      ],
    };
    const initial = await repository.create("alice@x", semanticSpecOf(derivedAnalysis));
    const report = await reports.create({
      owner: "alice@x",
      name: "含派生汇总",
      analysisId: initial.id,
    });
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      analyses,
      reportService,
      presentation,
    });

    const next = await repository.create("alice@x", semanticSpecOf(STRUCTURE_ARGS));
    const represented = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: {
          type: "replace_analysis",
          name: "派生报告新名",
          analysis_id: next.id,
        },
        if_revision: report.revision,
      }),
    });
    expect(represented.status).toBe(200);
    expect(await represented.json()).toMatchObject({
      name: "派生报告新名",
      revision: 2,
    });
    expect(logs.at(-1)?.args).toMatchObject({
      source: "editor",
      action: "replace_analysis",
      if_revision: report.revision,
    });
  });

  test("owner 可经 PATCH 修改名称与呈现，CAS 冲突不静默覆盖", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const presentation = createPresentationService();
    const reportService = createReportService({
      reports,
      analyses: repository,
      execution: createAnalysisService({
        repository,
        compile: semanticPlanningStub.compile,
        execute: async () => result,
        usage: { log: async () => {} },
      }),
      presentation,
      semanticPlanning: semanticPlanningStub,
      usage: { log: async () => {} },
    });
    const initial = await repository.create("alice@x", semanticSpecOf(STRUCTURE_ARGS));
    const report = await reports.create({
      owner: "alice@x",
      name: "原名",
      analysisId: initial.id,
    });
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      reportService,
    });

    const renamed = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { type: "rename", name: "新名称" },
        if_revision: 1,
      }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "新名称", revision: 2 });

    const chartSpec = {
      ...semanticSpecOf(STRUCTURE_ARGS),
      presentation: {
        type: "bar" as const,
        category: "test_people_metrics.category_level",
        series: ["test_people_metrics.active_employee_count"],
      },
    };
    const chartAnalysis = await repository.create("alice@x", chartSpec);
    const updated = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: {
          type: "replace_analysis",
          analysis_id: chartAnalysis.id,
        },
        if_revision: 2,
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as {
      revision: number;
      spec: { presentation: unknown };
    };
    expect(body.revision).toBe(3);
    expect(body.spec.presentation).toMatchObject({ type: "bar" });
    expect((await reports.get(report.id))?.analysis_id).toBe(chartAnalysis.id);

    const conflict = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { type: "rename", name: "覆盖" },
        if_revision: 2,
      }),
    });
    expect(conflict.status).toBe(409);

    const history = await app.request(`/api/reports/${report.id}/revisions`);
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      rows: [
        { revision: 2, name: "新名称", saved_by: "alice@x" },
        { revision: 1, name: "原名", saved_by: "alice@x" },
      ],
    });
    const restored = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { type: "restore", revision: 1 },
        if_revision: 3,
      }),
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ name: "原名", revision: 4 });

    const archived = await app.request(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { type: "archive" },
        if_revision: 4,
      }),
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ name: "原名", revision: 5 });
    expect(REPORTS_PAYLOAD_SCHEMA.parse(await (await app.request("/api/reports")).json())).toEqual({
      rows: [],
      total: 0,
    });
    expect((await app.request(`/api/reports/${report.id}`)).status).toBe(200);
  });

  test("analysis handle 和报告严格按属主隔离", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const presentation = createPresentationService();
    const analyses = createAnalysisService({
      repository,
      compile: semanticPlanningStub.compile,
      execute: async () => result,
      usage: { log: async () => {} },
    });
    const reportService = createReportService({
      reports,
      analyses: repository,
      execution: analyses,
      presentation,
      semanticPlanning: semanticPlanningStub,
      usage: { log: async () => {} },
    });
    const bob = await repository.create("bob@x", semanticSpecOf(STRUCTURE_ARGS));
    const bobReport = await reports.create({
      owner: "bob@x",
      name: "Bob 报告",
      analysisId: bob.id,
    });
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice", role: "admin" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      reportService,
    });
    expect(
      (
        await app.request("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis_id: bob.id, name: "越权报告" }),
        })
      ).status,
    ).toBe(400);
    expect((await app.request(`/api/reports/${bobReport.id}`)).status).toBe(404);
    expect((await app.request(`/api/reports/${bobReport.id}/replay`)).status).toBe(404);
  });

  test("报告存在但执行失败时返回上游错误而不是伪装成 404", async () => {
    const path = freshPath();
    const repository = createAnalysisRepository(createTestAppDatabase(path));
    const reports = createReports(createTestAppDatabase(path));
    const analysis = await repository.create("alice@x", semanticSpecOf(STRUCTURE_ARGS));
    const report = await reports.create({
      owner: "alice@x",
      name: "执行失败报告",
      analysisId: analysis.id,
    });
    const analyses = createAnalysisService({
      repository,
      compile: semanticPlanningStub.compile,
      execute: async () => {
        throw new Error("Cube 暂不可用");
      },
      usage: { log: async () => {} },
    });
    const presentation = createPresentationService();
    const app = dashboardRoutes({
      auth: {
        api: {
          getSession: async () => ({
            user: { email: "alice@x", name: "Alice" },
          }),
        },
      },
      usage: createTestUsage(createTestAppDatabase(path)),
      html: async () => "",
      reportService: createReportService({
        reports,
        analyses: repository,
        execution: analyses,
        presentation,
        semanticPlanning: semanticPlanningStub,
        usage: { log: async () => {} },
      }),
    });
    const response = await app.request(`/api/reports/${report.id}/replay`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Cube 暂不可用" });
  });
});
