import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqliteDatabase } from "../sqlite.js";
import { initializeAppDatabase } from "../storage/app_database.js";

function testDatabasePath(label = "app"): string {
  return join(tmpdir(), `pa_${label}_${randomUUID()}.db`);
}

export function createTestAppDatabase(path = testDatabasePath()): SqliteDatabase {
  const db = new Database(path) as unknown as SqliteDatabase;
  initializeAppDatabase(db);
  return db;
}
