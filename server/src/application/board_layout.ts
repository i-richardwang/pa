import { BOARD_GRID_COLUMNS, type Place } from "../contracts/dashboard_contract.js";

/** 新瓦片默认落位到当前画布最底部并占满一行。 */
export function bottomPlace<T extends { place: Place }>(tiles: readonly T[]): Place {
  const bottom = tiles.reduce((max, tile) => Math.max(max, tile.place.y + tile.place.h), 0);
  return { x: 0, y: bottom, w: BOARD_GRID_COLUMNS, h: 6 };
}
