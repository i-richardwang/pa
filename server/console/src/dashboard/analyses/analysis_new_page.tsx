import { useMemo } from "react";
import { AnalysisWorkbench } from "./analysis_workbench";
import { useCatalogQuery } from "../dashboard_queries";
import { blankAnalysisSeed } from "./analysis_draft";
import { navigateTo, reportHash, reportsHistoryHash } from "../router";
import { useAnalysisEditSession } from "./use_analysis_edit_session";

const BLANK_NAME = "未命名分析";

export function AnalysisNewPage() {
  const catalog = useCatalogQuery().data ?? null;
  // 种子引用须保持不变，换引用会让编辑会话用新种子覆盖用户已录入的草稿。
  const seed = useMemo(() => blankAnalysisSeed(BLANK_NAME), []);
  const edit = useAnalysisEditSession({
    catalog,
    sessionKey: "analysis:new",
    seed,
    target: { kind: "create" },
    onCreated: (report) => navigateTo(reportHash(report.id)),
  });

  return (
    <AnalysisWorkbench
      catalog={catalog}
      crumb={{ href: reportsHistoryHash(), label: "查询记录" }}
      recordSource={{ kind: "none" }}
      saveLabel="存为报告"
      session={edit}
      title={BLANK_NAME}
    />
  );
}
