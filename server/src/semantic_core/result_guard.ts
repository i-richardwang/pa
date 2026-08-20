/** 聚合后结果保护合同；保护规则只依赖正式指标，不依赖任何业务数据类型。 */
export type MinimumSupportResultGuard = {
  kind: "minimum_support";
  support_measure: string;
  threshold: number;
};

export type ResultGuard = MinimumSupportResultGuard;
