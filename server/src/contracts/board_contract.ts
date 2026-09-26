import { z } from "zod";
import type { ReportRow } from "./report_contract.js";
import { REPORT_ID_SCHEMA } from "./report_identity.js";
import { RENDER_SHAPE_SCHEMA } from "../presentation_core/render_shape.js";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";

export const BOARD_GRID_COLUMNS = 24;
export const MAX_BOARD_TILES = 24;
export const MAX_BOARD_NAME_LENGTH = 50;
export const MAX_BOARD_TEXT_LENGTH = 4000;

export const BOARD_ID_SCHEMA = z.string().uuid();
export const BOARD_NAME_SCHEMA = z.string().trim().min(1).max(MAX_BOARD_NAME_LENGTH);

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

/** 写入只含持久字段；报告名称与呈现类型由服务端读取时补齐。 */
export type BoardMutationTile =
  | { kind: "report"; tile_id: string; report_id: string; place: Place }
  | { kind: "text"; tile_id: string; md: string; place: Place };

export type BoardPayload = {
  id: string;
  name: string;
  created_by: string;
  revision: number;
  updated_at: string;
  tiles: BoardTile[];
};

export const CREATE_BOARD_BODY = z.object({ name: BOARD_NAME_SCHEMA }).strict();
type AddBoardItemPayload = { added: boolean; board: BoardPayload };

const PLACE_SCHEMA: z.ZodType<Place> = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict()
  .superRefine((place, context) => {
    if (place.x + place.w > BOARD_GRID_COLUMNS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `瓦片超出看板宽度：x+w 不能超过 ${BOARD_GRID_COLUMNS} 列`,
      });
    }
  });

const REPORT_MUTATION_TILE_SCHEMA = z
  .object({
    kind: z.literal("report"),
    tile_id: BOARD_ID_SCHEMA,
    report_id: REPORT_ID_SCHEMA,
    place: PLACE_SCHEMA,
  })
  .strict();

const TEXT_MUTATION_TILE_SCHEMA = z
  .object({
    kind: z.literal("text"),
    tile_id: BOARD_ID_SCHEMA,
    md: z.string().max(MAX_BOARD_TEXT_LENGTH),
    place: PLACE_SCHEMA,
  })
  .strict();

export const BOARD_MUTATION_TILE_SCHEMA: z.ZodType<BoardMutationTile> = z.discriminatedUnion(
  "kind",
  [REPORT_MUTATION_TILE_SCHEMA, TEXT_MUTATION_TILE_SCHEMA],
);

export const BOARD_MUTATION_TILES_SCHEMA = z
  .array(BOARD_MUTATION_TILE_SCHEMA)
  .max(MAX_BOARD_TILES)
  .superRefine((tiles, context) => {
    const seen = new Set<string>();
    for (const [index, tile] of tiles.entries()) {
      if (seen.has(tile.tile_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "tile_id"],
          message: `瓦片 tile_id 重复：${tile.tile_id}`,
        });
      }
      seen.add(tile.tile_id);
    }
  });

const BOARD_TILE_SCHEMA: z.ZodType<BoardTile> = z.discriminatedUnion("kind", [
  REPORT_MUTATION_TILE_SCHEMA.extend({
    name: z.string(),
    presentation_type: PRESENTATION_TYPE_SCHEMA,
    render_shape: RENDER_SHAPE_SCHEMA.nullable(),
  }).strict(),
  TEXT_MUTATION_TILE_SCHEMA,
]);

export const UPDATE_BOARD_BODY = z
  .object({
    if_revision: z.number().int().positive(),
    name: BOARD_NAME_SCHEMA.optional(),
    tiles: BOARD_MUTATION_TILES_SCHEMA.optional(),
  })
  .strict();
export type UpdateBoardBody = z.infer<typeof UPDATE_BOARD_BODY>;

export const ADD_BOARD_ITEM_BODY = z
  .object({ report_id: REPORT_ID_SCHEMA, if_revision: z.number().int().positive() })
  .strict();

const BOARD_ROW_SCHEMA: z.ZodType<BoardRow> = z
  .object({
    id: BOARD_ID_SCHEMA,
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
    id: BOARD_ID_SCHEMA,
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
