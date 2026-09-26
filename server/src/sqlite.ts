/**
 * 按运行时选择 SQLite 驱动：服务（Node）用 node:sqlite，本机脚本（Bun）用 bun:sqlite，
 * 因为 Bun 1.3 还没有 node:sqlite。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): {
      changes: number | bigint;
      lastInsertRowid?: number | bigint;
    };
    all(...params: (string | number | null)[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

/** 只读打开要求文件已存在，文件缺失由调用方处理 */
export async function openSqlite(
  path: string,
  opts?: { readonly?: boolean },
): Promise<SqliteDatabase> {
  if (!opts?.readonly) mkdirSync(dirname(path), { recursive: true });
  if ("Bun" in globalThis) {
    const { Database } = await import("bun:sqlite");
    const db = opts?.readonly ? new Database(path, { readonly: true }) : new Database(path);
    db.exec("PRAGMA foreign_keys = ON");
    return db as unknown as SqliteDatabase;
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, {
    readOnly: opts?.readonly ?? false,
  });
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as SqliteDatabase;
}
