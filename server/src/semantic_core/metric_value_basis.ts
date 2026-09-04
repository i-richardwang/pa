import { z } from "zod";

/** 指标值的业务求值基准：给定一个业务时间桶，这个数实际覆盖桶里的哪一段。 */
const METRIC_VALUE_BASES = ["bucket_end", "whole_bucket", "year_start_to_bucket_end"] as const;

export const METRIC_VALUE_BASIS_INPUT = z
  .enum(METRIC_VALUE_BASES)
  .describe(
    "指标值覆盖桶里的哪一段：bucket_end=桶的最后一个月；whole_bucket=整个桶；" +
      "year_start_to_bucket_end=桶末月所在日历年的一月到桶末月",
  );

export type MetricValueBasis = (typeof METRIC_VALUE_BASES)[number];

/**
 * 基准在一个业务桶上展开出的真实期间。执行、结果声明与协议校验共用这一处展开。
 *
 * degraded 表示该指标在这个桶上没有合计（按月定义的指标遇上跨月桶），值只在桶末当月成立。
 */
export function basisPeriod(
  basis: MetricValueBasis,
  bucket: { from: string; to: string },
  degraded = false,
): { from: string; to: string } {
  if (degraded) return { from: bucket.to, to: bucket.to };
  switch (basis) {
    case "bucket_end":
      return { from: bucket.to, to: bucket.to };
    case "year_start_to_bucket_end":
      return { from: `${bucket.to.slice(0, 4)}-01`, to: bucket.to };
    case "whole_bucket":
      return { from: bucket.from, to: bucket.to };
  }
}

/** 三种基准的业务短称与一句话口径；面向用户和 Agent 的措辞只有这一份。 */
const BASIS_WORDING: Record<MetricValueBasis, { label: string; detail: string }> = {
  bucket_end: { label: "时点值", detail: "每个时间桶只取桶末那个月的值，不跨月累计" },
  whole_bucket: { label: "期间值", detail: "按本指标自己的口径在整个时间桶上求值" },
  year_start_to_bucket_end: {
    label: "年初累计值",
    detail: "每个时间桶取桶末月所在日历年的一月到该月",
  },
};

export function basisLabel(basis: MetricValueBasis): string {
  return BASIS_WORDING[basis].label;
}

/** 随指标列的说明一同交付，不读 Skill 的调用方也能知道这一列的数代表哪一段时间。 */
export function basisNote(basis: MetricValueBasis): string {
  const { label, detail } = BASIS_WORDING[basis];
  return `${label}：${detail}`;
}
