import { useEffect } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHART_DECL_SCHEMA,
  REPLAY_PAYLOAD_SCHEMA,
  type ReplayPayload,
} from "@contracts/replay_contract";
import {
  REPORT_DETAIL_SCHEMA,
  REPORT_REVISIONS_PAYLOAD_SCHEMA,
  type ReportDetail,
  type ReportRevisionsPayload,
  type UpdateReportBody,
} from "@contracts/report_contract";
import {
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "@semantic-analysis";
import { VIEW_PREFERENCES_INPUT, type ViewPreferences } from "@view-preferences";
import { RECORD_PROJECTION_BINDINGS_SCHEMA } from "@contracts/record_projection_contract";
import { getJson, patchJson, postJson } from "./api";
import { dashboardKeys, errorText } from "./dashboard_queries";

export const reportKeys = {
  detail: (id: string) => ["report", id] as const,
  replay: (id: string) => ["report_replay", id] as const,
  revisions: (id: string) => ["report_revisions", id] as const,
};

/** 重放载荷所依据的版本必须与当前报告详情一致；临时预览（无 revision）视为一致。 */
export function revisionsConsistent(report: ReportDetail, replay: ReplayPayload): boolean {
  return replay.revision === undefined || replay.revision === report.revision;
}

function useReportDetail(id: string) {
  return useQuery({
    queryKey: reportKeys.detail(id),
    queryFn: () =>
      getJson(`/dashboard/api/reports/${encodeURIComponent(id)}`, REPORT_DETAIL_SCHEMA),
  });
}

function useReportReplay(id: string) {
  return useQuery({
    queryKey: reportKeys.replay(id),
    queryFn: () =>
      getJson(`/dashboard/api/reports/${encodeURIComponent(id)}/replay`, REPLAY_PAYLOAD_SCHEMA),
  });
}

/**
 * 报告详情 + 与其版本对位的已存重放，**两跳并排发**。
 *
 * 对账不靠键位靠载荷：重放自己带 revision，与详情对不上就说明两次取数之间报告被改写，
 * 双双拉回后收敛到同一版本。这条守卫与两跳的先后无关，故拆掉串行不影响它。
 */
export function useReportResource(id: string) {
  const queryClient = useQueryClient();
  const detail = useReportDetail(id);
  const replay = useReportReplay(id);
  const report = detail.data ?? null;
  const savedReplay = replay.data ?? null;

  useEffect(() => {
    if (report && savedReplay && !revisionsConsistent(report, savedReplay)) {
      void queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: reportKeys.replay(id) });
    }
  }, [id, queryClient, report, savedReplay]);

  return {
    report,
    savedReplay,
    reportError: errorText(detail.error),
    replayError: errorText(replay.error),
  };
}

export function useReportRevisions(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: reportKeys.revisions(id),
    enabled,
    queryFn: () =>
      getJson(
        `/dashboard/api/reports/${encodeURIComponent(id)}/revisions`,
        REPORT_REVISIONS_PAYLOAD_SCHEMA,
      ),
  });
  return {
    data: (query.data ?? null) as ReportRevisionsPayload | null,
    error: errorText(query.error),
  };
}

export function useUpdateReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateReportBody) =>
      patchJson(`/dashboard/api/reports/${encodeURIComponent(id)}`, body, REPORT_DETAIL_SCHEMA),
    onSuccess: (updated) => {
      queryClient.setQueryData(reportKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.reports });
      void queryClient.resetQueries({ queryKey: reportKeys.replay(id) });
      void queryClient.invalidateQueries({ queryKey: reportKeys.revisions(id) });
    },
  });
}

/** AnalysisDefinition 变更才创建 Run；响应带不可变 Analysis/View 身份。 */
export function usePreviewAnalysis() {
  return useMutation({
    mutationFn: (input: {
      analysis: AnalysisDefinition;
      view: SemanticViewIntent;
      view_preferences: ViewPreferences;
    }) => postJson("/dashboard/api/analyses", input, REPLAY_PAYLOAD_SCHEMA),
  });
}

const MATERIALIZED_VIEW_SCHEMA = z
  .object({
    analysis_id: z.string().uuid(),
    view_id: z.string().uuid(),
    view: SEMANTIC_VIEW_INTENT_INPUT,
    view_preferences: VIEW_PREFERENCES_INPUT,
    render_decl: CHART_DECL_SCHEMA,
    record_projection_bindings: RECORD_PROJECTION_BINDINGS_SCHEMA,
  })
  .strict();

/** ViewIntent/ViewPreferences 变更只创建 View，不执行查询。 */
export function useMaterializeAnalysisView() {
  return useMutation({
    mutationFn: (input: {
      analysis_id: string;
      view: SemanticViewIntent;
      view_preferences: ViewPreferences;
    }) => postJson("/dashboard/api/analysis_views", input, MATERIALIZED_VIEW_SCHEMA),
  });
}
