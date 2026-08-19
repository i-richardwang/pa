import { z } from "zod";
import type { ReportRow } from "./report_contract.js";
import { RENDER_SHAPE_SCHEMA } from "../presentation_core/render_shape.js";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";

export const BOARD_GRID_COLUMNS = 24;
export const BOARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 看板读取受成员权限约束，编辑仅限创建者。 */
export type BoardRow = {
  id: string;
  name: string;
  count: number;
  created_by: string;
  updated_at: string;
};
export type BoardsPayload = { rows: BoardRow[] };

export type Place = { x: number; y: number; w: number; h: number };

export type BoardTile =
  | {
      kind: "report";
      tile_id: string;
      report_id: string;
      place: Place;
      name: string;
      presentation_type: ReportRow["presentation_type"];
      render_shape: ReportRow["render_shape"];
    }
  | { kind: "text"; tile_id: string; md: string; place: Place };

export type BoardPayload = {
  id: string;
  name: string;
  created_by: string;
  revision: number;
  updated_at: string;
  tiles: BoardTile[];
};

export const CREATE_BOARD_BODY = z.object({ name: z.string() }).strict();
export type UpdateBoardBody = {
  if_revision: number;
  name?: string;
  tiles?: BoardTile[];
};
type AddBoardItemBody = { report_id: string; if_revision: number };
type AddBoardItemPayload = { added: boolean; board: BoardPayload };

const PLACE_SCHEMA: z.ZodType<Place> = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int(),
    h: z.number().int(),
  })
  .strict();

const BOARD_TILE_SCHEMA: z.ZodType<BoardTile> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("report"),
      tile_id: z.string(),
      report_id: z.string(),
      place: PLACE_SCHEMA,
      name: z.string(),
      presentation_type: PRESENTATION_TYPE_SCHEMA,
      render_shape: RENDER_SHAPE_SCHEMA.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      tile_id: z.string(),
      md: z.string(),
      place: PLACE_SCHEMA,
    })
    .strict(),
]);

export const UPDATE_BOARD_BODY: z.ZodType<UpdateBoardBody> = z
  .object({
    if_revision: z.number().int().positive(),
    name: z.string().optional(),
    tiles: z.array(BOARD_TILE_SCHEMA).optional(),
  })
  .strict();

export const ADD_BOARD_ITEM_BODY: z.ZodType<AddBoardItemBody> = z
  .object({ report_id: z.string(), if_revision: z.number().int().positive() })
  .strict();

const BOARD_ROW_SCHEMA: z.ZodType<BoardRow> = z
  .object({
    id: z.string(),
    name: z.string(),
    count: z.number(),
    created_by: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const BOARDS_PAYLOAD_SCHEMA: z.ZodType<BoardsPayload> = z
  .object({ rows: z.array(BOARD_ROW_SCHEMA) })
  .strict();

export const BOARD_PAYLOAD_SCHEMA: z.ZodType<BoardPayload> = z
  .object({
    id: z.string(),
    name: z.string(),
    created_by: z.string(),
    revision: z.number().int().positive(),
    updated_at: z.string(),
    tiles: z.array(BOARD_TILE_SCHEMA),
  })
  .strict();

export const ADD_BOARD_ITEM_PAYLOAD_SCHEMA: z.ZodType<AddBoardItemPayload> = z
  .object({ added: z.boolean(), board: BOARD_PAYLOAD_SCHEMA })
  .strict();
