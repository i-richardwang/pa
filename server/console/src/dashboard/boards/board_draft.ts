import type { BoardMutationTile, BoardPayload, BoardTile, Place } from "@contracts/board_contract";
import type { ReportRow } from "@contracts/report_contract";
import { reportTileSize, TILE_SIZES } from "./tile_sizing";

/** 用 getRandomValues 生成 UUID v4：crypto.randomUUID 只在安全上下文可用，控制台可能经局域网 http 访问。 */
function newTileId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function bottomY(tiles: BoardTile[]): number {
  return tiles.reduce((max, t) => Math.max(max, t.place.y + t.place.h), 0);
}

function newReportTile(report: ReportRow, tiles: BoardTile[]): BoardTile {
  const { w, h } = reportTileSize(report);
  const place: Place = { x: 0, y: bottomY(tiles), w, h };
  return {
    kind: "report",
    tile_id: newTileId(),
    report_id: report.id,
    place,
    name: report.name,
    presentation_type: report.presentation_type,
    render_shape: report.render_shape,
  };
}

export function newTextTile(tiles: BoardTile[]): BoardTile {
  return {
    kind: "text",
    tile_id: newTileId(),
    md: "",
    place: { x: 0, y: bottomY(tiles), w: TILE_SIZES.text.w, h: TILE_SIZES.text.h },
  };
}

/** 只取会保存的字段（不含报告瓦片的名称等派生字段），用于判断是否有未保存的修改。 */
function persistProjection(tile: BoardTile): string {
  const { x, y, w, h } = tile.place;
  const body = tile.kind === "report" ? `c:${tile.report_id}` : `t:${tile.md}`;
  return `${tile.tile_id}|${body}|${x},${y},${w},${h}`;
}

function sameTiles(a: BoardTile[], b: BoardTile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tile, i) => persistProjection(tile) === persistProjection(b[i]));
}

export type BoardEditState = {
  name: string;
  tiles: BoardTile[];
};

export type DraftLayoutItem = Pick<Place, "x" | "y" | "w" | "h"> & { i: string };

export function beginBoardEdit(board: BoardPayload): BoardEditState {
  return { name: board.name, tiles: board.tiles };
}

export function boardMutationTiles(tiles: readonly BoardTile[]): BoardMutationTile[] {
  return tiles.map((tile) =>
    tile.kind === "report"
      ? {
          kind: "report",
          tile_id: tile.tile_id,
          report_id: tile.report_id,
          place: tile.place,
        }
      : { kind: "text", tile_id: tile.tile_id, md: tile.md, place: tile.place },
  );
}

export function isBoardEditDirty(draft: BoardEditState, board: BoardPayload): boolean {
  return draft.name !== board.name || !sameTiles(draft.tiles, board.tiles);
}

export function applyBoardLayout(
  draft: BoardEditState,
  layout: readonly DraftLayoutItem[],
): BoardEditState {
  const byId = new Map(layout.map((item) => [item.i, item]));
  let changed = false;
  const tiles = draft.tiles.map((tile) => {
    const item = byId.get(tile.tile_id);
    if (!item) return tile;
    if (
      item.x === tile.place.x &&
      item.y === tile.place.y &&
      item.w === tile.place.w &&
      item.h === tile.place.h
    )
      return tile;
    changed = true;
    return { ...tile, place: { x: item.x, y: item.y, w: item.w, h: item.h } };
  });
  return changed ? { ...draft, tiles } : draft;
}

export function removeBoardTile(draft: BoardEditState, tileId: string): BoardEditState {
  return { ...draft, tiles: draft.tiles.filter((tile) => tile.tile_id !== tileId) };
}

export function changeBoardText(draft: BoardEditState, tileId: string, md: string): BoardEditState {
  return {
    ...draft,
    tiles: draft.tiles.map((tile) =>
      tile.tile_id === tileId && tile.kind === "text" ? { ...tile, md } : tile,
    ),
  };
}

export function addBoardReport(draft: BoardEditState, report: ReportRow): BoardEditState {
  return {
    ...draft,
    tiles: [...draft.tiles, newReportTile(report, draft.tiles)],
  };
}

/** 按阅读序（先上后下、同行先左）排列，供上移/下移使用。 */
export function tilesInReadingOrder(tiles: readonly BoardTile[]): BoardTile[] {
  return [...tiles].sort((a, b) => a.place.y - b.place.y || a.place.x - b.place.x);
}

/** 交换两块瓦片的完整 `place`（含宽高）；已在顶端或底端时原样返回。 */
export function moveBoardTile(
  draft: BoardEditState,
  tileId: string,
  direction: "up" | "down",
): BoardEditState {
  const ordered = tilesInReadingOrder(draft.tiles);
  const idx = ordered.findIndex((tile) => tile.tile_id === tileId);
  if (idx < 0) return draft;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= ordered.length) return draft;
  const a = ordered[idx];
  const b = ordered[swapIdx];
  const placeA = a.place;
  const placeB = b.place;
  return {
    ...draft,
    tiles: draft.tiles.map((tile) => {
      if (tile.tile_id === a.tile_id) return { ...tile, place: placeB };
      if (tile.tile_id === b.tile_id) return { ...tile, place: placeA };
      return tile;
    }),
  };
}
