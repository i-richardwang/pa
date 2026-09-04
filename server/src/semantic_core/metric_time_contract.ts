import { z } from "zod";
import type { MetricValueBasis } from "./metric_value_basis.js";

export const METRIC_TIME_AGGREGATIONS = ["sum", "average", "last", "recompute"] as const;
export const METRIC_TIME_WINDOWS = ["selected", "year_to_date"] as const;

/** 指标侧的时间合同；业务语义与公共投影见 docs/time_contract.md §2。 */
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

/**
 * 一个指标的时间面已解析的样子：合同本身，加上从它（以及比率的组件）解出的求值基准。
 * 「这个数覆盖哪一段」的一切答案都出自这里，与时间能力卡无关。
 */
export type MetricTimeResolution = {
  contract: MetricTimeContract;
  basis: MetricValueBasis;
};

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
