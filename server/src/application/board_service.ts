import type { Principal } from "../engine/cube_security.js";
import type {
  BoardPayload,
  BoardRow,
  BoardTile,
  UpdateBoardBody,
} from "../contracts/board_contract.js";
import { BOARD_ID_PATTERN } from "../contracts/board_contract.js";
import { bottomPlace } from "./board_layout.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";
import {
  BoardConflictError,
  type BoardRecord,
  type BoardRepository,
  type StoredTile,
} from "../ports/board_repository.js";
import type { ReportService } from "./report_service.js";

export class BoardRequestError extends Error {}
export class BoardNotFoundError extends Error {}
export class BoardForbiddenError extends Error {}
export class BoardRevisionConflictError extends Error {}

type BoardUsageEvent = {
  caller: string;
  tool: "board";
  title: string;
  args: unknown;
  outcome: "ok";
  duration_ms: number;
};

type BoardReportService = Pick<ReportService, "get" | "resolveOwned" | "summary" | "runShared">;

/** 看板用例边界：属主、成员关系、报告引用、版本写入和载荷装配只在这里编排。 */
export function createBoardService(deps: {
  boards: BoardRepository;
  reports: BoardReportService;
  usage: { log(event: BoardUsageEvent): Promise<void> };
  newId: () => string;
}) {
  async function document(record: BoardRecord): Promise<BoardPayload> {
    return {
      id: record.id,
      name: record.name,
      created_by: record.created_by,
      revision: record.revision,
      updated_at: record.updated_at,
      tiles: await Promise.all(
        record.tiles.map(async (tile): Promise<BoardTile> => {
          if (tile.kind === "text") return tile;
          const report = await deps.reports.get(tile.report_id);
          if (!report) throw new Error(`看板引用的报告不存在：${tile.report_id}`);
          return {
            ...tile,
            name: report.name,
            presentation_type: deps.reports.summary(report).presentation_type,
            render_shape: report.render_shape,
          };
        }),
      ),
    };
  }

  function assertId(id: string): void {
    if (!BOARD_ID_PATTERN.test(id)) throw new BoardRequestError("无效的看板 id");
  }

  async function owned(id: string, owner: string): Promise<BoardRecord> {
    assertId(id);
    const board = await deps.boards.get(id);
    if (!board) throw new BoardNotFoundError("看板不存在");
    if (board.created_by !== owner) {
      throw new BoardForbiddenError("只有创建者可以修改这个看板");
    }
    return board;
  }

  async function log(owner: string, title: string, args: unknown): Promise<void> {
    await deps.usage.log({
      caller: owner,
      tool: "board",
      title,
      args,
      outcome: "ok",
      duration_ms: 0,
    });
  }

  async function persistUpdate(
    id: string,
    patch: { name?: string; tiles?: unknown },
    ifRevision: number,
  ): Promise<BoardRecord | null> {
    try {
      return await deps.boards.update(id, patch, ifRevision);
    } catch (error) {
      if (error instanceof BoardConflictError) {
        throw new BoardRevisionConflictError(error.message);
      }
      throw error;
    }
  }

  async function list(): Promise<BoardRow[]> {
    return (await deps.boards.list()).map((record) => ({
      id: record.id,
      name: record.name,
      count: record.tiles.filter((tile) => tile.kind === "report").length,
      created_by: record.created_by,
      updated_at: record.updated_at,
    }));
  }

  async function get(id: string): Promise<BoardPayload> {
    assertId(id);
    const board = await deps.boards.get(id);
    if (!board) throw new BoardNotFoundError("看板不存在");
    return document(board);
  }

  async function create(name: string, owner: string): Promise<BoardPayload> {
    const board = await deps.boards.create(name, owner);
    await log(owner, `新建看板：${board.name}`, {
      action: "create",
      id: board.id,
      name: board.name,
    });
    return document(board);
  }

  async function update(
    id: string,
    owner: string,
    patch: Pick<UpdateBoardBody, "name" | "tiles">,
    ifRevision: number,
  ): Promise<BoardPayload> {
    const current = await owned(id, owner);
    const updated = await persistUpdate(
      current.id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.tiles !== undefined ? { tiles: patch.tiles } : {}),
      },
      ifRevision,
    );
    if (!updated) throw new BoardNotFoundError("看板不存在");
    await log(owner, `修改看板：${updated.name}`, {
      action: "update",
      id: updated.id,
      ...(patch.name !== undefined ? { name: updated.name } : {}),
      ...(patch.tiles !== undefined ? { tiles: updated.tiles } : {}),
    });
    return document(updated);
  }

  async function addReport(input: {
    id: string;
    owner: string;
    reportId: string;
    ifRevision: number;
  }): Promise<{ added: boolean; board: BoardPayload }> {
    const board = await owned(input.id, input.owner);
    const reportId = input.reportId.trim();
    if (!reportId) throw new BoardRequestError("缺少报告标识");
    if (board.tiles.some((tile) => tile.kind === "report" && tile.report_id === reportId)) {
      return { added: false, board: await document(board) };
    }
    try {
      await deps.reports.resolveOwned(reportId, input.owner);
    } catch {
      throw new BoardRequestError(`报告不存在或无权访问：${reportId}`);
    }
    const place = bottomPlace(board.tiles);
    const tile: StoredTile = {
      kind: "report",
      tile_id: deps.newId(),
      report_id: reportId,
      place,
    };
    const updated = await persistUpdate(
      board.id,
      { tiles: [...board.tiles, tile] },
      input.ifRevision,
    );
    if (!updated) throw new BoardNotFoundError("看板不存在");
    await log(input.owner, `加入看板：${updated.name}`, {
      action: "add_item",
      id: updated.id,
      report_id: reportId,
    });
    return { added: true, board: await document(updated) };
  }

  async function remove(id: string, owner: string): Promise<void> {
    const board = await owned(id, owner);
    await deps.boards.remove(board.id);
    await log(owner, `删除看板：${board.name}`, {
      action: "delete",
      id: board.id,
      name: board.name,
    });
  }

  async function runReport(
    principal: Principal,
    boardId: string,
    reportId: string,
    timeOverride?: TimeIntent,
  ) {
    const board = await deps.boards.get(boardId);
    const linked = board?.tiles.some(
      (tile) => tile.kind === "report" && tile.report_id === reportId,
    );
    if (!linked) throw new BoardNotFoundError("看板或报告不存在");
    return deps.reports.runShared(principal, reportId, timeOverride);
  }

  return { list, get, create, update, addReport, remove, runReport };
}

export type BoardService = ReturnType<typeof createBoardService>;
