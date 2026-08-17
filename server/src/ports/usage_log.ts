export type UsageSummary = {
  row_count?: number;
  has_more?: boolean;
  /** 该 catalog 调用中逐项未命中的业务概念。 */
  unmatched_terms?: string[];
};

export type UsageRecord = UsageSummary & {
  caller: string;
  tool: string;
  /** 分析的业务问题原文。 */
  title?: string;
  /** 落库为 JSON 的完整入参。 */
  args: unknown;
  outcome: "ok" | "error";
  error?: string;
  duration_ms: number;
  analysis_id?: string;
};

export type UsageLog = {
  log(record: UsageRecord): Promise<void>;
  removeExpired(): number;
};
