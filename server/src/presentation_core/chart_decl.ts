import { z } from "zod";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";
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

/**
 * 交叉表的列轴声明，从外到内。行轴不在声明里：它是结果的余数，由呈现层按实际结果裁决——
 * 输出时间粒度出自引擎（指标时间契约与数据边界都只有它知道），意图层预测不出来。
 */
export const TABLE_COLUMNS_DECL_SCHEMA = z.array(TABLE_AXIS_SCHEMA);

export const SERIES_DISPLAY_SCHEMA = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    type: z.enum(["line", "bar"]).optional(),
    yAxis: z.enum(["left", "right"]).optional(),
  })
  .strict();

export type SeriesDisplay = z.infer<typeof SERIES_DISPLAY_SCHEMA>;

/** 编译后的公共呈现声明；这是服务端与浏览器之间唯一的运行时合同。 */
export const CHART_DECL_SCHEMA = z
  .object({
    type: PRESENTATION_TYPE_SCHEMA,
    tableColumns: TABLE_COLUMNS_DECL_SCHEMA.optional(),
    x: z.string().min(1).optional(),
    y: z.array(z.string().min(1)),
    annotations: z.array(z.string().min(1)).optional(),
    groupBy: z.string().min(1).optional(),
    stack: z.boolean().optional(),
    display: z.record(z.string().min(1), SERIES_DISPLAY_SCHEMA).optional(),
    valueLabels: z.enum(["main", "all"]).optional(),
    shading: TABLE_SHADING_PREFERENCES_INPUT.optional(),
  })
  .strict()
  .superRefine((decl, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (decl.type === "table" || decl.type === "kpi") {
      if (decl.y.length) issue(`${decl.type} 呈现不能包含图表系列`);
      if (
        decl.x !== undefined ||
        decl.annotations !== undefined ||
        decl.groupBy !== undefined ||
        decl.stack !== undefined ||
        decl.display !== undefined ||
        decl.valueLabels !== undefined
      ) {
        issue(`${decl.type} 呈现包含不适用的图表字段`);
      }
      if (decl.type === "kpi" && decl.shading !== undefined) {
        issue("kpi 呈现不能包含表格着色");
      }
      if (decl.type === "kpi" && decl.tableColumns !== undefined) {
        issue("kpi 呈现不能包含表格列轴");
      }
      return;
    }
    if (!decl.y.length) issue(`${decl.type} 呈现至少需要一个图表系列`);
    if (decl.tableColumns !== undefined) issue(`${decl.type} 呈现不能包含表格列轴`);
    if (decl.shading !== undefined) issue(`${decl.type} 呈现不能包含表格着色`);
    if (decl.type === "line" && decl.x !== undefined) issue("line 呈现的时间横轴无需声明 x");
    if ((decl.type === "bar" || decl.type === "pie") && !decl.x) {
      issue(`${decl.type} 呈现缺少分类轴 x`);
    }
    if (decl.type === "pie") {
      if (decl.y.length !== 1) issue("pie 呈现必须且只能包含一个系列");
      if (
        decl.annotations !== undefined ||
        decl.groupBy !== undefined ||
        decl.stack !== undefined ||
        decl.display !== undefined ||
        decl.valueLabels !== undefined
      ) {
        issue("pie 呈现包含不适用的图表字段");
      }
    }
  });

export type ChartDecl = z.infer<typeof CHART_DECL_SCHEMA>;
