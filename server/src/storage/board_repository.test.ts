import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_BOARD_TILES,
  createBoardRepository,
  normalizeBoardName,
  normalizeTiles,
} from "./board_repository.js";
import { BOARD_GRID_COLUMNS, BOARD_ID_PATTERN } from "../contracts/board_contract.js";
import { BoardConflictError } from "../ports/board_repository.js";
import { createReportRepository as createReports } from "./report_repository.js";
import { createAnalysisRepository } from "./analysis_repository.js";
import { semanticSpecOf } from "../test_support/report.js";
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
    reportIds.push(
      (
        await reports.create({
          owner: "alice@x",
          name: `报告 ${i + 1}`,
          analysisId: (
            await analyses.create("alice@x", semanticSpecOf(analysis(), presentation()))
          ).id,
        })
      ).id,
    );
  }
  return { path, db, analyses, reports, reportIds, boards: createBoardRepository(db, reports) };
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
});

const place = (x: number, y: number, w = 12, h = 5) => ({ x, y, w, h });
const reportTile = (reportId: string, p = place(0, 0)) => ({
  kind: "report" as const,
  tile_id: randomUUID(),
  report_id: reportId,
  place: p,
});
const textTile = (md: string, p = place(0, 0, BOARD_GRID_COLUMNS, 1)) => ({
  kind: "text" as const,
  tile_id: randomUUID(),
  md,
  place: p,
});

// 归属校验以看板创建者为锚；setup() 的报告 owner 均为 alice@x。
const board = (created_by = "alice@x", id = randomUUID()) => ({ id, created_by });

describe("瓦片归一", () => {
  test("报告瓦片校验 report 真实存在，text 瓦片留存 md，保序", async () => {
    const { reports, reportIds } = await setup();
    const tiles = [
      reportTile(reportIds[0]),
      textTile("# 分节"),
      reportTile(reportIds[1], place(12, 0)),
    ];
    const normalized = await normalizeTiles(tiles, reports, board());
    expect(normalized).toEqual(tiles);
    await expect(normalizeTiles([reportTile("missing")], reports, board())).rejects.toThrow(
      "报告不存在",
    );
    await expect(normalizeTiles("bad", reports, board())).rejects.toThrow("数组");
  });

  test("归属收口：只放行看板创建者本人的报告", async () => {
    const { analyses, reports, reportIds } = await setup();
    const otherOwner = (
      await reports.create({
        owner: "bob@x",
        name: "他人的图",
        analysisId: (await analyses.create("bob@x", semanticSpecOf(analysis(), presentation()))).id,
      })
    ).id;
    const ctx = board("alice@x");
    // 引用他人 owner 的报告被拒
    await expect(normalizeTiles([reportTile(otherOwner)], reports, ctx)).rejects.toThrow(
      "无权引用他人",
    );
    // 引用本人报告放行
    await expect(normalizeTiles([reportTile(reportIds[0])], reports, ctx)).resolves.toHaveLength(1);
  });

  test("tile_id 必为 uuid 且不得重复", async () => {
    const { reports, reportIds } = await setup();
    await expect(
      normalizeTiles(
        [{ kind: "report", tile_id: "nope", report_id: reportIds[0], place: place(0, 0) }],
        reports,
        board(),
      ),
    ).rejects.toThrow("uuid");
    const dup = randomUUID();
    await expect(
      normalizeTiles(
        [
          { kind: "report", tile_id: dup, report_id: reportIds[0], place: place(0, 0) },
          { kind: "report", tile_id: dup, report_id: reportIds[1], place: place(12, 0) },
        ],
        reports,
        board(),
      ),
    ).rejects.toThrow("重复");
  });

  test("place 须为整数、非负、越界即拒", async () => {
    const { reports, reportIds } = await setup();
    await expect(
      normalizeTiles([reportTile(reportIds[0], { x: 0, y: 0, w: 1.5, h: 2 })], reports, board()),
    ).rejects.toThrow("整数");
    await expect(
      normalizeTiles([reportTile(reportIds[0], { x: -1, y: 0, w: 2, h: 2 })], reports, board()),
    ).rejects.toThrow("负");
    await expect(
      normalizeTiles([reportTile(reportIds[0], { x: 20, y: 0, w: 8, h: 2 })], reports, board()),
    ).rejects.toThrow(String(BOARD_GRID_COLUMNS));
    await expect(
      normalizeTiles(
        [{ kind: "report", tile_id: randomUUID(), report_id: reportIds[0], place: null }],
        reports,
        board(),
      ),
    ).rejects.toThrow("place");
  });

  test("未知 kind 与非字符串 md 被拒", async () => {
    const { reports } = await setup();
    await expect(
      normalizeTiles(
        [{ kind: "widget", tile_id: randomUUID(), place: place(0, 0) }],
        reports,
        board(),
      ),
    ).rejects.toThrow("瓦片类型");
    await expect(
      normalizeTiles(
        [{ kind: "text", tile_id: randomUUID(), md: 42, place: place(0, 0) }],
        reports,
        board(),
      ),
    ).rejects.toThrow("md");
  });

  test(`瓦片上限 ${MAX_BOARD_TILES}`, async () => {
    const { reports, reportIds } = await setup();
    const tiles = Array.from({ length: MAX_BOARD_TILES + 1 }, () => reportTile(reportIds[0]));
    // tile_id 各不相同（randomUUID），只因数量超限被拒
    await expect(normalizeTiles(tiles, reports, board())).rejects.toThrow(
      `最多包含 ${MAX_BOARD_TILES}`,
    );
  });

  test("名称归一", () => {
    expect(normalizeBoardName(" 人委会看板 ")).toBe("人委会看板");
    expect(() => normalizeBoardName("  ")).toThrow("名称");
    expect(() => normalizeBoardName("长".repeat(51))).toThrow("最长");
  });
});

describe("boards 存取", () => {
  test("建板得稳定随机门牌号，取/列/改/删闭环", async () => {
    const { boards, reports, reportIds } = await setup();
    const created = await boards.create(" 人委会看板 ", "alice@x");
    expect(created.id).toMatch(BOARD_ID_PATTERN);
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
    // 存取往返：tiles JSON 列持久化后与写入一致
    expect((await boards.get(created.id))?.tiles).toEqual(tiles);
    void reports;

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

  test("成员存在性在存储边界拒绝", async () => {
    const { boards } = await setup();
    const created = await boards.create("看板", "alice@x");
    await expect(
      boards.update(created.id, { tiles: [reportTile("missing")] }, created.revision),
    ).rejects.toThrow("报告不存在");
  });

  test("并发写入只有一个 revision 能成功，失败方不会覆盖胜者", async () => {
    const { path, reports, boards } = await setup(0);
    const competingDb = createTestAppDatabase(path);
    const competing = createBoardRepository(competingDb, reports);
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
