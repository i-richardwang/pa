import type { Principal } from "../contracts/principal.js";
import { REPORT_ID_SCHEMA } from "../contracts/report_identity.js";
import type {
  BoardPayload,
  BoardRow,
  BoardTile,
  BoardMutationTile,
  UpdateBoardBody,
} from "../contracts/board_contract.js";
import {
  BOARD_ID_SCHEMA,
  BOARD_NAME_SCHEMA,
  MAX_BOARD_NAME_LENGTH,
} from "../contracts/board_contract.js";
import { bottomPlace } from "./board_layout.js";
import type { TimeIntent } from "../semantic_core/time_contract.js";
import {
  BoardConflictError,
  type BoardRecord,
  type BoardRepository,
  type StoredTile,
} from "../ports/board_repository.js";
import type { ReportService } from "./report_service.js";
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "./errors.js";
import { ReportNotFoundError } from "../ports/report_repository.js";
import type { UsageService } from "./usage_service.js";

type BoardReportService = Pick<ReportService, "get" | "ensureOwned" | "summary" | "runShared">;

/** 看板的属主校验、成员关系、报告引用、版本写入和载荷组装都只在这里处理。 */
export function createBoardService(deps: {
  boards: BoardRepository;
  reports: BoardReportService;
  usage: Pick<UsageService, "log">;
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
    if (!BOARD_ID_SCHEMA.safeParse(id).success) throw new InvalidRequestError("无效的看板 id");
  }

  function boardName(name: string): string {
    const parsed = BOARD_NAME_SCHEMA.safeParse(name);
    if (!parsed.success) {
      throw new InvalidRequestError(`看板名称不能为空且最长 ${MAX_BOARD_NAME_LENGTH} 个字符`);
    }
    return parsed.data;
  }

  function assertRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new InvalidRequestError("if_revision 应为正整数");
    }
  }

  async function storedTiles(
    tiles: readonly BoardMutationTile[],
    principal: Principal,
  ): Promise<StoredTile[]> {
    const reportIds = [
      ...new Set(tiles.flatMap((tile) => (tile.kind === "report" ? [tile.report_id] : []))),
    ];
    for (const reportId of reportIds) {
      try {
        await deps.reports.ensureOwned(principal, reportId);
      } catch (error) {
        if (error instanceof ReportNotFoundError) {
          throw new InvalidRequestError(`报告不存在或无权访问：${reportId}`);
        }
        throw error;
      }
    }
    return tiles.map((tile) =>
      tile.kind === "report"
        ? {
            kind: "report",
            tile_id: tile.tile_id,
            report_id: tile.report_id,
            place: tile.place,
          }
        : { kind: "text", tile_id: tile.tile_id, md: tile.md, place: tile.place },
    );
  }

  /** 已归档的看板在读写时按不存在处理，只有 restore 能访问。 */
  async function live(id: string): Promise<BoardRecord> {
    assertId(id);
    const board = await deps.boards.get(id);
    if (!board || board.archived_at !== null) throw new NotFoundError("看板不存在");
    return board;
  }

  function creatorOnly(board: BoardRecord, principal: Principal, action: string): BoardRecord {
    if (board.created_by !== principal.email) {
      throw new ForbiddenError(`只有创建者可以${action}这个看板`);
    }
    return board;
  }

  async function owned(id: string, principal: Principal): Promise<BoardRecord> {
    return creatorOnly(await live(id), principal, "修改");
  }

  async function log(owner: string, title: string): Promise<void> {
    await deps.usage.log({
      caller: owner,
      tool: "board",
      title,
      outcome: "ok",
      duration_ms: 0,
    });
  }

  async function persistUpdate(
    id: string,
    patch: { name?: string; tiles?: StoredTile[] },
    ifRevision: number,
  ): Promise<BoardRecord | null> {
    try {
      return await deps.boards.update(id, patch, ifRevision);
    } catch (error) {
      if (error instanceof BoardConflictError) {
        throw new ConflictError(error.message);
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
    return document(await live(id));
  }

  async function create(principal: Principal, name: string): Promise<BoardPayload> {
    const board = await deps.boards.create(boardName(name), principal.email);
    await log(principal.email, `新建看板：${board.name}`);
    return document(board);
  }

  async function update(
    principal: Principal,
    id: string,
    patch: Pick<UpdateBoardBody, "name" | "tiles">,
    ifRevision: number,
  ): Promise<BoardPayload> {
    assertRevision(ifRevision);
    const current = await owned(id, principal);
    const updated = await persistUpdate(
      current.id,
      {
        ...(patch.name !== undefined ? { name: boardName(patch.name) } : {}),
        ...(patch.tiles !== undefined ? { tiles: await storedTiles(patch.tiles, principal) } : {}),
      },
      ifRevision,
    );
    if (!updated) throw new NotFoundError("看板不存在");
    await log(principal.email, `修改看板：${updated.name}`);
    return document(updated);
  }

  async function addReport(input: {
    principal: Principal;
    id: string;
    reportId: string;
    ifRevision: number;
  }): Promise<{ added: boolean; board: BoardPayload }> {
    assertRevision(input.ifRevision);
    const board = await owned(input.id, input.principal);
    const reportId = input.reportId.trim();
    if (!REPORT_ID_SCHEMA.safeParse(reportId).success) {
      throw new InvalidRequestError("报告标识无效");
    }
    if (board.tiles.some((tile) => tile.kind === "report" && tile.report_id === reportId)) {
      return { added: false, board: await document(board) };
    }
    try {
      await deps.reports.ensureOwned(input.principal, reportId);
    } catch (error) {
      if (error instanceof ReportNotFoundError) {
        throw new InvalidRequestError(`报告不存在或无权访问：${reportId}`);
      }
      throw error;
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
    if (!updated) throw new NotFoundError("看板不存在");
    await log(input.principal.email, `加入看板：${updated.name}`);
    return { added: true, board: await document(updated) };
  }

  async function remove(principal: Principal, id: string): Promise<void> {
    const board = await owned(id, principal);
    await deps.boards.archive(board.id);
    await log(principal.email, `删除看板：${board.name}`);
  }

  async function restore(principal: Principal, id: string): Promise<BoardPayload> {
    assertId(id);
    const board = await deps.boards.get(id);
    if (!board) throw new NotFoundError("看板不存在");
    creatorOnly(board, principal, "恢复");
    await deps.boards.restore(board.id);
    await log(principal.email, `恢复看板：${board.name}`);
    return document({ ...board, archived_at: null });
  }

  async function runReport(
    principal: Principal,
    boardId: string,
    reportId: string,
    timeOverride?: TimeIntent,
  ) {
    const board = await deps.boards.get(boardId);
    const linked =
      board?.archived_at === null &&
      board.tiles.some((tile) => tile.kind === "report" && tile.report_id === reportId);
    if (!linked) throw new NotFoundError("看板或报告不存在");
    return deps.reports.runShared(principal, reportId, timeOverride);
  }

  return { list, get, create, update, addReport, remove, restore, runReport };
}

export type BoardService = ReturnType<typeof createBoardService>;
