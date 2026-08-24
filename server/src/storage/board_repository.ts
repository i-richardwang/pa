/**
 * 看板存储：一个稳定 uuid 指向一张 24 列网格画布的有序瓦片集。
 * 存储只存引用与坐标，report 瓦片的 name/presentation_type 由 application service 在载荷期解析。
 * created_by 是唯一维护人；查看与重放的共享权限由 application service 按看板成员关系裁决。
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

  async function remove(id: string): Promise<boolean> {
    return Number(db.prepare("DELETE FROM board WHERE id = ?").run(id).changes) === 1;
  }

  return { create, get, list, update, remove };
}
