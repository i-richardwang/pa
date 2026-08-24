import { randomUUID } from "node:crypto";
import { RENDER_SHAPE_SCHEMA, type RenderShape } from "../presentation_core/render_shape.js";
import type { SqliteDatabase } from "../sqlite.js";
import { inTransaction } from "./app_database.js";
import {
  ReportConflictError,
  ReportNotFoundError,
  type ReportListScope,
  type ReportRecord,
  type ReportRepository,
  type ReportRevision,
} from "../ports/report_repository.js";

const renderShape = (value: string | null): RenderShape | null => {
  const parsed = RENDER_SHAPE_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export function createReportRepository(db: SqliteDatabase): ReportRepository {
  type RawReport = Omit<ReportRecord, "render_shape"> & { render_shape: string | null };

  const toRecord = (row: RawReport): ReportRecord => ({
    ...row,
    render_shape: renderShape(row.render_shape),
  });

  async function create(input: {
    owner: string;
    name: string;
    viewId: string;
  }): Promise<ReportRecord> {
    const now = new Date().toISOString();
    const raw: RawReport = {
      id: randomUUID(),
      owner: input.owner.trim(),
      name: input.name,
      view_id: input.viewId,
      render_shape: null,
      archived_at: null,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO report
         (id, owner, name, view_id, render_shape, archived_at,
          revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      raw.id,
      raw.owner,
      raw.name,
      raw.view_id,
      raw.render_shape,
      raw.archived_at,
      raw.revision,
      raw.created_at,
      raw.updated_at,
    );
    return toRecord(raw);
  }

  async function get(id: string): Promise<ReportRecord | null> {
    const row = db.prepare("SELECT * FROM report WHERE id = ?").get(id) as RawReport | undefined;
    return row ? toRecord(row) : null;
  }

  async function resolveOwned(id: string, owner: string): Promise<ReportRecord> {
    const row = await get(id);
    if (!row || row.owner !== owner) throw new ReportNotFoundError("报告不存在或无权访问");
    return row;
  }

  async function listOwned(
    owner: string,
    query?: string,
    scope: ReportListScope = "active",
  ): Promise<ReportRecord[]> {
    const clauses = ["owner = ?"];
    const params: string[] = [owner.trim()];
    if (scope === "active") clauses.push("archived_at IS NULL");
    if (scope === "archived") clauses.push("archived_at IS NOT NULL");
    if (query?.trim()) {
      clauses.push("name LIKE ? ESCAPE '!'");
      params.push(`%${query.trim().replace(/[!%_]/g, "!$&")}%`);
    }
    return (
      db
        .prepare(`SELECT * FROM report WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`)
        .all(...params) as RawReport[]
    ).map(toRecord);
  }

  async function update(
    id: string,
    owner: string,
    patch: {
      name?: string;
      viewId?: string;
      archivedAt?: string | null;
    },
    ifRevision?: number,
  ): Promise<ReportRecord> {
    const current = await resolveOwned(id, owner);
    if (ifRevision !== undefined && current.revision !== ifRevision) {
      throw new ReportConflictError(
        `报告已被更新：期望 revision=${ifRevision}，当前 revision=${current.revision}`,
      );
    }
    const now = new Date().toISOString();
    const expectedRevision = current.revision;
    const nextViewId = patch.viewId ?? current.view_id;
    const nextRenderShape =
      patch.viewId !== undefined && patch.viewId !== current.view_id ? null : current.render_shape;
    let changes = 0;
    try {
      inTransaction(db, () => {
        const locked = db
          .prepare("SELECT revision FROM report WHERE id = ? AND owner = ?")
          .get(id, owner) as { revision: number } | undefined;
        if (!locked) throw new ReportNotFoundError("报告不存在或无权访问");
        if (locked.revision !== expectedRevision) {
          throw new ReportConflictError("报告已被其他操作更新");
        }
        db.prepare(
          `INSERT INTO report_revision
             (report_id, revision, name, view_id, saved_by, saved_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          current.id,
          current.revision,
          current.name,
          current.view_id,
          owner,
          current.updated_at,
        );
        const result = db
          .prepare(
            `UPDATE report
             SET name = ?, view_id = ?, render_shape = ?, archived_at = ?,
                 revision = ?, updated_at = ?
             WHERE id = ? AND revision = ?`,
          )
          .run(
            patch.name === undefined ? current.name : patch.name,
            nextViewId,
            nextRenderShape,
            patch.archivedAt === undefined ? current.archived_at : patch.archivedAt,
            current.revision + 1,
            now,
            id,
            expectedRevision,
          );
        changes = Number(result.changes);
        if (changes !== 1) throw new ReportConflictError("报告已被其他操作更新");
        db.prepare(
          `DELETE FROM report_revision
           WHERE report_id = ? AND revision NOT IN (
             SELECT revision FROM report_revision
             WHERE report_id = ? ORDER BY revision DESC LIMIT 20
           )`,
        ).run(id, id);
      });
    } catch (error) {
      if (error instanceof ReportConflictError) changes = 0;
      else throw error;
    }
    if (changes !== 1) {
      const latest = await get(id);
      if (!latest) throw new ReportNotFoundError("报告不存在");
      throw new ReportConflictError(
        `报告已被更新：期望 revision=${expectedRevision}，当前 revision=${latest.revision}`,
      );
    }
    const updated = await get(id);
    if (!updated) throw new ReportNotFoundError("报告不存在");
    return updated;
  }

  async function listRevisions(id: string, owner: string): Promise<ReportRevision[]> {
    await resolveOwned(id, owner);
    return db
      .prepare("SELECT * FROM report_revision WHERE report_id = ? ORDER BY revision DESC")
      .all(id) as ReportRevision[];
  }

  async function restore(
    id: string,
    owner: string,
    revision: number,
    ifRevision?: number,
  ): Promise<ReportRecord> {
    await resolveOwned(id, owner);
    const snapshot = db
      .prepare("SELECT * FROM report_revision WHERE report_id = ? AND revision = ?")
      .get(id, revision) as ReportRevision | undefined;
    if (!snapshot) throw new ReportNotFoundError("报告历史版本不存在");
    return update(id, owner, { name: snapshot.name, viewId: snapshot.view_id }, ifRevision);
  }

  async function cacheRenderShape(
    id: string,
    viewId: string,
    shape: RenderShape | null,
  ): Promise<void> {
    db.prepare(
      `UPDATE report SET render_shape = ?
       WHERE id = ? AND view_id = ?`,
    ).run(shape, id, viewId);
  }

  return {
    create,
    get,
    resolveOwned,
    listOwned,
    update,
    listRevisions,
    restore,
    cacheRenderShape,
  };
}
