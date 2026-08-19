import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import type { ViewPreferences } from "../presentation_core/view_preferences.js";

export const ANALYSIS_RETENTION_DAYS = 180;

/** 不可变查询与计算定义；同一 analysis_id 可拥有多个呈现视图。 */
export type AnalysisRecord = {
  id: string;
  owner: string;
  definition: AnalysisDefinition;
  created_at: string;
};

/** 不可变呈现视图；只引用分析，不复制定义或执行结果。 */
export type AnalysisViewRecord = {
  id: string;
  analysis_id: string;
  intent: SemanticViewIntent;
  preferences: ViewPreferences;
  created_at: string;
};

export type OwnedAnalysisView = {
  analysis: AnalysisRecord;
  view: AnalysisViewRecord;
};

export class AnalysisNotFoundError extends Error {}
export class AnalysisViewNotFoundError extends Error {}

export type AnalysisRepository = {
  /** 原子创建分析及其首个视图。 */
  create(
    owner: string,
    definition: AnalysisDefinition,
    intent: SemanticViewIntent,
    preferences?: ViewPreferences,
  ): Promise<OwnedAnalysisView>;
  /** 为已有分析创建另一份呈现视图；不执行查询。 */
  createView(
    owner: string,
    analysisId: string,
    intent: SemanticViewIntent,
    preferences?: ViewPreferences,
  ): Promise<OwnedAnalysisView>;
  getAnalysis(id: string): Promise<AnalysisRecord | null>;
  getView(id: string): Promise<AnalysisViewRecord | null>;
  resolveOwnedAnalysis(id: string, owner: string): Promise<AnalysisRecord>;
  resolveOwnedView(id: string, owner: string): Promise<OwnedAnalysisView>;
  removeExpired(): Promise<number>;
};
