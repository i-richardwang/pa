import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  REPLAY_PAYLOAD_SCHEMA,
  REPORT_DETAIL_SCHEMA,
  REPORT_REVISIONS_PAYLOAD_SCHEMA,
  type ReplayPayload,
  type ReportDetail,
  type ReportRevisionsPayload,
  type UpdateReportBody,
} from "@contract";
import type { SemanticAnalysisSpec } from "@semantic-analysis";
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

/** 草稿预览：现编译现执行，结果是未落库的临时执行，不写入任何缓存键。 */
export function usePreviewAnalysis() {
  return useMutation({
    mutationFn: (spec: SemanticAnalysisSpec) =>
      postJson("/dashboard/api/analyses", { spec }, REPLAY_PAYLOAD_SCHEMA),
  });
}
