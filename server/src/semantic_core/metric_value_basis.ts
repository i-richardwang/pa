import { z } from "zod";

/**
 * 指标值的业务求值基准：给定一个业务时间桶，这个数实际覆盖桶里的哪一段。
 *
 * 它与时间能力卡回答两个不同的问题，不能互相代替：能力卡说「用户能选什么时间」，
 * 基准说「返回的数代表什么时间」。合并成一张卡时，`aggregation: last` 这类没有查询
 * 限制的指标会投影成空卡，合计位因此把月末快照声明成覆盖整个窗口。
 */
export const METRIC_VALUE_BASES = [
  "bucket_end",
  "whole_bucket",
  "year_start_to_bucket_end",
] as const;

export const METRIC_VALUE_BASIS_INPUT = z
  .enum(METRIC_VALUE_BASES)
  .describe(
    "指标值覆盖桶里的哪一段：bucket_end=桶的最后一个月；whole_bucket=整个桶；" +
      "year_start_to_bucket_end=桶末月所在日历年的一月到桶末月",
  );

export type MetricValueBasis = (typeof METRIC_VALUE_BASES)[number];

/** 基准在一个业务桶上展开出的真实期间。执行与结果声明共用它，两边因此不会分叉。 */
export function basisPeriod(
  basis: MetricValueBasis,
  bucket: { from: string; to: string },
): { from: string; to: string } {
  switch (basis) {
    case "bucket_end":
      return { from: bucket.to, to: bucket.to };
    case "year_start_to_bucket_end":
      return { from: `${bucket.to.slice(0, 4)}-01`, to: bucket.to };
    case "whole_bucket":
      return { from: bucket.from, to: bucket.to };
  }
}

/** 面向用户的短称；错误消息与说明文字都从这里取，措辞只有一处。 */
export function basisLabel(basis: MetricValueBasis): string {
  switch (basis) {
    case "bucket_end":
      return "时点值";
    case "year_start_to_bucket_end":
      return "年初累计值";
    case "whole_bucket":
      return "期间值";
  }
}
