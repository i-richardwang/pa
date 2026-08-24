import { useEffect, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CircleAlertIcon, PanelRightIcon, TableIcon } from "lucide-react";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import { LoadingMark, PageFooterBand, ViewPageFooter, ViewRenderer } from "pa-result-view";
import { BROWSER_CARD_ACTIONS } from "../kit/browser_actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EditableText } from "@/components/ui/editable-text";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  useSetTitlebarActions,
  useSetDetailCrumb,
  useSetStageAside,
} from "../layout/layout_chrome";
import { HeaderIconButton, ViewPageError, ViewPageLoading } from "../layout/view_chrome";
import {
  RecordProjectionDialog,
  type RecordProjectionDialogRequest,
} from "../reports/record_projection_dialog";
import { useRecordProjection, type RecordProjectionSource } from "../reports/use_record_projection";
import { semanticSinkQueryView, setDraftTime, timeCapabilitiesOf } from "./analysis_draft";
import { ChartStage, ChartStageHeading } from "./chart_stage";
import { ReportInspector } from "./report_inspector";
import { TimeBar, windowSummary } from "./time_editor";
import type { AnalysisEditSession } from "./use_analysis_edit_session";

const PRESENTATION_NOTE_COPY: Record<string, string> = {
  empty_result: "查询结果为空，以空表显示；图表选择保留，数据满足后自动出图。",
};

export function AnalysisWorkbench({
  crumb,
  title,
  session,
  catalog,
  actions,
  error,
  recordSource,
  saveLabel,
}: {
  /** 列表父级：挂到与列表页名同槽的 titlebar 面包屑。 */
  crumb: { href: string; label: string };
  /** 草稿到位前的题名回落（载入中显示的名字）。 */
  title: string;
  session: AnalysisEditSession;
  catalog: CatalogPayload | null;
  /** 页级动作（归档、版本历史等），排在保存组之前，与面包屑同槽。 */
  actions?: ReactNode;
  error?: string | null;
  /** 明细能力（格点记录弹层）由工作台据此统一派生，宿主页面不自行接线。 */
  recordSource: RecordProjectionSource;
  /** 主保存动作文案：本人报告为「保存」，未落库的分析为「存为报告」。 */
  saveLabel: string;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [recordRequest, setRecordRequest] = useState<RecordProjectionDialogRequest | null>(null);
  // 明细只对已保存的重放开放：草稿态坐标与落库 revision 会交叉，预览一跑即关、保存后恢复。
  const records = useRecordProjection({
    source: recordSource,
    replay: session.activeReplay,
    disabled: !session.showingSavedReplay,
    onRequest: setRecordRequest,
  });

  const isMobile = useIsMobile();
  useEffect(() => {
    setInspectorOpen(!isMobile);
  }, [isMobile]);
  const { draft, setDraft } = session;
  const current = draft?.name ?? title;

  useSetDetailCrumb(
    () => ({ parentHref: crumb.href, parentLabel: crumb.label, current }),
    [crumb.href, crumb.label, current],
  );
  useSetTitlebarActions(
    () => (
      <>
        {actions}
        {session.dirty && (
          <Button disabled={session.saving} onClick={session.discard} variant="subtle">
            放弃改动
          </Button>
        )}
        {session.dirty && session.canSaveAs && (
          <Button
            disabled={session.saving}
            loading={session.saving}
            onClick={() => void session.saveAs()}
            variant="subtle"
          >
            另存为
          </Button>
        )}
        {(session.target.kind === "create" || session.dirty) && (
          <Button
            disabled={!session.canSave}
            loading={session.saving}
            onClick={() => void session.save()}
            variant="filled"
          >
            {saveLabel}
          </Button>
        )}
        {/* 开栏时收起钮住右栏顶带；左题条只在收起后给展开入口。 */}
        {!inspectorOpen ? (
          <HeaderIconButton label="展开配置栏" onClick={() => setInspectorOpen(true)}>
            <PanelRightIcon aria-hidden="true" />
          </HeaderIconButton>
        ) : null}
      </>
    ),
    [
      actions,
      inspectorOpen,
      saveLabel,
      session.canSave,
      session.canSaveAs,
      session.dirty,
      session.saving,
      session.target.kind,
      session.discard,
      session.save,
      session.saveAs,
    ],
  );

  useSetStageAside(
    () =>
      inspectorOpen ? (
        <ReportInspector
          catalog={catalog}
          onCollapse={() => setInspectorOpen(false)}
          session={session}
        />
      ) : null,
    [catalog, inspectorOpen, session],
    // 窄屏上壳把这栏摆成底部 Sheet：背景点击与 Esc 走的是同一个「收起」
    () => setInspectorOpen(false),
  );

  const note = session.presentationNotes[0];
  const replay = session.activeReplay;

  // 常驻时间栏（页面底栏左段）：有结果时进真底栏，首载 / 加载 / 空态 / 错误态用同一底栏壳承接

  const queryView = draft && catalog ? semanticSinkQueryView(draft.analysis) : null;
  const timeBar =
    draft && catalog && queryView ? (
      <TimeBar
        dataAsOf={catalog.data_as_of}
        capabilities={timeCapabilitiesOf(queryView, catalog)}
        grouped={(queryView.dimensions ?? []).length > 0}
        onChange={(time) => setDraft(setDraftTime(draft, time, catalog))}
        time={queryView.time}
      />
    ) : null;

  const presentation = replay?.presentation ?? null;
  const footer =
    replay && presentation ? (
      <ViewPageFooter
        actions={BROWSER_CARD_ACTIONS}
        leading={timeBar ?? undefined}
        payload={replay.payload}
        presentation={presentation}
      />
    ) : (
      <PageFooterBand leading={timeBar ?? undefined} />
    );

  return (
    <>
      <ChartStage
        heading={
          <ChartStageHeading
            sub={queryView ? windowSummary(queryView.time) : undefined}
            title={
              draft ? (
                <EditableText
                  aria-label="报告名称"
                  className="-ml-1 w-[calc(100%+0.5rem)] font-medium"
                  maxLength={100}
                  onValueChange={(name) => setDraft({ ...draft, name })}
                  value={draft.name}
                />
              ) : (
                current
              )
            }
          />
        }
        footer={footer}
      >
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          data-slot="analysis-workbench-stage"
          data-testid="analysis-workbench-stage"
        >
          {note && (
            <Alert className="mx-4 mt-3 mb-0 w-auto shrink-0" variant="warning">
              <CircleAlertIcon />
              <AlertDescription>{PRESENTATION_NOTE_COPY[note.kind] ?? note.note}</AlertDescription>
            </Alert>
          )}
          {error ? (
            <ViewPageError message={error} />
          ) : !draft ? (
            <ViewPageLoading />
          ) : session.previewing || session.resultPending ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <LoadingMark label={session.previewing ? "正在预览" : "正在载入"} />
            </div>
          ) : replay && presentation ? (
            <ViewRenderer
              payload={replay.payload}
              presentation={presentation}
              actions={BROWSER_CARD_ACTIONS}
              records={records}
              scene="page"
            />
          ) : (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TableIcon />
                </EmptyMedia>
                <EmptyTitle>还没有结果</EmptyTitle>
                <EmptyDescription>
                  在右侧选择指标与分组维度，运行预览后即可在此查看结果并调整呈现。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </ChartStage>

      <AlertDialog
        open={session.leaveOpen}
        onOpenChange={(open) => !open && session.resolveLeave(false)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              你对这份分析的改动尚未保存，离开将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button onClick={() => session.resolveLeave(false)} variant="subtle" />}
            >
              继续编辑
            </AlertDialogClose>
            <Button onClick={() => session.resolveLeave(true)} variant="danger">
              放弃修改
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <RecordProjectionDialog request={recordRequest} onClose={() => setRecordRequest(null)} />
    </>
  );
}
