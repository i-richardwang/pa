/**
 * 看板瓦片的分叉调整：保存时以当前身份铸自有 Analysis/View 并新建报告，
 * 不把别人的身份挂到自己名下。
 */
import { AnalysisWorkbench } from "../analyses/analysis_workbench";
import { errorText } from "../api";
import { useBoard, useBoardReportReplay, useCatalogQuery } from "../dashboard_queries";
import { boardHash, navigateTo, reportHash } from "../router";
import { useAnalysisEditSession } from "../analyses/use_analysis_edit_session";

export function BoardReportEditPage({ boardId, reportId }: { boardId: string; reportId: string }) {
  const boardQuery = useBoard(boardId);
  const replayQuery = useBoardReportReplay(boardId, reportId);
  const catalog = useCatalogQuery().data ?? null;
  const board = boardQuery.data ?? null;
  const replay = replayQuery.data ?? null;
  const tile = board?.tiles.find((candidate) => {
    return candidate.kind === "report" && candidate.report_id === reportId;
  });
  const name =
    (tile?.kind === "report" ? tile.name : undefined) ??
    replay?.payload.title ??
    replay?.analysis.title ??
    "分析副本";
  const error = errorText(boardQuery.error) ?? errorText(replayQuery.error);
  const edit = useAnalysisEditSession({
    sessionKey: `board:${boardId}:report:${reportId}`,
    seed:
      board && replay
        ? {
            name,
            analysis: replay.analysis,
            view: replay.view,
            view_preferences: replay.view_preferences,
            hasSavedResult: true,
          }
        : null,
    // 分叉的规格取自那份重放本身。
    savedReplay: replay,
    target: { kind: "create" },
    onCreated: (report) => navigateTo(reportHash(report.id)),
  });

  return (
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: boardHash(boardId), label: board?.name ?? "我的看板" }}
      error={error}
      recordSource={{ kind: "board", boardId, reportId }}
      saveLabel="存为报告"
      session={edit}
      title={name}
    />
  );
}
