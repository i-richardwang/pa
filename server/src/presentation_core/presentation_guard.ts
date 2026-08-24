import { z } from "zod";
import {
  CELL_SCHEMA,
  COLUMN_DECIMALS_SCHEMA,
  COLUMN_FORMAT_SCHEMA,
} from "../semantic_core/query_payload.js";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";
import type { PresentationBlock, ViewChart } from "./chart_config.js";

const OPTIONAL_AXIS_FORMATS_SCHEMA = z
  .object({
    x: z.array(COLUMN_FORMAT_SCHEMA.nullable()).optional(),
    y: z.array(COLUMN_FORMAT_SCHEMA.nullable()).optional(),
  })
  .strict();

const OPTIONAL_AXIS_DECIMALS_SCHEMA = z
  .object({
    x: z.array(COLUMN_DECIMALS_SCHEMA.nullable()).optional(),
    y: z.array(COLUMN_DECIMALS_SCHEMA.nullable()).optional(),
  })
  .strict();

const CHART_POINT_SCHEMA = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.string(),
  })
  .strict();

const CHART_LEGEND_ITEM_SCHEMA = z
  .object({
    name: z.string(),
    color: z.string(),
    format: COLUMN_FORMAT_SCHEMA,
    decimals: COLUMN_DECIMALS_SCHEMA.optional(),
    values: z.array(z.number().finite().nullable()),
    baseline: z.number().int().nonnegative().optional(),
  })
  .strict();

const CHART_MODEL_SCHEMA = z
  .object({
    categories: z.array(z.string()).min(1),
    legend: z.array(CHART_LEGEND_ITEM_SCHEMA).min(1),
    axes: OPTIONAL_AXIS_FORMATS_SCHEMA,
    axis_decimals: OPTIONAL_AXIS_DECIMALS_SCHEMA.optional(),
    share: z
      .object({ title: z.string(), values: z.array(z.number().finite().nullable()) })
      .strict()
      .optional(),
    latest: z
      .object({ index: z.number().int().nonnegative(), label: z.string() })
      .strict()
      .optional(),
    pointer: z.enum(["axis", "item"]),
    records: z
      .object({ points: z.array(z.array(CHART_POINT_SCHEMA.nullable())) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((model, context) => {
    for (const [index, item] of model.legend.entries()) {
      if (item.values.length !== model.categories.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["legend", index, "values"],
          message: "图例值必须与分类逐项对齐",
        });
      }
      if (item.baseline !== undefined && item.baseline >= model.legend.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["legend", index, "baseline"],
          message: "图例对照必须引用现有系列",
        });
      }
      if (item.baseline === index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["legend", index, "baseline"],
          message: "图例不能以自身作为对照",
        });
      }
    }
    if (model.share && model.share.values.length !== model.categories.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["share", "values"],
        message: "结构占比必须与分类逐项对齐",
      });
    }
    if (model.latest && model.latest.index >= model.categories.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latest", "index"],
        message: "最新分类索引超出范围",
      });
    }
    if (model.records) {
      if (model.records.points.length !== model.legend.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["records", "points"],
          message: "记录投影必须与图例逐项对齐",
        });
      }
      model.records.points.forEach((points, index) => {
        if (points.length !== model.categories.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["records", "points", index],
            message: "记录投影必须与分类逐项对齐",
          });
        }
      });
    }
  });

const VIEW_CHART_SCHEMA = z
  .object({
    form: z.enum(["line", "bar", "pie"]),
    height: z.number().finite().positive(),
    plot_gutter: z
      .object({ left: z.number().finite().nonnegative().optional() })
      .strict()
      .optional(),
    plot_inset: z
      .object({
        top: z.number().finite().nonnegative().optional(),
        right: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .optional(),
    layout: z.literal("rank").optional(),
    option: z.record(z.string(), z.unknown()),
    model: CHART_MODEL_SCHEMA,
  })
  .strict();

const TABLE_HEADER_PART_SCHEMA = z.object({ key: z.string(), label: z.string() }).strict();
const TABLE_COLUMN_SCHEMA = z
  .object({
    label: z.string(),
    formatKey: z.string(),
    format: COLUMN_FORMAT_SCHEMA.optional(),
    decimals: COLUMN_DECIMALS_SCHEMA.optional(),
    numeric: z.boolean(),
    headerPath: z.array(TABLE_HEADER_PART_SCHEMA).min(1),
  })
  .strict();

const SHADING_SCALE_SCHEMA = z
  .object({ min: z.number().finite(), mid: z.number().finite(), max: z.number().finite() })
  .strict();
const TABLE_SHADING_SCHEMA = z
  .object({
    palette: z.string(),
    flipped: z.boolean(),
    values: z.boolean(),
    scales: z.record(z.string(), SHADING_SCALE_SCHEMA),
  })
  .strict();

const TABLE_MODEL_SCHEMA = z
  .object({
    columns: z.array(TABLE_COLUMN_SCHEMA),
    rows: z.array(z.array(CELL_SCHEMA)),
    summaryRows: z.array(z.array(CELL_SCHEMA)).optional(),
    sourceRows: z.array(z.array(z.number().int().nonnegative().nullable())).optional(),
    shading: TABLE_SHADING_SCHEMA.optional(),
  })
  .strict()
  .superRefine((table, context) => {
    const width = table.columns.length;
    for (const key of ["rows", "summaryRows", "sourceRows"] as const) {
      table[key]?.forEach((row, index) => {
        if (row.length !== width) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, index],
            message: "表格行宽必须与列数一致",
          });
        }
      });
    }
  });

const TABLE_LAYOUT_STATUS_SCHEMA = z.discriminatedUnion("state", [
  z.object({ state: z.literal("applied"), leafColumns: z.number().int().nonnegative() }).strict(),
  z
    .object({
      state: z.literal("unavailable"),
      leafColumns: z.number().int().nonnegative(),
      reason: z.enum(["duplicate_coordinate", "resource_limit", "missing_axis"]),
      message: z.string(),
    })
    .strict(),
]);

const TOTAL_PERIOD_SCHEMA = z
  .object({ label: z.string(), from: z.string(), to: z.string() })
  .strict();
const TOTAL_COMPARISON_SCHEMA = z
  .object({
    label: z.string(),
    value: CELL_SCHEMA,
    format: COLUMN_FORMAT_SCHEMA,
    decimals: COLUMN_DECIMALS_SCHEMA.optional(),
  })
  .strict();
const TOTAL_BAND_SCHEMA = z
  .object({
    metrics: z
      .array(
        z
          .object({
            column: z.string(),
            label: z.string(),
            value: CELL_SCHEMA,
            format: COLUMN_FORMAT_SCHEMA,
            decimals: COLUMN_DECIMALS_SCHEMA.optional(),
            period: TOTAL_PERIOD_SCHEMA.optional(),
            comparisons: z.array(TOTAL_COMPARISON_SCHEMA),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const PRESENTATION_BLOCK_SCHEMA = z
  .object({
    type: PRESENTATION_TYPE_SCHEMA,
    table: TABLE_MODEL_SCHEMA,
    table_layout: TABLE_LAYOUT_STATUS_SCHEMA,
    structure_title: z.string().optional(),
    chart: VIEW_CHART_SCHEMA.optional(),
    totals: TOTAL_BAND_SCHEMA.optional(),
  })
  .strict();

/** 宿主边界校验：图表块属不可信输入，渲染端只接受完整的可读模型。 */
export function isViewChart(value: unknown): value is ViewChart {
  return VIEW_CHART_SCHEMA.safeParse(value).success;
}

/** 宿主边界校验：浏览器只接受服务端完整编译且形态自洽的呈现块。 */
export function isPresentationBlock(value: unknown): value is PresentationBlock {
  const parsed = PRESENTATION_BLOCK_SCHEMA.safeParse(value);
  if (!parsed.success) return false;
  const block = parsed.data;
  if (block.type === "kpi") return block.chart === undefined && block.totals !== undefined;
  if (block.type === "table") return block.chart === undefined && block.totals === undefined;
  return block.totals === undefined && block.chart?.form === block.type;
}
