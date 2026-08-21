import { PanelRightIcon } from "lucide-react";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import { HeaderIconButton } from "../layout/view_chrome";
import { Titlebar } from "@/components/ui/titlebar";
import { ReportQueryRail } from "./report_query_rail";
import { ChartOptionsPanel, ChartTypeBar } from "./chart_settings_panel";
import type { AnalysisEditSession } from "./use_analysis_edit_session";

export function ReportInspector({
  catalog,
  session,
  onCollapse,
}: {
  catalog: CatalogPayload | null;
  session: AnalysisEditSession;
  onCollapse: () => void;
}) {
  const draft = session.draft;
  const panel =
    draft && session.activeReplay && catalog
      ? { catalog, draft, onChange: session.setDraft, replay: session.activeReplay }
      : null;

  // 分界线归容器不归本件：作为右栏时那条线是「列与列之间」，作为底部 Sheet 时是 Sheet 自己的
  // 上缘，两种身份都不是配置栏的属性。本件只管自己那一栏的内容。
  return (
    <aside
      aria-label="报告配置"
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-pa-bg"
      data-testid="report-inspector"
      data-slot="report-inspector"
    >
      <Titlebar align="between" className="gap-0">
        <span className="px-2 font-medium text-sm leading-5 text-pa-ink">配置</span>
        <HeaderIconButton label="收起配置栏" onClick={onCollapse}>
          <PanelRightIcon aria-hidden="true" />
        </HeaderIconButton>
      </Titlebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!draft ? (
          <p className="px-4 pt-3 text-sm text-pa-muted leading-5">正在载入配置…</p>
        ) : (
          <ReportQueryRail
            catalog={catalog}
            draft={draft}
            leading={panel ? <ChartTypeBar {...panel} /> : null}
            onChange={session.setDraft}
            onRunPreview={() => void session.runPreview()}
            previewing={session.previewing}
            replay={session.activeReplay}
          >
            {panel ? <ChartOptionsPanel {...panel} /> : null}
          </ReportQueryRail>
        )}
      </div>
    </aside>
  );
}
