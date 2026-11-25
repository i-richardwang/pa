import { z } from "zod";
import { CELL_SCHEMA } from "../semantic_core/query_payload.js";

/** 明细名单最多浏览前 50,000 行。 */
export const RECORD_PROJECTION_MAX_ROWS = 50_000;

/** 个人明细只放在 MCP App 私有元数据里，不进入模型可见的结构化结果。 */
export const RECORD_PROJECTION_META_KEY = "ai.pa/record-projection";

export type RecordProjectionViewBinding = {
  result_view_id: string;
  metrics: Record<string, { metric_id: string; title: string }>;
  dimensions: Record<string, { dimension_id: string; title: string }>;
};

export type RecordProjectionBindings = { views: RecordProjectionViewBinding[] };

export const RECORD_PROJECTION_BINDINGS_SCHEMA: z.ZodType<RecordProjectionBindings> =
  z.strictObject({
    views: z.array(
      z.strictObject({
        result_view_id: z.string(),
        metrics: z.record(z.string(), z.strictObject({ metric_id: z.string(), title: z.string() })),
        dimensions: z.record(
          z.string(),
          z.strictObject({ dimension_id: z.string(), title: z.string() }),
        ),
      }),
    ),
  });

const RECORD_PROJECTION_TIME_COORDINATE = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}$/),
});

export const RECORD_PROJECTION_REQUEST_BODY = z.strictObject({
  revision: z.int().positive(),
  result_view_id: z.string().min(1),
  metric_id: z.string().min(1),
  coordinates: z
    .array(z.strictObject({ dimension_id: z.string().min(1), value: CELL_SCHEMA }))
    .max(20),
  time_coordinate: RECORD_PROJECTION_TIME_COORDINATE,
  data_as_of: z.string().min(1),
  offset: z
    .int()
    .nonnegative()
    .max(RECORD_PROJECTION_MAX_ROWS - 1)
    .default(0),
  limit: z.int().min(1).max(100).default(50),
});

export type RecordProjectionRequestBody = z.infer<typeof RECORD_PROJECTION_REQUEST_BODY>;

export type RecordProjectionPayload = {
  metric_id: string;
  metric_title: string;
  record_set_title: string;
  record_set_description: string;
  /** 列显示标题（Cube 注解），与 column_keys / 每行单元格一一对应。 */
  columns: string[];
  /** 列稳定成员短名，与 columns / 每行单元格一一对应。 */
  column_keys: string[];
  rows: (string | number | null)[][];
  offset: number;
  page_size: number;
  has_more: boolean;
  limit_reached?: true;
  data_as_of: string;
  data_changed: boolean;
};

export const RECORD_PROJECTION_PAYLOAD_SCHEMA: z.ZodType<RecordProjectionPayload> = z
  .strictObject({
    metric_id: z.string(),
    metric_title: z.string(),
    record_set_title: z.string(),
    record_set_description: z.string(),
    columns: z.array(z.string()),
    column_keys: z.array(z.string()),
    rows: z.array(z.array(CELL_SCHEMA)),
    offset: z.int().nonnegative(),
    page_size: z.int().min(1).max(100),
    has_more: z.boolean(),
    limit_reached: z.literal(true).optional(),
    data_as_of: z.string(),
    data_changed: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    if (payload.columns.length !== payload.column_keys.length) {
      ctx.addIssue({
        code: "custom",
        message: "columns 与 column_keys 长度必须一致",
        path: ["column_keys"],
      });
    }
  });
