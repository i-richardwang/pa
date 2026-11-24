import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createAnalysisService } from "../application/analysis_service.js";
import { createBoardService } from "../application/board_service.js";
import { createPresentationService } from "../application/presentation_service.js";
import { createReportService } from "../application/report_service.js";
import {
  STRUCTURE_ARGS,
  createBoardRepository,
  createReports,
  createTestAppDatabase,
  createTestUsage,
  dashboardTestDependencies,
  dashboardRoutes,
  freshPath,
  semanticPlanningStub,
} from "../test_support/dashboard.js";
import { semanticAnalysisOf, unexpectedExport } from "../test_support/report.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import {
  ADD_BOARD_ITEM_PAYLOAD_SCHEMA,
  BOARD_PAYLOAD_SCHEMA,
} from "../contracts/board_contract.js";
import { REPLAY_PAYLOAD_SCHEMA } from "../contracts/replay_contract.js";

describe("dashboard board routes", () => {
  test("创建者编辑看板，任意登录用户可按成员关系重放报告", async () => {
    const path = freshPath();
    const db = createTestAppDatabase(path);
    const reportRepository = createReports(db);
    const analysisRepository = createAnalysisRepository(db);
    const fixture = semanticAnalysisOf(STRUCTURE_ARGS, {
      type: "table",
    });
    const analysis = await analysisRepository.create("alice@x", fixture.analysis, fixture.view);
    const report = await reportRepository.create({
      owner: "alice@x",
      name: "组织人数",
      viewId: analysis.view.id,
    });
    const boards = createBoardRepository(db);
    const usage = { log: async () => {} };
    const view = {
      id: "structure",
      columns: ["category_level", "active_employee_count"],
      column_roles: {
        category_level: "dimension" as const,
        active_employee_count: "measure" as const,
      },
      column_time_basis: { active_employee_count: "bucket_end" as const },
      column_formats: { active_employee_count: "number" as const },
      rows: [
        ["P5", 10],
        ["P6", 8],
      ],
      row_count: 2,
      time: {
        grain: "total" as const,
        coordinates: [{ role: "primary" as const, from: "2026-07", to: "2026-07" }],
        buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
      },
      query_notes: [
        {
          member: "test_people_metrics.category_level",
          title: "分类层级",
          text: "分类层级口径",
        },
        {
          member: "test_people_metrics.active_employee_count",
          title: "在职人数",
          text: "在职口径",
        },
      ],
    };
    const analyses = createAnalysisService({
      createDelivery: unexpectedExport,
      repository: analysisRepository,
      plan: semanticPlanningStub.plan,
      execute: async () => ({
        payload: {
          title: "组织人数",
          observation_scopes: ["统计范围"],
          data_as_of: "2026-07",
          time_context: [],
          view,
        },
        fullRowViewBlock: view,
        decl: { type: "table" as const },
      }),
      usage,
    });
    const presentation = createPresentationService();
    const reportService = createReportService({
      reports: reportRepository,
      analyses: analysisRepository,
      execution: analyses,
      presentation,
      semanticPlanning: semanticPlanningStub,
      usage,
    });
    const boardService = createBoardService({
      boards,
      reports: reportService,
      usage,
      newId: randomUUID,
    });
    const recordProjectionCalls: unknown[][] = [];
    const app = (email: string) =>
      dashboardRoutes(
        dashboardTestDependencies({ email, name: email }, path, {
          usage: createTestUsage(db),
          html: async () => "",
          reportService,
          boardService,
          analyses,
          presentation,
          records: {
            runBoard: async (...args: unknown[]) => {
              recordProjectionCalls.push(args);
              return {
                metric_id: "measure:active_employee_count",
                metric_title: "在职人数",
                columns: ["工号"],
                column_keys: ["employee_id"],
                rows: [["e_01"]],
                offset: 0,
                has_more: false,
                data_as_of: "2026-07",
                data_changed: false,
              };
            },
          } as never,
        }),
      );
    const alice = app("alice@x");
    const bob = app("bob@x");
    const json = (body: unknown) => ({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const created = BOARD_PAYLOAD_SCHEMA.parse(
      await (
        await alice.request("/api/boards", { method: "POST", ...json({ name: "人委会看板" }) })
      ).json(),
    );
    const added = await alice.request(`/api/boards/${created.id}/items`, {
      method: "POST",
      ...json({ report_id: report.id, if_revision: created.revision }),
    });
    expect(added.status).toBe(200);
    expect(ADD_BOARD_ITEM_PAYLOAD_SCHEMA.parse(await added.json())).toMatchObject({
      added: true,
      board: { tiles: [{ kind: "report", report_id: report.id, name: "组织人数" }] },
    });

    const stale = await alice.request(`/api/boards/${created.id}`, {
      method: "PATCH",
      ...json({ name: "过期写入", if_revision: created.revision }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "conflict", message: expect.stringContaining("请刷新后重试") },
    });

    expect((await bob.request(`/api/boards/${created.id}`)).status).toBe(200);
    expect(
      (
        await bob.request(`/api/boards/${created.id}`, {
          method: "PATCH",
          ...json({ name: "越权修改", if_revision: created.revision + 1 }),
        })
      ).status,
    ).toBe(403);
    const replay = await bob.request(`/api/boards/${created.id}/items/${report.id}/replay`);
    expect(replay.status).toBe(200);
    const sharedReplay = REPLAY_PAYLOAD_SCHEMA.parse(await replay.json());
    expect(sharedReplay).toMatchObject({
      caller: "alice@x",
      analysis_id: analysis.analysis.id,
      view_id: analysis.view.id,
      revision: 1,
      record_projection_bindings: { views: [] },
      analysis: analysis.analysis.definition,
      view: analysis.view.intent,
      payload: {
        analysis_id: analysis.analysis.id,
        view_id: analysis.view.id,
      },
    });
    const recordProjectionBody = {
      revision: 1,
      result_view_id: "structure",
      metric_id: "measure:active_employee_count",
      coordinates: [],
      time_coordinate: { from: "2026-06", to: "2026-06" },
      data_as_of: "2026-07",
    };
    const time = encodeURIComponent(
      JSON.stringify({
        window: { kind: "current_month", month: "2026-06" },
      }),
    );
    const projected = await bob.request(
      `/api/boards/${created.id}/items/${report.id}/records?time=${time}`,
      { method: "POST", ...json(recordProjectionBody) },
    );
    expect(projected.status).toBe(200);
    expect(await projected.json()).toMatchObject({ rows: [["e_01"]] });
    expect(recordProjectionCalls).toEqual([
      [
        expect.objectContaining({ email: "bob@x" }),
        created.id,
        report.id,
        expect.objectContaining(recordProjectionBody),
        {
          window: { kind: "current_month", month: "2026-06" },
        },
      ],
    ]);
    expect(await reportRepository.get(report.id)).toMatchObject({ render_shape: null });

    const foreignPointer = await bob.request("/api/reports", {
      method: "POST",
      ...json({ view_id: analysis.view.id, name: "错误副本" }),
    });
    expect(foreignPointer.status).toBe(404);

    const forked = await bob.request("/api/analyses", {
      method: "POST",
      ...json({
        analysis: sharedReplay.analysis,
        view: sharedReplay.view,
        view_preferences: sharedReplay.view_preferences,
      }),
    });
    expect(forked.status).toBe(200);
    const forkedReplay = REPLAY_PAYLOAD_SCHEMA.parse(await forked.json());
    expect(forkedReplay.analysis_id).not.toBe(analysis.analysis.id);
    const copied = await bob.request("/api/reports", {
      method: "POST",
      ...json({ view_id: forkedReplay.view_id, name: "我的组织人数" }),
    });
    expect(copied.status).toBe(201);
    expect((await analysisRepository.getAnalysis(forkedReplay.analysis_id))?.owner).toBe("bob@x");

    expect(
      (await alice.request(`/api/boards/${created.id}/items/${report.id}/replay`)).status,
    ).toBe(200);
    expect(await reportRepository.get(report.id)).toMatchObject({ render_shape: "table" });

    expect((await alice.request(`/api/boards/${created.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect((await alice.request(`/api/boards/${created.id}`)).status).toBe(404);
    expect(
      (await alice.request(`/api/boards/${created.id}/items/${report.id}/replay`)).status,
    ).toBe(404);
    expect(
      (await bob.request(`/api/boards/${created.id}/restore`, { method: "POST" })).status,
    ).toBe(403);
    const restored = await alice.request(`/api/boards/${created.id}/restore`, { method: "POST" });
    expect(restored.status).toBe(200);
    expect(BOARD_PAYLOAD_SCHEMA.parse(await restored.json())).toMatchObject({
      id: created.id,
      tiles: [{ kind: "report", report_id: report.id }],
    });
    expect((await alice.request(`/api/boards/${created.id}`)).status).toBe(200);
  });
});
