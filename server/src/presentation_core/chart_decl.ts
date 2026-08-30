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
  })
  .strict();

export type SeriesDisplay = z.infer<typeof SERIES_DISPLAY_SCHEMA>;

const MEMBER = z.string().min(1);
const SERIES = z.array(MEMBER).min(1);
const DISPLAY = z.record(MEMBER, SERIES_DISPLAY_SCHEMA);
const VALUE_LABELS = z.enum(["main", "all"]);

/**
 * 编译后的公共呈现声明；这是服务端与浏览器之间唯一的运行时合同。
 * 通道按图型判别：哪个通道属于哪个图型出自这份形状本身，不靠另一套规则复述。
 */
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
    // 跨通道的约束只有两条：拆分通道占掉了系列的来源，值通道就只剩一个位置（因而也没有副轴）；
    // 两把尺子不共享系列。
    if (decl.groupBy && (decl.y.length !== 1 || decl.y2)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${decl.type} 呈现声明拆分通道时值通道只容一个系列`,
      });
    }
    if (decl.y2?.some((member) => decl.y.includes(member))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${decl.type} 呈现声明的同一系列不能同时在主轴与副轴`,
      });
    }
  });

export type ChartDecl = z.infer<typeof CHART_DECL_SCHEMA>;
export type ChartTypeOf<T extends ChartDecl["type"]> = Extract<ChartDecl, { type: T }>;
