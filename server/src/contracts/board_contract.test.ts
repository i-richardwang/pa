import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  BOARD_MUTATION_TILES_SCHEMA,
  CREATE_BOARD_BODY,
  MAX_BOARD_TILES,
  UPDATE_BOARD_BODY,
} from "./board_contract.js";

const reportTile = (tileId = randomUUID()) => ({
  kind: "report" as const,
  tile_id: tileId,
  report_id: randomUUID(),
  place: { x: 0, y: 0, w: 12, h: 5 },
});

describe("board mutation contract", () => {
  test("名称去除首尾空白，写入瓦片不接受报告名等只读字段", () => {
    expect(CREATE_BOARD_BODY.parse({ name: " 人委会看板 " })).toEqual({ name: "人委会看板" });
    expect(
      UPDATE_BOARD_BODY.safeParse({
        if_revision: 1,
        tiles: [{ ...reportTile(), name: "派生报告名" }],
      }).success,
    ).toBe(false);
  });

  test("校验 UUID、网格范围、重复 tile_id 与瓦片数量上限", () => {
    expect(
      BOARD_MUTATION_TILES_SCHEMA.safeParse([{ ...reportTile(), tile_id: "bad" }]).success,
    ).toBe(false);
    expect(
      BOARD_MUTATION_TILES_SCHEMA.safeParse([
        { ...reportTile(), place: { x: 20, y: 0, w: 8, h: 2 } },
      ]).success,
    ).toBe(false);
    const duplicate = randomUUID();
    expect(
      BOARD_MUTATION_TILES_SCHEMA.safeParse([reportTile(duplicate), reportTile(duplicate)]).success,
    ).toBe(false);
    expect(
      BOARD_MUTATION_TILES_SCHEMA.safeParse(
        Array.from({ length: MAX_BOARD_TILES + 1 }, () => reportTile()),
      ).success,
    ).toBe(false);
  });
});
