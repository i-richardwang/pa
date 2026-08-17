import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CircleAlertIcon, PanelRightIcon, TableIcon } from "lucide-react";
import type { CatalogPayload } from "@contract";
import {
  LoadingMark,
  type CardActions,
  PageFooterBand,
  ViewPageFooter,
  ViewRenderer,
} from "pa-result-view";
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
  useSetDetailChromeActions,
  useSetDetailCrumb,
  useSetStageAside,
} from "../layout/layout_chrome";
import { HeaderIconButton, ViewPageError, ViewPageLoading } from "../layout/view_chrome";
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
  records,
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
  records?: ComponentProps<typeof ViewRenderer>["records"];
  /** 主保存动作文案：本人报告为「保存」，未落库的分析为「存为报告」。 */
  saveLabel: string;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true);

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
  useSetDetailChromeActions(
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

  const queryView = draft && catalog ? semanticSinkQueryView(draft.spec) : null;
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

  // 浏览器环境的真实能力：导出走新开链接，复制走剪贴板。
  const viewActions: CardActions = {
    exportAction: {
      kind: "open_link",
      run: async (link) => {
        window.open(link.url, "_blank", "noopener");
      },
    },
    copyText: async (text) => navigator.clipboard.writeText(text),
  };

  // 图/表档位归本页：切换钮住在结果框外的底栏里，档位不能锁在框内。
  // 结果本体一换即回默认图，不继承上一份结果的 chrome。
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const [prevPayload, setPrevPayload] = useState(replay?.payload);
  if (prevPayload !== replay?.payload) {
    setPrevPayload(replay?.payload);
    setMode("chart");
  }
  const presentation = replay ? (session.preview.presentation ?? replay.presentation) : null;
  const footer =
    replay && presentation ? (
      <ViewPageFooter
        actions={viewActions}
        leading={timeBar ?? undefined}
        mode={mode}
        onModeChange={setMode}
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
              actions={viewActions}
              mode={mode}
              onModeChange={setMode}
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
    </>
  );
}
