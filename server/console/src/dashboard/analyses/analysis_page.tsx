/** 查询记录回放页：与报告页共用工作台，保存时新建报告。 */
import { AnalysisWorkbench } from "./analysis_workbench";
import { errorText } from "../api";
import { useAnalysisReplay, useCatalogQuery } from "../dashboard_queries";
import { navigateTo, reportHash, reportsHistoryHash } from "../router";
import { useAnalysisEditSession } from "./use_analysis_edit_session";

export function AnalysisPage({ id }: { id: string }) {
  const replayQuery = useAnalysisReplay(id);
  const catalog = useCatalogQuery().data ?? null;
  const data = replayQuery.data ?? null;
  const error = errorText(replayQuery.error);
  const title = data?.payload.title ?? data?.analysis.title ?? "分析回放";
  const edit = useAnalysisEditSession({
    catalog,
    sessionKey: `analysis:${id}`,
    seed: data
      ? {
          name: title,
          analysis: data.analysis,
          view: data.view,
          view_preferences: data.view_preferences,
          hasSavedResult: true,
          ownedViewId: data.view_id,
        }
      : null,
    savedReplay: data,
    target: { kind: "create" },
    onCreated: (report) => navigateTo(reportHash(report.id)),
  });

  return (
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: reportsHistoryHash(), label: "查询记录" }}
      error={error}
      // 回放只有 View id，没有报告或看板 id，无法查询单元格明细。
      recordSource={{ kind: "none" }}
      saveLabel="存为报告"
      session={edit}
      title={title}
    />
  );
}
