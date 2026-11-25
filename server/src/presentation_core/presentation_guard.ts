import { z } from "zod";
import {
  CELL_SCHEMA,
  COLUMN_DECIMALS_SCHEMA,
  COLUMN_FORMAT_SCHEMA,
} from "../semantic_core/query_payload.js";
import type { PresentationBlock } from "./chart_config.js";

const OPTIONAL_AXIS_FORMATS_SCHEMA = z.strictObject({
  x: z.array(COLUMN_FORMAT_SCHEMA.nullable()).optional(),
  y: z.array(COLUMN_FORMAT_SCHEMA.nullable()).optional(),
});

const OPTIONAL_AXIS_DECIMALS_SCHEMA = z.strictObject({
  x: z.array(COLUMN_DECIMALS_SCHEMA.nullable()).optional(),
  y: z.array(COLUMN_DECIMALS_SCHEMA.nullable()).optional(),
});

const CHART_POINT_SCHEMA = z.strictObject({
  row: z.int().nonnegative(),
  column: z.string(),
});

const CHART_LEGEND_ITEM_SCHEMA = z.strictObject({
  name: z.string(),
  color: z.string(),
  format: COLUMN_FORMAT_SCHEMA,
  decimals: COLUMN_DECIMALS_SCHEMA.optional(),
  values: z.array(z.number().nullable()),
  axis: z.union([z.literal(0), z.literal(1)]),
  comparison: z
    .strictObject({
      values: z.array(z.number().nullable()),
      format: COLUMN_FORMAT_SCHEMA,
      decimals: COLUMN_DECIMALS_SCHEMA.optional(),
    })
    .optional(),
  share: z.number().nullable().optional(),
});

const CHART_MODEL_SCHEMA = z
  .strictObject({
    categories: z.array(z.string()).min(1),
    legend: z.array(CHART_LEGEND_ITEM_SCHEMA).min(1),
    axes: OPTIONAL_AXIS_FORMATS_SCHEMA,
    axis_decimals: OPTIONAL_AXIS_DECIMALS_SCHEMA.optional(),
    share: z.strictObject({ title: z.string(), values: z.array(z.number().nullable()) }).optional(),
    total: z
      .strictObject({
        value: z.number(),
        format: COLUMN_FORMAT_SCHEMA,
        decimals: COLUMN_DECIMALS_SCHEMA.optional(),
      })
      .optional(),
    latest: z.strictObject({ index: z.int().nonnegative(), label: z.string() }).optional(),
    pointer: z.enum(["axis", "item"]),
    records: z.strictObject({ points: z.array(z.array(CHART_POINT_SCHEMA.nullable())) }).optional(),
  })
  .superRefine((model, context) => {
    for (const [index, item] of model.legend.entries()) {
      if (item.values.length !== model.categories.length) {
        context.addIssue({
          code: "custom",
          path: ["legend", index, "values"],
          message: "图例值必须与分类逐项对齐",
        });
      }
      if (item.comparison && item.comparison.values.length !== model.categories.length) {
        context.addIssue({
          code: "custom",
          path: ["legend", index, "comparison", "values"],
          message: "对照变化值必须与分类逐项对齐",
        });
      }
    }
    if (model.share && model.share.values.length !== model.categories.length) {
      context.addIssue({
        code: "custom",
        path: ["share", "values"],
        message: "结构占比必须与分类逐项对齐",
      });
    }
    if (model.latest && model.latest.index >= model.categories.length) {
      context.addIssue({
        code: "custom",
        path: ["latest", "index"],
        message: "最新分类索引超出范围",
      });
    }
    if (model.pointer === "item") {
      if (!model.total) {
        context.addIssue({
          code: "custom",
          path: ["total"],
          message: "饼图类图表必须提供总计",
        });
      }
      if (model.legend.some((item) => item.share === undefined)) {
        context.addIssue({
          code: "custom",
          path: ["legend"],
          message: "饼图类图表必须提供每项占比",
        });
      }
    }
    if (model.records) {
      if (model.records.points.length !== model.legend.length) {
        context.addIssue({
          code: "custom",
          path: ["records", "points"],
          message: "明细入口必须与图例逐项对齐",
        });
      }
      model.records.points.forEach((points, index) => {
        if (points.length !== model.categories.length) {
          context.addIssue({
            code: "custom",
            path: ["records", "points", index],
            message: "明细入口必须与分类逐项对齐",
          });
        }
      });
    }
  });

const VIEW_CHART_SCHEMA = z.strictObject({
  form: z.enum(["line", "bar", "pie"]),
  height: z.number().positive(),
  plot_gutter: z.strictObject({ left: z.number().nonnegative().optional() }).optional(),
  plot_inset: z
    .strictObject({
      top: z.number().nonnegative().optional(),
      right: z.number().nonnegative().optional(),
    })
    .optional(),
  layout: z.literal("rank").optional(),
  option: z.record(z.string(), z.unknown()),
  model: CHART_MODEL_SCHEMA,
});

const TABLE_HEADER_PART_SCHEMA = z.strictObject({ key: z.string(), label: z.string() });
const TABLE_COLUMN_SCHEMA = z.strictObject({
  label: z.string(),
  formatKey: z.string(),
  format: COLUMN_FORMAT_SCHEMA.optional(),
  decimals: COLUMN_DECIMALS_SCHEMA.optional(),
  numeric: z.boolean(),
  headerPath: z.array(TABLE_HEADER_PART_SCHEMA).min(1),
});

const SHADING_SCALE_SCHEMA = z.strictObject({
  min: z.number(),
  mid: z.number(),
  max: z.number(),
});
const TABLE_SHADING_SCHEMA = z.strictObject({
  palette: z.string(),
  flipped: z.boolean(),
  values: z.boolean(),
  scales: z.record(z.string(), SHADING_SCALE_SCHEMA),
});

const TABLE_MODEL_SCHEMA = z
  .strictObject({
    columns: z.array(TABLE_COLUMN_SCHEMA),
    rows: z.array(z.array(CELL_SCHEMA)),
    summaryRows: z.array(z.array(CELL_SCHEMA)).optional(),
    sourceRows: z.array(z.array(z.int().nonnegative().nullable())).optional(),
    shading: TABLE_SHADING_SCHEMA.optional(),
  })
  .superRefine((table, context) => {
    const width = table.columns.length;
    for (const key of ["rows", "summaryRows", "sourceRows"] as const) {
      table[key]?.forEach((row, index) => {
        if (row.length !== width) {
          context.addIssue({
            code: "custom",
            path: [key, index],
            message: "表格行宽必须与列数一致",
          });
        }
      });
    }
  });

const TOTAL_PERIOD_SCHEMA = z.strictObject({ label: z.string(), from: z.string(), to: z.string() });
const TOTAL_COMPARISON_SCHEMA = z.strictObject({
  label: z.string(),
  value: CELL_SCHEMA,
  format: COLUMN_FORMAT_SCHEMA,
  decimals: COLUMN_DECIMALS_SCHEMA.optional(),
});
const TOTAL_BAND_SCHEMA = z.strictObject({
  metrics: z
    .array(
      z.strictObject({
        column: z.string(),
        label: z.string(),
        value: CELL_SCHEMA,
        format: COLUMN_FORMAT_SCHEMA,
        decimals: COLUMN_DECIMALS_SCHEMA.optional(),
        period: TOTAL_PERIOD_SCHEMA.optional(),
        comparisons: z.array(TOTAL_COMPARISON_SCHEMA),
      }),
    )
    .min(1),
});

const PRESENTATION_BASE_SCHEMA = {
  table: TABLE_MODEL_SCHEMA,
  structure_title: z.string().optional(),
};

const PRESENTATION_BLOCK_SCHEMA = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("table"), ...PRESENTATION_BASE_SCHEMA }),
  z.strictObject({
    type: z.literal("kpi"),
    ...PRESENTATION_BASE_SCHEMA,
    totals: TOTAL_BAND_SCHEMA,
  }),
  z.strictObject({
    type: z.literal("line"),
    ...PRESENTATION_BASE_SCHEMA,
    chart: VIEW_CHART_SCHEMA.refine((chart) => chart.form === "line"),
  }),
  z.strictObject({
    type: z.literal("bar"),
    ...PRESENTATION_BASE_SCHEMA,
    chart: VIEW_CHART_SCHEMA.refine((chart) => chart.form === "bar"),
  }),
  z.strictObject({
    type: z.literal("pie"),
    ...PRESENTATION_BASE_SCHEMA,
    chart: VIEW_CHART_SCHEMA.refine((chart) => chart.form === "pie"),
  }),
]);

/** 宿主边界校验：浏览器只接受服务端完整编译且形态自洽的呈现块。 */
export function isPresentationBlock(value: unknown): value is PresentationBlock {
  return PRESENTATION_BLOCK_SCHEMA.safeParse(value).success;
}
