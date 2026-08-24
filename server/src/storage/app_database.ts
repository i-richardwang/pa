import { createHash } from "node:crypto";
import { openSqlite, type SqliteDatabase } from "../sqlite.js";

/**
 * 结构印记：本文件 DDL 的规范化摘要，开库时写进 `user_version`。
 *
 * 非空库的印记与当前 DDL 不同时，开库立即 fail-closed，由部署方以空库重建。
 *
 * 摘要取自 DDL 源文本并折叠空白：重排版、改缩进不算结构变化，动表、动列、动索引才算。
 */
export function schemaStampOf(ddl: string): number {
  const digest = createHash("sha256").update(ddl.replace(/\s+/g, " ").trim()).digest();
  // user_version 是有符号 32 位；取低 31 位，并避开 0——0 是「空库」的保留含义。
  return digest.readUInt32BE(0) & 0x7fff_ffff || 1;
}

function storedSchemaStamp(db: SqliteDatabase): number {
  return (
    db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    }
  ).user_version;
}

function hasUserTables(db: SqliteDatabase): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
    )
    .get();
  return row !== null && row !== undefined;
}

/** 自有应用库结构的唯一基线：结构变化直接更新完整 DDL，空库据此建立全部结构。 */
const SCHEMA_DDL = `
    CREATE TABLE usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      caller TEXT NOT NULL,
      tool TEXT NOT NULL,
      title TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error')),
      error TEXT,
      row_count INTEGER,
      has_more INTEGER CHECK (has_more IN (0, 1)),
      duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
      term_count INTEGER CHECK (term_count IS NULL OR term_count >= 0),
      query_fingerprint TEXT,
      derived_formulas TEXT
        CHECK (derived_formulas IS NULL OR (json_valid(derived_formulas) AND json_type(derived_formulas) = 'array')),
      unmatched_terms TEXT CHECK (unmatched_terms IS NULL OR json_valid(unmatched_terms)),
      analysis_id TEXT,
      view_id TEXT
    );
    CREATE INDEX usage_log_at ON usage_log (at);
    CREATE INDEX usage_log_fingerprint ON usage_log (query_fingerprint);
    CREATE INDEX usage_log_analysis_id ON usage_log (analysis_id);
    CREATE INDEX usage_log_view_id ON usage_log (view_id);

    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      caller TEXT NOT NULL,
      ask TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
      note TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      topic_key TEXT NOT NULL
    );
    CREATE INDEX feedback_at ON feedback (at);
    CREATE INDEX feedback_topic ON feedback (topic_key);

    CREATE TABLE business_term (
      id TEXT PRIMARY KEY,
      canonical_term TEXT NOT NULL,
      definition TEXT NOT NULL,
      context TEXT,
      aliases TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(aliases) AND json_type(aliases) = 'array'),
      related_member_ids TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(related_member_ids) AND json_type(related_member_ids) = 'array')
    );

    CREATE TABLE analysis (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      definition TEXT NOT NULL CHECK (json_valid(definition)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX analysis_owner ON analysis (owner, created_at DESC);

    CREATE TABLE analysis_view (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      intent TEXT NOT NULL CHECK (json_valid(intent)),
      preferences TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(preferences) AND json_type(preferences) = 'object'),
      created_at TEXT NOT NULL,
      FOREIGN KEY (analysis_id) REFERENCES analysis(id) ON DELETE CASCADE
    );
    CREATE INDEX analysis_view_analysis ON analysis_view (analysis_id, created_at DESC);

    CREATE TABLE report (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      view_id TEXT NOT NULL,
      render_shape TEXT,
      archived_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (view_id) REFERENCES analysis_view(id) ON DELETE RESTRICT
    );
    CREATE INDEX report_owner ON report (owner, archived_at, updated_at DESC);
    CREATE INDEX report_view ON report (view_id);

    CREATE TABLE report_revision (
      report_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      name TEXT NOT NULL,
      view_id TEXT NOT NULL,
      saved_by TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (report_id, revision),
      FOREIGN KEY (report_id) REFERENCES report(id) ON DELETE CASCADE,
      FOREIGN KEY (view_id) REFERENCES analysis_view(id) ON DELETE RESTRICT
    );
    CREATE INDEX report_revision_saved_at ON report_revision (report_id, revision DESC);
    CREATE INDEX report_revision_view ON report_revision (view_id);

    CREATE TABLE board (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tiles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tiles) AND json_type(tiles) = 'array'),
      created_by TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE export_ticket (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      caller TEXT NOT NULL,
      query TEXT NOT NULL CHECK (json_valid(query))
    );
    CREATE INDEX export_ticket_expiry ON export_ticket (expires_at);

    CREATE TABLE export_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('export_created', 'export_downloaded', 'export_failed')),
      caller TEXT NOT NULL,
      query TEXT NOT NULL CHECK (json_valid(query)),
      row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0)
    );

    CREATE TABLE record_projection_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      caller TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('analysis', 'report', 'board')),
      source_id TEXT NOT NULL,
      source_reference_id TEXT,
      source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
      metric_id TEXT NOT NULL,
      coordinates TEXT NOT NULL CHECK (json_valid(coordinates)),
      offset INTEGER NOT NULL CHECK (offset >= 0),
      row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
      outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error')),
      error TEXT
    );
    CREATE INDEX record_projection_audit_source
      ON record_projection_audit (source_kind, source_id, at DESC);
`;

/** 当前代码的结构印记；运维排错与自检读同一个数。 */
export const APP_SCHEMA_STAMP = schemaStampOf(SCHEMA_DDL);

function createSchema(db: SqliteDatabase): void {
  db.exec(SCHEMA_DDL);
}

function transact(db: SqliteDatabase, body: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    body();
    db.exec(`PRAGMA user_version = ${APP_SCHEMA_STAMP}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** PA 自有应用库的唯一初始化边界；只接受空库或当前完整结构。 */
export function initializeAppDatabase(db: SqliteDatabase): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  const stamp = storedSchemaStamp(db);
  if (stamp === APP_SCHEMA_STAMP) return;
  if (stamp !== 0 || hasUserTables(db)) {
    throw new Error(
      `应用库结构与当前代码不符：库印记 ${stamp}，代码印记 ${APP_SCHEMA_STAMP}；` +
        "请以空库重建后再启动",
    );
  }

  transact(db, () => createSchema(db));
}

export async function openAppDatabase(path: string): Promise<SqliteDatabase> {
  const db = await openSqlite(path);
  try {
    initializeAppDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** 应用库事务体只允许同步 SQLite 操作；外部 I/O 必须在事务开始前完成。 */
export function inTransaction<T>(db: SqliteDatabase, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
