import { z } from "zod";
import { TABLE_SHADING_PREFERENCES_INPUT } from "./view_preferences.js";

export const TABLE_AXIS_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), column: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("time"),
      level: z.enum(["bucket", "year", "month"]),
    })
    .strict(),
  z.object({ kind: z.literal("metrics") }).strict(),
]);

export type TableAxis = z.infer<typeof TABLE_AXIS_SCHEMA>;

/** 交叉表的列轴，从外到内；行轴由执行结果中未进入列轴的维度和时间轴组成。 */
export const TABLE_COLUMNS_DECL_SCHEMA = z.array(TABLE_AXIS_SCHEMA);

export const SERIES_DISPLAY_SCHEMA = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    type: z.enum(["line", "bar"]).optional(),
  })
  .strict();

export type SeriesDisplay = z.infer<typeof SERIES_DISPLAY_SCHEMA>;

const MEMBER = z.string().min(1);
const SERIES = z.array(MEMBER).min(1);
const DISPLAY = z.record(MEMBER, SERIES_DISPLAY_SCHEMA);
const VALUE_LABELS = z.enum(["main", "all"]);

/** 编译后的公共呈现声明，服务端与浏览器之间按这份结构传递。 */
export const CHART_DECL_SCHEMA = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("table"),
        tableColumns: TABLE_COLUMNS_DECL_SCHEMA.optional(),
        shading: TABLE_SHADING_PREFERENCES_INPUT.optional(),
      })
      .strict(),
    z.object({ type: z.literal("kpi") }).strict(),
    z
      .object({
        type: z.literal("line"),
        y: SERIES,
        y2: SERIES.optional(),
        annotations: z.array(MEMBER).optional(),
        groupBy: MEMBER.optional(),
        display: DISPLAY.optional(),
        valueLabels: VALUE_LABELS.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("bar"),
        x: MEMBER,
        y: SERIES,
        y2: SERIES.optional(),
        annotations: z.array(MEMBER).optional(),
        groupBy: MEMBER.optional(),
        stack: z.boolean().optional(),
        display: DISPLAY.optional(),
        valueLabels: VALUE_LABELS.optional(),
      })
      .strict(),
    z.object({ type: z.literal("pie"), x: MEMBER, y: z.array(MEMBER).length(1) }).strict(),
  ])
  .superRefine((decl, context) => {
    if (decl.type !== "line" && decl.type !== "bar") return;
    if (decl.groupBy && (decl.y.length !== 1 || decl.y2)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${decl.type} 图使用拆分维度时只能有一个指标`,
      });
    }
    if (decl.y2?.some((member) => decl.y.includes(member))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${decl.type} 图中同一指标不能同时放在主轴和副轴`,
      });
    }
  });

export type ChartDecl = z.infer<typeof CHART_DECL_SCHEMA>;
export type ChartTypeOf<T extends ChartDecl["type"]> = Extract<ChartDecl, { type: T }>;
/** 在绘图区中绘制的图型。 */
export type PlottedDeclType = Extract<ChartDecl["type"], "line" | "bar" | "pie">;
