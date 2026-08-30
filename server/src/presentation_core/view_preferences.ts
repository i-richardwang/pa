/**
 * 人类作者的视觉偏好：只决定同一份聚合结果怎么画。
 * 属 Web 创作面，不进入 Agent MCP schema。
 */
import { z } from "zod";
import { ViewIntentError, type SemanticViewIntent } from "../semantic_core/semantic_analysis.js";

const PREFERENCE_FIELD = z
  .string()
  .min(1)
  .max(120)
  .describe("ViewIntent 中的指标 id 或派生输出列名");

export const SERIES_PREFERENCES_INPUT = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((color) => color.toLowerCase())
      .optional(),
    mark: z.enum(["line", "bar"]).optional(),
  })
  .strict();

export type SeriesPreferences = z.infer<typeof SERIES_PREFERENCES_INPUT>;

/** 双向色阶名（下限→中点→上限的三停色带）；三停取值归 `table_shading.ts`。 */
export const SHADING_PALETTE_NAMES = ["traffic_lights", "red_blue", "viridis", "magma"] as const;
export type ShadingPaletteName = (typeof SHADING_PALETTE_NAMES)[number];

/** 表格热力着色：视觉色阶与印数偏好，不承担业务阈值或指标口径。 */
export const TABLE_SHADING_PREFERENCES_INPUT = z
  .object({
    palette: z.union([
      z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .transform((color) => color.toLowerCase()),
      z.enum(SHADING_PALETTE_NAMES),
    ]),
    flipped: z.boolean().optional(),
    thresholds: z
      .object({
        min: z.number().finite().optional(),
        mid: z.number().finite().optional(),
        max: z.number().finite().optional(),
      })
      .strict()
      .superRefine((thresholds, context) => {
        if (
          thresholds.min !== undefined &&
          thresholds.max !== undefined &&
          thresholds.min > thresholds.max
        ) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "色阶下限不能大于上限" });
        }
        if (
          thresholds.mid !== undefined &&
          ((thresholds.min !== undefined && thresholds.mid < thresholds.min) ||
            (thresholds.max !== undefined && thresholds.mid > thresholds.max))
        ) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "色阶中点必须位于上下限之间" });
        }
      })
      .optional(),
    values: z.boolean().optional(),
  })
  .strict();

export type TableShadingPreferences = z.infer<typeof TABLE_SHADING_PREFERENCES_INPUT>;

export const VIEW_PREFERENCES_INPUT = z
  .object({
    series: z.record(PREFERENCE_FIELD, SERIES_PREFERENCES_INPUT).optional(),
    value_labels: z.enum(["main", "all"]).optional(),
    table_shading: TABLE_SHADING_PREFERENCES_INPUT.optional(),
  })
  .strict();

export type ViewPreferences = z.infer<typeof VIEW_PREFERENCES_INPUT>;

export const EMPTY_VIEW_PREFERENCES: ViewPreferences = Object.freeze({});

/** 去掉空覆盖并稳定成员顺序，保证同一组偏好只有一种持久化表示。 */
export function parseViewPreferences(value: unknown): ViewPreferences {
  const parsed = VIEW_PREFERENCES_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new ViewIntentError(
      `视觉偏好无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const series = parsed.data.series
    ? Object.fromEntries(
        Object.entries(parsed.data.series)
          .filter(([, preferences]) => Object.keys(preferences).length > 0)
          .sort(([left], [right]) => left.localeCompare(right)),
      )
    : undefined;
  return {
    ...(series && Object.keys(series).length ? { series } : {}),
    ...(parsed.data.value_labels ? { value_labels: parsed.data.value_labels } : {}),
    ...(parsed.data.table_shading ? { table_shading: parsed.data.table_shading } : {}),
  };
}

/** 形态级合法性守卫；成员是否属于结果由语义编译器在绑定时继续校验。 */
export function validateViewPreferences(
  intent: SemanticViewIntent,
  value: unknown,
): ViewPreferences {
  const preferences = parseViewPreferences(value);
  const hasSeries = preferences.series !== undefined;
  if (intent.type === "table") {
    if (hasSeries || preferences.value_labels !== undefined) {
      throw new ViewIntentError("表格视觉偏好不接受系列样式或数值标签");
    }
    return preferences;
  }
  if (preferences.table_shading !== undefined) {
    throw new ViewIntentError("表格热力着色只支持 table 呈现");
  }
  if (intent.type === "kpi" || intent.type === "pie") {
    if (hasSeries || preferences.value_labels !== undefined) {
      throw new ViewIntentError(`${intent.type} 呈现不接受系列视觉偏好`);
    }
    return preferences;
  }
  if (intent.group_by && hasSeries) {
    throw new ViewIntentError("拆分系列由分类值动态产生，不能声明固定指标系列偏好");
  }
  if (intent.group_by && preferences.value_labels === "main") {
    throw new ViewIntentError("拆分系列没有主系列；数值标签请改用 all 或删除");
  }
  return preferences;
}
