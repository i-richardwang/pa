import { describe, expect, test } from "bun:test";
import type { BoardPayload, BoardTile } from "@contracts/board_contract";
import type { ReportRow } from "@contracts/report_contract";
import {
  addBoardReport,
  applyBoardLayout,
  beginBoardEdit,
  changeBoardText,
  isBoardEditDirty,
  moveBoardTile,
  removeBoardTile,
} from "./board_draft";

const chartTile: BoardTile = {
  kind: "report",
  tile_id: "00000000-0000-4000-8000-000000000001",
  report_id: "chart-1",
  name: "人数",
  presentation_type: "bar",
  render_shape: "bar",
  place: { x: 0, y: 0, w: 12, h: 5 },
};
const textTile: BoardTile = {
  kind: "text",
  tile_id: "00000000-0000-4000-8000-000000000002",
  md: "说明",
  place: { x: 0, y: 5, w: 24, h: 3 },
};
const board: BoardPayload = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "看板",
  created_by: "alice@x",
  revision: 1,
  updated_at: "2026-07-01",
  tiles: [chartTile, textTile],
};

describe("board edit state", () => {
  test("dirty state follows persisted fields and ignores unchanged layout events", () => {
    const initial = beginBoardEdit(board);
    expect(isBoardEditDirty(initial, board)).toBe(false);
    expect(applyBoardLayout(initial, [{ i: chartTile.tile_id, ...chartTile.place }])).toBe(initial);
    const moved = applyBoardLayout(initial, [{ i: chartTile.tile_id, x: 6, y: 1, w: 12, h: 5 }]);
    expect(isBoardEditDirty(moved, board)).toBe(true);
    expect(moved.tiles[0].place).toEqual({ x: 6, y: 1, w: 12, h: 5 });
  });

  test("text edits and removal are pure state transitions", () => {
    const initial = beginBoardEdit(board);
    const changed = changeBoardText(initial, textTile.tile_id, "新说明");
    expect(changed.tiles[1]).toMatchObject({ kind: "text", md: "新说明" });
    expect(removeBoardTile(changed, chartTile.tile_id).tiles).toEqual([changed.tiles[1]]);
    expect(board.tiles).toEqual([chartTile, textTile]);
  });

  test("新增报告只追加引用瓦片，不产生额外生命周期状态", () => {
    const report: ReportRow = {
      id: "report",
      analysis_id: "analysis",
      view_id: "view",
      name: "可复用报告",
      result_view_id: "result",
      presentation_type: "bar",
      render_shape: "bar",
      revision: 1,
      updated_at: "2026-07-01",
    };
    const updated = addBoardReport(beginBoardEdit(board), report);
    expect(updated).toMatchObject({
      name: board.name,
      tiles: [chartTile, textTile, { kind: "report", report_id: "report", name: "可复用报告" }],
    });
  });

  test("上移下移与相邻瓦片交换完整的 place", () => {
    const initial = beginBoardEdit(board);
    const down = moveBoardTile(initial, chartTile.tile_id, "down");
    expect(down.tiles.find((t) => t.tile_id === chartTile.tile_id)?.place).toEqual(textTile.place);
    expect(down.tiles.find((t) => t.tile_id === textTile.tile_id)?.place).toEqual(chartTile.place);
    expect(moveBoardTile(initial, chartTile.tile_id, "up")).toBe(initial);
    expect(moveBoardTile(down, chartTile.tile_id, "down")).toBe(down);
  });
});
