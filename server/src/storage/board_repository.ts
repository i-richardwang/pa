/**
 * 瓦片只存引用与网格坐标，report 瓦片的 name/presentation_type 由 application service 组装载荷时解析。
 * 查看与重放权限由 application service 判定。
 */
import { randomUUID } from "node:crypto";
import { BOARD_MUTATION_TILES_SCHEMA } from "../contracts/board_contract.js";
import type { SqliteDatabase } from "../sqlite.js";
import { inTransaction } from "./app_database.js";
import {
  BoardConflictError,
  type BoardRecord,
  type BoardRepository,
  type StoredTile,
} from "../ports/board_repository.js";

function parseStoredTiles(value: string): StoredTile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("board.tiles 不是有效 JSON");
  }
  const checked = BOARD_MUTATION_TILES_SCHEMA.safeParse(parsed);
  if (!checked.success) throw new Error("board.tiles 不是合法瓦片数组");
  return checked.data;
}

export function createBoardRepository(db: SqliteDatabase): BoardRepository {
  function toRecord(row: {
    id: string;
    name: string;
    tiles: string;
    created_by: string;
    archived_at: string | null;
    revision: number;
    created_at: string;
    updated_at: string;
  }): BoardRecord {
    return { ...row, tiles: parseStoredTiles(row.tiles) };
  }

  async function create(name: string, createdBy: string): Promise<BoardRecord> {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO board (id, name, tiles, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, name, "[]", createdBy, now, now);
    return {
      id,
      name,
      tiles: [],
      created_by: createdBy,
      archived_at: null,
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

  async function list(scope: "active" | "all" = "active"): Promise<BoardRecord[]> {
    const where = scope === "active" ? "WHERE archived_at IS NULL" : "";
    const rows = db
      .prepare(`SELECT * FROM board ${where} ORDER BY updated_at DESC`)
      .all() as Parameters<typeof toRecord>[0][];
    return rows.map(toRecord);
  }

  async function update(
    id: string,
    patch: { name?: string; tiles?: StoredTile[] },
    ifRevision: number,
  ): Promise<BoardRecord | null> {
    const existing = await get(id);
    if (!existing) return null;
    if (existing.revision !== ifRevision) {
      throw new BoardConflictError(
        `看板已被更新：期望 revision=${ifRevision}，当前 revision=${existing.revision}；请刷新后重试`,
      );
    }
    const name = patch.name ?? existing.name;
    const tiles = patch.tiles ?? existing.tiles;
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

  async function archive(id: string): Promise<boolean> {
    const result = db
      .prepare("UPDATE board SET archived_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  async function restore(id: string): Promise<boolean> {
    const result = db
      .prepare("UPDATE board SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL")
      .run(id);
    return Number(result.changes) === 1;
  }

  return { create, get, list, update, archive, restore };
}
