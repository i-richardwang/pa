import { useEffect } from "react";
import { z } from "zod";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { compilePresentationBlock } from "@charts";
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
  draftPreview: (sessionKey: string) => ["draft_preview", sessionKey] as const,
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

/** 报告所有者视角的重放：报告页与看板编辑态的瓦片同取这一份。 */
export function reportReplayQueryOptions(id: string) {
  return {
    queryKey: reportKeys.replay(id),
    queryFn: () =>
      getJson(`/dashboard/api/reports/${encodeURIComponent(id)}/replay`, REPLAY_PAYLOAD_SCHEMA),
  };
}

function useReportReplay(id: string) {
  return useQuery(reportReplayQueryOptions(id));
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

/** 归档：报告离开本人清单；它的详情、重放与版本缓存随之撤下。 */
export function useArchiveReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ifRevision }: { id: string; ifRevision: number }) =>
      patchJson(
        `/dashboard/api/reports/${encodeURIComponent(id)}`,
        { action: { type: "archive" }, if_revision: ifRevision } satisfies UpdateReportBody,
        REPORT_DETAIL_SCHEMA,
      ),
    onSuccess: (_updated, { id }) => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.reports });
      queryClient.removeQueries({ queryKey: reportKeys.detail(id) });
      queryClient.removeQueries({ queryKey: reportKeys.replay(id) });
      queryClient.removeQueries({ queryKey: reportKeys.revisions(id) });
    },
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

type DraftRunInput = {
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  view_preferences: ViewPreferences;
  /**
   * 规格未变时沿用的结果：只铸新 View（不执行查询），呈现块在本地按新声明重编。
   * 传 null 表示规格已变，创建 Run 并执行。
   */
  base: ReplayPayload | null;
};

/** 把草稿跑成一份带不可变 Analysis/View 身份的重放载荷。 */
async function runDraft(input: DraftRunInput): Promise<ReplayPayload> {
  const { analysis, view, view_preferences, base } = input;
  if (!base) {
    return postJson(
      "/dashboard/api/analyses",
      { analysis, view, view_preferences },
      REPLAY_PAYLOAD_SCHEMA,
    );
  }
  const materialized = await postJson(
    "/dashboard/api/analysis_views",
    { analysis_id: base.analysis_id, view, view_preferences },
    MATERIALIZED_VIEW_SCHEMA,
  );
  return {
    ...base,
    at: new Date().toISOString(),
    analysis_id: materialized.analysis_id,
    view_id: materialized.view_id,
    view: materialized.view,
    view_preferences: materialized.view_preferences,
    record_projection_bindings: materialized.record_projection_bindings,
    payload: {
      ...base.payload,
      analysis_id: materialized.analysis_id,
      view_id: materialized.view_id,
    },
    render_bundle: { view: base.render_bundle.view, decl: materialized.render_decl },
    presentation: compilePresentationBlock(base.render_bundle.view, materialized.render_decl),
    presentation_notes: undefined,
  };
}

export function useRunDraft() {
  return useMutation({ mutationFn: runDraft });
}

/**
 * 编辑会话的预览结果：会话把已验收的运行结果写进键位 `draftPreview(sessionKey)`，这里读出。
 * 结果只属于当前会话，无观察者即回收（gcTime 0），换会话不会读到上一段的预览。
 */
export function useDraftPreview(sessionKey: string): ReplayPayload | null {
  const query = useQuery({
    queryKey: reportKeys.draftPreview(sessionKey),
    queryFn: skipToken,
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (query.data ?? null) as ReplayPayload | null;
}
