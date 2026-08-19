import { expect, test } from "bun:test";
import { BOARD_GRID_COLUMNS } from "../contracts/board_contract.js";
import { bottomPlace } from "./board_layout.js";

test("新瓦片落到画布最底空位并占满一行", () => {
  expect(bottomPlace([])).toEqual({ x: 0, y: 0, w: BOARD_GRID_COLUMNS, h: 6 });
  expect(
    bottomPlace([
      { place: { x: 0, y: 0, w: BOARD_GRID_COLUMNS, h: 2 } },
      { place: { x: 0, y: 2, w: 12, h: 5 } },
    ]),
  ).toEqual({ x: 0, y: 7, w: BOARD_GRID_COLUMNS, h: 6 });
});
