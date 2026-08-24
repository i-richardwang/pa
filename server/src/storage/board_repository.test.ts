import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoardRepository } from "./board_repository.js";
import { BOARD_ID_SCHEMA } from "../contracts/board_contract.js";
import { BoardConflictError } from "../ports/board_repository.js";
import { createReportRepository as createReports } from "./report_repository.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { semanticAnalysisOf } from "../test_support/report.js";
import { createTestAppDatabase } from "../test_support/app_database.js";

let seq = 0;
const runId = randomUUID();
function freshPath() {
  seq += 1;
  return join(tmpdir(), `pa_board_repository_test_${runId}_${seq}.db`);
}

async function setup(reportCount = 3) {
  const path = freshPath();
  const db = createTestAppDatabase(path);
  const reports = createReports(db);
  const analyses = createAnalysisRepository(db);
  const reportIds: string[] = [];
  for (let i = 0; i < reportCount; i += 1) {
    const fixture = semanticAnalysisOf(analysis(), presentation());
    const created = await analyses.create("alice@x", fixture.analysis, fixture.view);
    reportIds.push(
      (
        await reports.create({
          owner: "alice@x",
          name: `报告 ${i + 1}`,
          viewId: created.view.id,
        })
      ).id,
    );
  }
  return { path, db, reports, reportIds, boards: createBoardRepository(db) };
}

const analysis = () => ({
  views: [
    {
      id: "result",
      measures: ["test_people_metrics.active_employee_count"],
      dimensions: ["test_people_metrics.organization_name"],
      time: { cutoff: "2026-07" },
    },
  ],
});
const presentation = () => ({
  type: "table" as const,
  y: [],
  tableLayout: { rows: [], columns: [] },
});

const place = (x: number, y: number, w = 12, h = 5) => ({ x, y, w, h });
const reportTile = (reportId: string, p = place(0, 0)) => ({
  kind: "report" as const,
  tile_id: randomUUID(),
  report_id: reportId,
  place: p,
});
describe("boards 存取", () => {
  test("建板得稳定随机门牌号，取/列/改/删闭环", async () => {
    const { boards, reportIds } = await setup();
    const created = await boards.create("人委会看板", "alice@x");
    expect(BOARD_ID_SCHEMA.safeParse(created.id).success).toBe(true);
    expect(created).toMatchObject({ name: "人委会看板", tiles: [], created_by: "alice@x" });

    const second = await boards.create("另一看板", "bob@x");
    expect(second.id).not.toBe(created.id);
    expect((await boards.list()).map((row) => row.id).sort()).toEqual(
      [created.id, second.id].sort(),
    );

    const tiles = [reportTile(reportIds[0]), reportTile(reportIds[1], place(12, 0))];
    const updated = await boards.update(
      created.id,
      { name: "人委会 7 月看板", tiles },
      created.revision,
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: "人委会 7 月看板",
      tiles,
      revision: 2,
    });
    expect(updated!.updated_at >= created.updated_at).toBe(true);
    expect((await boards.get(created.id))?.tiles).toEqual(tiles);
    expect(
      await boards.update("00000000-0000-0000-0000-000000000000", { name: "x" }, 1),
    ).toBeNull();
    expect(await boards.remove("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await boards.remove(created.id)).toBe(true);
    expect(await boards.get(created.id)).toBeNull();
  });

  test("删板只删除看板，引用的报告继续保留", async () => {
    const { boards, reports, reportIds } = await setup();
    const created = await boards.create("看板", "alice@x");
    await boards.update(created.id, { tiles: [reportTile(reportIds[0])] }, created.revision);

    expect(await boards.remove(created.id)).toBe(true);
    expect(await boards.get(created.id)).toBeNull();
    expect(await reports.get(reportIds[0])).not.toBeNull();
  });

  test("读取时拒绝损坏的持久瓦片", async () => {
    const { boards, db } = await setup(0);
    const created = await boards.create("看板", "alice@x");
    db.prepare("UPDATE board SET tiles = ? WHERE id = ?").run(
      JSON.stringify([{ kind: "text", tile_id: "bad", md: "x", place: null }]),
      created.id,
    );
    await expect(boards.get(created.id)).rejects.toThrow("board.tiles 不是合法瓦片数组");
  });

  test("并发写入只有一个 revision 能成功，失败方不会覆盖胜者", async () => {
    const { path, boards } = await setup(0);
    const competingDb = createTestAppDatabase(path);
    const competing = createBoardRepository(competingDb);
    const created = await boards.create("看板", "alice@x");
    await Promise.all([boards.get(created.id), competing.get(created.id)]);

    const results = await Promise.allSettled([
      boards.update(created.id, { name: "写入 A" }, created.revision),
      competing.update(created.id, { name: "写入 B" }, created.revision),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(BoardConflictError);
    }
    expect(await boards.get(created.id)).toMatchObject({
      name: expect.stringMatching(/^写入 [AB]$/),
      revision: 2,
    });
  });
});
