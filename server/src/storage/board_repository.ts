/**
 * 看板存储：一个稳定 uuid 指向一张 24 列网格画布的有序瓦片集。
 * 瓦片 = 拖拽/缩放单元：report 瓦片存 report 引用与网格占格，text 瓦片存行内 Markdown。
 * 存储只存引用与坐标，report 瓦片的 name/presentation_type 由 application service 在载荷期解析。
 * created_by 是唯一维护人；查看与重放的共享权限由 application service 按看板成员关系裁决。
 */
import { randomUUID } from "node:crypto";
import { BOARD_GRID_COLUMNS, BOARD_ID_PATTERN, type Place } from "../contracts/board_contract.js";
import type { SqliteDatabase } from "../sqlite.js";
import { inTransaction } from "./app_database.js";
import type { ReportRepository } from "../ports/report_repository.js";
import {
  BoardConflictError,
  type BoardRecord,
  type BoardRepository,
  type StoredTile,
} from "../ports/board_repository.js";

/** 一张看板的瓦片上限（report + text 合计）。 */
export const MAX_BOARD_TILES = 24;

const MAX_NAME_LENGTH = 50;
const MAX_TEXT_MD_LENGTH = 4000;

function normalizePlace(value: unknown): Place {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("place 应为 { x, y, w, h } 对象");
  }
  const { x, y, w, h } = value as Record<string, unknown>;
  for (const [key, n] of Object.entries({ x, y, w, h })) {
    if (typeof n !== "number" || !Number.isInteger(n)) {
      throw new Error(`place.${key} 应为整数`);
    }
  }
  const place = { x, y, w, h } as Place;
  if (place.x < 0 || place.y < 0) throw new Error("place.x/place.y 不得为负");
  if (place.w < 1 || place.h < 1) throw new Error("place.w/place.h 至少为 1");
  if (place.x + place.w > BOARD_GRID_COLUMNS) {
    throw new Error(`瓦片越出画布：x+w 不得超过 ${BOARD_GRID_COLUMNS} 列`);
  }
  return place;
}

function normalizeTileId(value: unknown): string {
  if (typeof value !== "string" || !BOARD_ID_PATTERN.test(value.trim())) {
    throw new Error("tile_id 应为 uuid");
  }
  return value.trim();
}

export async function normalizeTiles(
  tiles: unknown,
  reports: Pick<ReportRepository, "get">,
  board: { created_by: string },
): Promise<StoredTile[]> {
  if (!Array.isArray(tiles)) throw new Error("tiles 应为瓦片数组");
  const seen = new Set<string>();
  const normalized: StoredTile[] = [];
  for (const raw of tiles) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("瓦片应为对象");
    }
    const tile = raw as Record<string, unknown>;
    const tileId = normalizeTileId(tile.tile_id);
    if (seen.has(tileId)) throw new Error(`瓦片 tile_id 重复：${tileId}`);
    const place = normalizePlace(tile.place);
    if (tile.kind === "report") {
      const reportId = typeof tile.report_id === "string" ? tile.report_id.trim() : "";
      if (!reportId) throw new Error("report 瓦片缺少 report_id");
      // 看板只引用创建者本人的报告；共享看板重放时仍以查看者权限重新编译和执行。
      const report = await reports.get(reportId);
      if (!report) throw new Error(`报告不存在：${reportId}`);
      if (report.owner !== board.created_by) {
        throw new Error(`无权引用他人的报告：${reportId}`);
      }
      normalized.push({ kind: "report", tile_id: tileId, report_id: reportId, place });
    } else if (tile.kind === "text") {
      if (typeof tile.md !== "string") throw new Error("text 瓦片的 md 应为字符串");
      if (tile.md.length > MAX_TEXT_MD_LENGTH) {
        throw new Error(`文本瓦片最长 ${MAX_TEXT_MD_LENGTH} 字`);
      }
      normalized.push({ kind: "text", tile_id: tileId, md: tile.md, place });
    } else {
      throw new Error(`未知的瓦片类型：${String(tile.kind)}`);
    }
    seen.add(tileId);
  }
  if (normalized.length > MAX_BOARD_TILES) {
    throw new Error(`看板最多包含 ${MAX_BOARD_TILES} 块瓦片`);
  }
  return normalized;
}

export function normalizeBoardName(name: unknown): string {
  if (typeof name !== "string") throw new Error("缺少看板名称");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("缺少看板名称");
  if (trimmed.length > MAX_NAME_LENGTH) throw new Error(`名称最长 ${MAX_NAME_LENGTH} 字`);
  return trimmed;
}

function parseStoredTiles(value: string): StoredTile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("board.tiles 不是有效 JSON");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_BOARD_TILES) {
    throw new Error("board.tiles 不是合法瓦片数组");
  }
  return parsed.map((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("board.tiles 包含非法瓦片");
    }
    const tile = raw as Record<string, unknown>;
    const tileId = normalizeTileId(tile.tile_id);
    const place = normalizePlace(tile.place);
    if (tile.kind === "report") {
      if (typeof tile.report_id !== "string" || !tile.report_id.trim()) {
        throw new Error("board.tiles 的 report 瓦片缺少 report_id");
      }
      return { kind: "report", tile_id: tileId, report_id: tile.report_id.trim(), place };
    }
    if (tile.kind === "text" && typeof tile.md === "string") {
      if (tile.md.length > MAX_TEXT_MD_LENGTH) throw new Error("board.tiles 的文本瓦片过长");
      return { kind: "text", tile_id: tileId, md: tile.md, place };
    }
    throw new Error("board.tiles 包含未知瓦片类型");
  });
}

export function createBoardRepository(
  db: SqliteDatabase,
  reports: Pick<ReportRepository, "get">,
): BoardRepository {
  function toRecord(row: {
    id: string;
    name: string;
    tiles: string;
    created_by: string;
    revision: number;
    created_at: string;
    updated_at: string;
  }): BoardRecord {
    return { ...row, tiles: parseStoredTiles(row.tiles) };
  }

  async function create(name: string, createdBy: string): Promise<BoardRecord> {
    const cleanName = normalizeBoardName(name);
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO board (id, name, tiles, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, cleanName, "[]", createdBy, now, now);
    return {
      id,
      name: cleanName,
      tiles: [],
      created_by: createdBy,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
  }

  async function get(id: string): Promise<BoardRecord | null> {
    const rows = db.prepare("SELECT * FROM board WHERE id = ?").all(id) as Parameters<
      typeof toRecord
    >[0][];
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async function list(): Promise<BoardRecord[]> {
    const rows = db.prepare("SELECT * FROM board ORDER BY updated_at DESC").all() as Parameters<
      typeof toRecord
    >[0][];
    return rows.map(toRecord);
  }

  async function update(
    id: string,
    patch: { name?: string; tiles?: unknown },
    ifRevision: number,
  ): Promise<BoardRecord | null> {
    const existing = await get(id);
    if (!existing) return null;
    if (!Number.isInteger(ifRevision) || ifRevision < 1) {
      throw new Error("if_revision 应为正整数");
    }
    if (existing.revision !== ifRevision) {
      throw new BoardConflictError(
        `看板已被更新：期望 revision=${ifRevision}，当前 revision=${existing.revision}；请刷新后重试`,
      );
    }
    const name = patch.name !== undefined ? normalizeBoardName(patch.name) : existing.name;
    const tiles =
      patch.tiles !== undefined
        ? await normalizeTiles(patch.tiles, reports, {
            created_by: existing.created_by,
          })
        : existing.tiles;
    const now = new Date().toISOString();
    let missing = false;
    inTransaction(db, () => {
      const result = db
        .prepare(
          `UPDATE board SET name = ?, tiles = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(name, JSON.stringify(tiles), now, id, ifRevision);
      if (Number(result.changes) !== 1) {
        const latest = db.prepare("SELECT revision FROM board WHERE id = ?").get(id) as
          | { revision: number }
          | undefined;
        if (!latest) {
          missing = true;
          return;
        }
        throw new BoardConflictError(
          `看板已被更新：期望 revision=${ifRevision}，当前 revision=${latest.revision}；请刷新后重试`,
        );
      }
    });
    if (missing) return null;
    return { ...existing, name, tiles, revision: ifRevision + 1, updated_at: now };
  }

  async function remove(id: string): Promise<boolean> {
    return Number(db.prepare("DELETE FROM board WHERE id = ?").run(id).changes) === 1;
  }

  return { create, get, list, update, remove };
}
