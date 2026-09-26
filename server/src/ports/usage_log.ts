export type UsageSummary = {
  row_count?: number;
  has_more?: boolean;
  /** catalog 输入概念数；不保存输入原文。 */
  term_count?: number;
  /** 该 catalog 调用中逐项未命中的业务概念。 */
  unmatched_terms?: string[];
};

/** 使用日志保留天数，过期清理和统计窗口共用。 */
export const USAGE_LOG_RETENTION_DAYS = 90;

export type UsageRecord = UsageSummary & {
  caller: string;
  tool: string;
  /** 分析的业务问题原文。 */
  title?: string;
  outcome: "ok" | "error";
  error?: string;
  duration_ms: number;
  analysis_id?: string;
  view_id?: string;
  query_fingerprint?: string;
  derived_formulas?: string[];
};

export type UsageLog = {
  log(record: UsageRecord): Promise<void>;
  removeExpired(): number;
};
