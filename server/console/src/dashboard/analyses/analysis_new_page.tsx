import { useMemo } from "react";
import { AnalysisWorkbench } from "./analysis_workbench";
import { useCatalogQuery } from "../dashboard_queries";
import { blankAnalysisSpec } from "./analysis_draft";
import { reportsHistoryHash } from "../router";
import { useAnalysisEditSession } from "./use_analysis_edit_session";

const BLANK_NAME = "未命名分析";

export function AnalysisNewPage() {
  const catalog = useCatalogQuery().data ?? null;
  // 种子恒定：换引用会让编辑会话把用户已录入的草稿当成新种子重播。
  const seed = useMemo(
    () => ({ name: BLANK_NAME, spec: blankAnalysisSpec(BLANK_NAME), hasSavedResult: false }),
    [],
  );
  const edit = useAnalysisEditSession({
    sessionKey: "analysis:new",
    seed,
    target: { kind: "create" },
  });

  return (
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: reportsHistoryHash(), label: "查询记录" }}
      saveLabel="存为报告"
      session={edit}
      title={BLANK_NAME}
    />
  );
}
