import type { SemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";

export const ANALYSIS_RETENTION_DAYS = 180;

/** 不可变分析快照：analysis_id 永久标识同一份已验证语义规格。 */
export type AnalysisRecord = {
  id: string;
  owner: string;
  spec: SemanticAnalysisSpec;
  created_at: string;
};

export class AnalysisNotFoundError extends Error {}

export type AnalysisRepository = {
  create(owner: string, spec: SemanticAnalysisSpec): Promise<AnalysisRecord>;
  get(id: string): Promise<AnalysisRecord | null>;
  resolveOwned(id: string, owner: string): Promise<AnalysisRecord>;
  removeExpired(): Promise<number>;
};
