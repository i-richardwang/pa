import { describe, expect, test } from "bun:test";
import type { BoardRecord, BoardRepository } from "../ports/board_repository.js";
import type { ReportDocument, ReportService } from "./report_service.js";
import {
  BoardForbiddenError,
  BoardNotFoundError,
  BoardRequestError,
  createBoardService,
} from "./board_service.js";
import { ReportNotFoundError } from "../ports/report_repository.js";

const report = {
  id: "33333333-3333-4333-8333-333333333333",
  owner: "alice@x",
  name: "组织人数",
  analysis_id: "analysis_1",
  view_id: "view_1",
  render_shape: "table",
  archived_at: null,
  revision: 1,
  created_at: "2026-08-13T00:00:00.000Z",
  updated_at: "2026-08-13T00:00:00.000Z",
  view_preferences: {},
  definition: {
    views: [
      {
        id: "result",
        measures: ["measure:active_employee_count"],
        dimensions: [],
        time: { window: { kind: "current_month" } },
      },
    ],
  },
  intent: { type: "table" },
} satisfies ReportDocument;

function harness(initialTiles: BoardRecord["tiles"] = [], reportAccessError?: Error) {
  let board: BoardRecord | null = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "人委会看板",
    tiles: initialTiles,
    created_by: "alice@x",
    revision: 1,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  };
  const updates: Array<{
    patch: Parameters<BoardRepository["update"]>[1];
    revision: number;
  }> = [];
  const repository: BoardRepository = {
    create: async () => board!,
    get: async (id) => (board?.id === id ? board : null),
    list: async () => (board ? [board] : []),
    update: async (_id, patch, revision) => {
      updates.push({ patch, revision });
      if (!board) return null;
      board = {
        ...board,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.tiles !== undefined ? { tiles: patch.tiles } : {}),
        revision: revision + 1,
      };
      return board;
    },
    remove: async () => {
      board = null;
      return true;
    },
  };
  const runCalls: string[] = [];
  const reports = {
    get: async (id: string) => (id === report.id ? report : null),
    ensureOwned: async (id: string, owner: string) => {
      if (reportAccessError) throw reportAccessError;
      if (id !== report.id || owner !== report.owner) {
        throw new ReportNotFoundError("报告不存在或无权访问");
      }
    },
    summary: () => ({ presentation_type: "table" as const }),
    runShared: async (_principal: unknown, id: string) => {
      runCalls.push(id);
      return { report };
    },
  } as unknown as Pick<ReportService, "get" | "ensureOwned" | "summary" | "runShared">;
  const logs: unknown[] = [];
  const service = createBoardService({
    boards: repository,
    reports,
    usage: { log: async (event) => void logs.push(event) },
    newId: () => "22222222-2222-4222-8222-222222222222",
  });
  return { service, updates, logs, runCalls, board: () => board };
}

describe("board application service", () => {
  test("载荷期解析报告摘要，repository 只保留引用", async () => {
    const { service } = harness([
      {
        kind: "report",
        tile_id: "22222222-2222-4222-8222-222222222222",
        report_id: report.id,
        place: { x: 0, y: 0, w: 24, h: 6 },
      },
    ]);
    expect(await service.get("11111111-1111-4111-8111-111111111111")).toMatchObject({
      tiles: [
        {
          report_id: report.id,
          name: "组织人数",
          presentation_type: "table",
          render_shape: "table",
        },
      ],
    });
  });

  test("重复加入幂等；首次加入以调用方 revision 原子写入并记录业务事件", async () => {
    const { service, updates, logs } = harness();
    const input = {
      id: "11111111-1111-4111-8111-111111111111",
      owner: "alice@x",
      reportId: report.id,
      ifRevision: 1,
    };
    expect(await service.addReport(input)).toMatchObject({ added: true, board: { revision: 2 } });
    expect(updates).toEqual([
      {
        revision: 1,
        patch: {
          tiles: [
            {
              kind: "report",
              tile_id: "22222222-2222-4222-8222-222222222222",
              report_id: report.id,
              place: { x: 0, y: 0, w: 24, h: 6 },
            },
          ],
        },
      },
    ]);
    expect(await service.addReport({ ...input, ifRevision: 2 })).toMatchObject({ added: false });
    expect(updates).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  test("写动作集中执行属主校验，共享重放集中执行成员关系校验", async () => {
    const { service, runCalls } = harness();
    await expect(
      service.update("11111111-1111-4111-8111-111111111111", "bob@x", { name: "越权" }, 1),
    ).rejects.toBeInstanceOf(BoardForbiddenError);
    await expect(
      service.runReport(
        { email: "bob@x", roles: ["user"], orgScope: "*" },
        "11111111-1111-4111-8111-111111111111",
        report.id,
      ),
    ).rejects.toBeInstanceOf(BoardNotFoundError);
    expect(runCalls).toEqual([]);
  });

  test("报告引用归属在应用边界校验，基础设施异常不伪装成输入错误", async () => {
    const tile = {
      kind: "report" as const,
      tile_id: "22222222-2222-4222-8222-222222222222",
      report_id: "44444444-4444-4444-8444-444444444444",
      place: { x: 0, y: 0, w: 24, h: 6 },
    };
    await expect(
      harness().service.update(
        "11111111-1111-4111-8111-111111111111",
        "alice@x",
        { tiles: [tile] },
        1,
      ),
    ).rejects.toBeInstanceOf(BoardRequestError);

    const storageError = new Error("SQLITE_BUSY");
    await expect(
      harness([], storageError).service.addReport({
        id: "11111111-1111-4111-8111-111111111111",
        owner: "alice@x",
        reportId: report.id,
        ifRevision: 1,
      }),
    ).rejects.toBe(storageError);
  });
});
