import { useEffect, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PanelRightIcon, TableIcon } from "lucide-react";
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
import { semanticEditableQuery, setDraftTime, timeCapabilitiesOf } from "./analysis_draft";
import { ChartStage, ChartStageHeading } from "./chart_stage";
import { ReportInspector } from "./report_inspector";
import { TimeBar, windowSummary } from "./time_editor";
import type { AnalysisEditSession } from "./use_analysis_edit_session";

const PRESENTATION_NOTE_COPY: Record<string, string> = {
  empty_result: "查询结果为空，暂以空表显示；有数据后会按所选图表显示。",
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
  crumb: { href: string; label: string };
  /** 草稿载入前显示的标题。 */
  title: string;
  session: AnalysisEditSession;
  catalog: CatalogPayload | null;
  actions?: ReactNode;
  error?: string | null;
  /** 工作台据此生成单元格明细弹窗，调用页面无需另行接入。 */
  recordSource: RecordProjectionSource;
  /** 主保存按钮文案：本人报告为「保存」，未保存过的分析为「存为报告」。 */
  saveLabel: string;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [recordRequest, setRecordRequest] = useState<RecordProjectionDialogRequest | null>(null);
  // 只在显示已保存结果时开放明细，草稿的查询条件可能与已保存版本不一致。
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
        {/* 右栏展开时收起按钮在右栏标题栏里，这里只在右栏收起后显示展开按钮。 */}
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
    () => setInspectorOpen(false),
  );

  const note = session.presentationNotes[0];
  const replay = session.activeReplay;

  const queryView = draft && catalog ? semanticEditableQuery(draft.analysis) : null;
  const timeBar =
    draft && catalog && queryView ? (
      <TimeBar
        dataAsOf={catalog.data_as_of}
        capabilities={timeCapabilitiesOf(queryView, catalog)}
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
            <Alert className="mx-4 mt-3 w-auto shrink-0" variant="warning">
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
