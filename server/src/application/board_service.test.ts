import { describe, expect, test } from "bun:test";
import type { BoardRecord, BoardRepository } from "../ports/board_repository.js";
import type { ReportDocument, ReportService } from "./report_service.js";
import { createBoardService } from "./board_service.js";
import { ForbiddenError, InvalidRequestError, NotFoundError } from "./errors.js";
import { ReportNotFoundError } from "../ports/report_repository.js";
import type { Principal } from "../contracts/principal.js";

const alice: Principal = { email: "alice@x", roles: ["user"], accessScope: { kind: "all" } };
const bob: Principal = { email: "bob@x", roles: ["user"], accessScope: { kind: "all" } };

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
    queries: [
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
    archived_at: null,
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
    list: async () => (board && board.archived_at === null ? [board] : []),
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
    archive: async () => {
      if (!board || board.archived_at !== null) return false;
      board = { ...board, archived_at: "2026-08-24T00:00:00.000Z" };
      return true;
    },
    restore: async () => {
      if (!board || board.archived_at === null) return false;
      board = { ...board, archived_at: null };
      return true;
    },
  };
  const runCalls: string[] = [];
  const reports = {
    get: async (id: string) => (id === report.id ? report : null),
    ensureOwned: async (principal: Principal, id: string) => {
      if (reportAccessError) throw reportAccessError;
      if (id !== report.id || principal.email !== report.owner) {
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
      principal: alice,
      id: "11111111-1111-4111-8111-111111111111",
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
      service.update(bob, "11111111-1111-4111-8111-111111111111", { name: "越权" }, 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.runReport(bob, "11111111-1111-4111-8111-111111111111", report.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(runCalls).toEqual([]);
  });

  test("删除后看板对读写两路都等同不存在，恢复即原样回来", async () => {
    const tile = {
      kind: "report" as const,
      tile_id: "22222222-2222-4222-8222-222222222222",
      report_id: report.id,
      place: { x: 0, y: 0, w: 24, h: 6 },
    };
    const { service, runCalls } = harness([tile]);
    const id = "11111111-1111-4111-8111-111111111111";
    await service.remove(alice, id);

    expect(await service.list()).toEqual([]);
    await expect(service.get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(alice, id, { name: "改名" }, 1)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.runReport(alice, id, report.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(runCalls).toEqual([]);

    expect(await service.restore(alice, id)).toMatchObject({
      id,
      tiles: [{ report_id: report.id }],
    });
    expect(await service.list()).toMatchObject([{ id }]);
    await expect(service.get(id)).resolves.toMatchObject({ id });
  });

  test("只有创建者能恢复自己删除的看板", async () => {
    const { service } = harness();
    const id = "11111111-1111-4111-8111-111111111111";
    await service.remove(alice, id);
    await expect(service.restore(bob, id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("报告引用归属在应用边界校验，基础设施异常不伪装成输入错误", async () => {
    const tile = {
      kind: "report" as const,
      tile_id: "22222222-2222-4222-8222-222222222222",
      report_id: "44444444-4444-4444-8444-444444444444",
      place: { x: 0, y: 0, w: 24, h: 6 },
    };
    await expect(
      harness().service.update(alice, "11111111-1111-4111-8111-111111111111", { tiles: [tile] }, 1),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    const storageError = new Error("SQLITE_BUSY");
    await expect(
      harness([], storageError).service.addReport({
        principal: alice,
        id: "11111111-1111-4111-8111-111111111111",
        reportId: report.id,
        ifRevision: 1,
      }),
    ).rejects.toBe(storageError);
  });
});
