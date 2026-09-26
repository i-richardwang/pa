/** 聚合后的结果保护规则；support_measure 引用正式指标。 */
export type MinimumSupportResultGuard = {
  kind: "minimum_support";
  support_measure: string;
  threshold: number;
};

export type ResultGuard = MinimumSupportResultGuard;
