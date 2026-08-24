import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqliteDatabase } from "../sqlite.js";
import {
  APP_SCHEMA_STAMP,
  inTransaction,
  initializeAppDatabase,
  openAppDatabase,
  schemaStampOf,
} from "./app_database.js";

const path = (label: string) => join(tmpdir(), `pa_app_database_${label}_${randomUUID()}.db`);

function names(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

describe("app database", () => {
  test("空库建立最终结构、结构印记与连接 pragma", async () => {
    const db = await openAppDatabase(path("empty"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    for (const table of [
      "usage_log",
      "feedback",
      "business_term",
      "analysis",
      "analysis_view",
      "report",
      "report_revision",
      "board",
      "export_ticket",
      "export_audit",
      "record_projection_audit",
    ]) {
      expect(tables.map((row) => row.name)).toContain(table);
    }
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: APP_SCHEMA_STAMP });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(names(db, "analysis")).toEqual(["id", "owner", "definition", "created_at"]);
    expect(names(db, "analysis_view")).toEqual([
      "id",
      "analysis_id",
      "intent",
      "preferences",
      "created_at",
    ]);
    const persistedColumns = [
      "analysis",
      "analysis_view",
      "report",
      "report_revision",
      "usage_log",
    ].flatMap((table) => names(db, table));
    expect(persistedColumns).not.toContain("render_bundle");
    expect(persistedColumns).not.toContain("payload");
    expect(names(db, "business_term")).toEqual([
      "id",
      "canonical_term",
      "definition",
      "context",
      "aliases",
      "related_member_ids",
    ]);
    expect(names(db, "report")).toEqual([
      "id",
      "owner",
      "name",
      "view_id",
      "render_shape",
      "archived_at",
      "revision",
      "created_at",
      "updated_at",
    ]);
    expect(names(db, "export_ticket")).toEqual([
      "id",
      "created_at",
      "expires_at",
      "caller",
      "query",
    ]);
    expect(names(db, "usage_log")).toEqual([
      "id",
      "at",
      "caller",
      "tool",
      "title",
      "outcome",
      "error",
      "row_count",
      "has_more",
      "duration_ms",
      "term_count",
      "query_fingerprint",
      "derived_formulas",
      "unmatched_terms",
      "analysis_id",
      "view_id",
    ]);
    expect(names(db, "record_projection_audit")).toEqual([
      "id",
      "at",
      "caller",
      "source_kind",
      "source_id",
      "source_reference_id",
      "source_revision",
      "metric_id",
      "coordinates",
      "offset",
      "row_count",
      "outcome",
      "error",
    ]);
    db.close();
  });

  test("结构印记匹配时重复打开保留已有数据", async () => {
    const file = path("reopen");
    const first = await openAppDatabase(file);
    first
      .prepare(
        `INSERT INTO board (id, name, tiles, created_by, created_at, updated_at)
         VALUES (?, ?, '[]', ?, ?, ?)`,
      )
      .run(randomUUID(), "经营看板", "alice@x", "2026-07-01", "2026-07-01");
    first.close();

    const reopened = await openAppDatabase(file);
    expect(reopened.prepare("SELECT name, revision FROM board").get()).toEqual({
      name: "经营看板",
      revision: 1,
    });
    reopened.close();
  });

  test("非空库的结构印记不匹配时 fail-closed 并保持原结构", () => {
    const db = new Database(path("mismatch")) as unknown as SqliteDatabase;
    db.exec("CREATE TABLE usage_log (id INTEGER PRIMARY KEY)");
    expect(() => initializeAppDatabase(db)).toThrow("请以空库重建后再启动");
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
    ).toEqual([{ name: "usage_log" }]);
    db.close();
  });

  test("结构印记随 DDL 的结构变化而变，随排版变化而不变", () => {
    const ddl = "CREATE TABLE t (id TEXT PRIMARY KEY);";
    expect(schemaStampOf(ddl)).not.toBe(schemaStampOf(`${ddl}\nCREATE TABLE u (id TEXT);`));
    expect(schemaStampOf(ddl)).not.toBe(schemaStampOf("CREATE TABLE t (id INTEGER PRIMARY KEY);"));
    expect(schemaStampOf(ddl)).toBe(schemaStampOf("\n  CREATE TABLE t (id TEXT   PRIMARY KEY);\n"));
    expect(APP_SCHEMA_STAMP).toBeGreaterThan(0);
  });

  test("其他 DDL 即使带有自己的结构印记也 fail-closed", () => {
    const db = new Database(path("other-shape")) as unknown as SqliteDatabase;
    const otherDdl = "CREATE TABLE value_alias (id TEXT PRIMARY KEY, term TEXT NOT NULL);";
    db.exec(otherDdl);
    db.exec(`PRAGMA user_version = ${schemaStampOf(otherDdl)}`);
    expect(() => initializeAppDatabase(db)).toThrow("应用库结构与当前代码不符");
    db.close();
  });

  test("事务 helper 原子回滚，报告历史依附报告生命周期", async () => {
    const db = await openAppDatabase(path("transaction"));
    expect(() =>
      inTransaction(db, () => {
        db.prepare(
          `INSERT INTO board (id, name, tiles, created_by, created_at, updated_at)
           VALUES (?, ?, '[]', ?, ?, ?)`,
        ).run(randomUUID(), "临时看板", "alice@x", "2026-07-01", "2026-07-01");
        throw new Error("injected");
      }),
    ).toThrow("injected");
    expect(db.prepare("SELECT COUNT(*) AS n FROM board").get()).toEqual({ n: 0 });

    const reportId = randomUUID();
    const analysisId = randomUUID();
    const viewId = randomUUID();
    db.prepare(
      `INSERT INTO analysis (id, owner, definition, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(analysisId, "alice@x", "{}", "2026-07-01");
    db.prepare(
      `INSERT INTO analysis_view (id, analysis_id, intent, preferences, created_at)
       VALUES (?, ?, ?, '{}', ?)`,
    ).run(viewId, analysisId, '{"type":"table"}', "2026-07-01");
    db.prepare(
      `INSERT INTO report
       (id, owner, name, view_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(reportId, "alice@x", "经营报告", viewId, "2026-07-01", "2026-07-01");
    db.prepare(
      `INSERT INTO report_revision
       (report_id, revision, name, view_id, saved_by, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(reportId, 1, "经营报告", viewId, "alice@x", "2026-07-01");
    db.prepare("DELETE FROM report WHERE id = ?").run(reportId);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM report_revision WHERE report_id = ?").get(reportId),
    ).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM analysis WHERE id = ?").get(analysisId)).toEqual({
      n: 1,
    });
    db.close();
  });
});
