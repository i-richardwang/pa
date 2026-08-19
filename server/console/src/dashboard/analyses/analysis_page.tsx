/**
 * 查询记录回放：与报告页同一个工作台，差别只在保存目标是「新建报告」而不是换向已有报告。
 * 名字即题名块里的可编辑标题，保存前改名是同一个动作。
 */
import { AnalysisWorkbench } from "./analysis_workbench";
import { errorText, useAnalysisReplay, useCatalogQuery } from "../dashboard_queries";
import { reportsHistoryHash } from "../router";
import { useAnalysisEditSession } from "./use_analysis_edit_session";

export function AnalysisPage({ id }: { id: string }) {
  const replayQuery = useAnalysisReplay(id);
  const catalog = useCatalogQuery().data ?? null;
  const data = replayQuery.data ?? null;
  const error = errorText(replayQuery.error);
  const title = data?.payload.title ?? data?.analysis.title ?? "分析回放";
  const edit = useAnalysisEditSession({
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
    // 回放是一次取数：规格与结果同来同走，没有可拆的两条腿。
    savedReplay: data,
    target: { kind: "create" },
  });

  return (
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: reportsHistoryHash(), label: "查询记录" }}
      error={error}
      saveLabel="存为报告"
      session={edit}
      title={title}
    />
  );
}
