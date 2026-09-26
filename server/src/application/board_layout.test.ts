import { expect, test } from "bun:test";
import { BOARD_GRID_COLUMNS } from "../contracts/board_contract.js";
import { bottomPlace } from "./board_layout.js";

test("新瓦片放在看板最下方并占满整行宽度", () => {
  expect(bottomPlace([])).toEqual({ x: 0, y: 0, w: BOARD_GRID_COLUMNS, h: 6 });
  expect(
    bottomPlace([
      { place: { x: 0, y: 0, w: BOARD_GRID_COLUMNS, h: 2 } },
      { place: { x: 0, y: 2, w: 12, h: 5 } },
    ]),
  ).toEqual({ x: 0, y: 7, w: BOARD_GRID_COLUMNS, h: 6 });
});
