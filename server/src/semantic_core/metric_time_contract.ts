import { z } from "zod";

export const METRIC_TIME_AGGREGATIONS = ["sum", "average", "last", "recompute"] as const;
export const METRIC_TIME_WINDOWS = ["selected", "year_to_date"] as const;

/**
 * 指标侧的时间合同：字段语义、典型映射与能力卡投影见 docs/time_contract.md §2。查询时间不在
 * 指标上复制；year_to_date 标识由 Cube rolling measure 计算的固定年初窗口。
 *
 * `window: year_to_date` 与 `grain: month` 在合同入口 fail-closed：totalPeriodOf 的两族降级
 * 各自成立，前提正是这对声明不并存。
 */
export const METRIC_TIME_CONTRACT_SCHEMA = z
  .object({
    aggregation: z.enum(METRIC_TIME_AGGREGATIONS),
    window: z.enum(METRIC_TIME_WINDOWS),
    grain: z.literal("month").optional(),
  })
  .strict()
  .refine((contract) => !(contract.window === "year_to_date" && contract.grain === "month"), {
    message: "window: year_to_date 与 grain: month 不能并存",
    path: ["grain"],
  });

export type MetricTimeContract = z.infer<typeof METRIC_TIME_CONTRACT_SCHEMA>;

export function parseMetricTimeContract(value: unknown, title: string): MetricTimeContract {
  const parsed = METRIC_TIME_CONTRACT_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new Error(`指标「${title}」缺少有效的时间聚合合同`);
  }
  return parsed.data;
}

export function sameMetricTimeContract(
  left: MetricTimeContract,
  right: MetricTimeContract,
): boolean {
  return (
    left.aggregation === right.aggregation &&
    left.window === right.window &&
    left.grain === right.grain
  );
}
