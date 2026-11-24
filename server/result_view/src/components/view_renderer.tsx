import { makeTitleOf } from "../../../src/presentation_core/view_shape.js";
import { CircleAlertIcon } from "lucide-react";
import { QueryNotesDetails } from "./query_notes.js";
import { Badge } from "./badge.js";
import { DataTable } from "./data_table.js";
import { Kpis } from "./kpis.js";
import { Notices, noticesVisible } from "./notices.js";
import { ViewChartCanvas } from "./echart.js";
import type { CardActions } from "./view_actions.js";
import { VIEW_SCENES, type ViewScene } from "../scene.js";
import {
  type PresentationBlock,
  sceneInsetClass,
} from "../../../src/presentation_core/chart_config.js";
import {
  freshnessLabel,
  observationSummary,
  type QueryPayload,
  type ViewBlock,
} from "../../../src/semantic_core/query_payload.js";

export type ViewRendererProps = {
  payload: QueryPayload;
  presentation: PresentationBlock;
  actions: CardActions;
  scene: ViewScene;
  allRows?: boolean;
  records?: {
    canOpen: (viewId: string, column: string) => boolean;
    /**
     * `time` 是被点击数值实际覆盖的期间。指标卡的数值覆盖整段期间（降级时为终点月），与任何一行的
     * 时间桶都不同，必须显式传入，明细才能与数值对应；不传时按 `row` 的行键定位时间桶（表格单元格）。
     */
    open: (target: {
      viewId: string;
      column: string;
      row: number;
      time?: { from: string; to: string };
    }) => void;
  };
};

const FALLBACK_TITLE = "查询结果";

function cardTitle(payload: QueryPayload, presentation: PresentationBlock): string {
  return payload.title ?? presentation.structure_title ?? FALLBACK_TITLE;
}

function headerSubtitle(payload: QueryPayload, presentation: PresentationBlock): string | null {
  return payload.title ? (presentation.structure_title ?? null) : null;
}

function countStatement(view: ViewBlock, presentation: PresentationBlock): string | null {
  if (!view.rows.length || presentation.type === "kpi") return null;
  return `共 ${presentation.table.rows.length} 行`;
}

function ViewBody({
  payload,
  presentation,
  actions,
  scene,
  allRows,
  records,
}: {
  payload: QueryPayload;
  presentation: PresentationBlock;
  actions: CardActions;
  scene: ViewScene;
  allRows: boolean;
  records?: ViewRendererProps["records"];
}) {
  const view = payload.view;
  const traits = VIEW_SCENES[scene];
  const { fill } = traits;
  const inset = sceneInsetClass(scene);

  if (!view.rows.length) {
    return (
      <div
        className={`flex flex-col ${fill ? "min-h-0 flex-1 justify-center" : ""} ${inset} ${
          traits.emptyPad
        }`}
      >
        <p className="text-pa-muted">没有找到符合这些条件的数据。</p>
      </div>
    );
  }
  if (presentation.type === "kpi" && presentation.totals) {
    return (
      <div className={`flex flex-col ${fill ? "min-h-0 flex-1" : ""}`}>
        <Kpis
          totals={presentation.totals}
          scene={scene}
          canOpen={(column) => records?.canOpen(view.id, column) ?? false}
          onOpen={(column) => {
            // 指标卡数值的明细使用它的覆盖期间；派生结果的单行没有期间时，使用第一行（也是唯一一行）的时间桶。
            const period = presentation.totals?.metrics.find(
              (metric) => metric.column === column,
            )?.period;
            records?.open({
              viewId: view.id,
              column,
              row: 0,
              ...(period ? { time: { from: period.from, to: period.to } } : {}),
            });
          }}
        />
      </div>
    );
  }

  const canFullscreen = !!actions.requestFullscreen;
  const notices = traits.inlineChrome &&
    noticesVisible(view, presentation.table.rows.length, allRows, canFullscreen) && (
      <div className={`shrink-0 border-pa-line border-t ${inset} py-2`}>
        <Notices
          view={view}
          exportLink={payload.capabilities?.export}
          rowCount={presentation.table.rows.length}
          actions={actions}
          allRows={allRows}
        />
      </div>
    );

  return (
    <div className={`flex flex-col ${fill ? "min-h-0 flex-1" : ""}`}>
      {"chart" in presentation ? (
        <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
          <ViewChartCanvas
            chart={presentation.chart}
            scene={scene}
            canOpenPoint={({ column }) => records?.canOpen(view.id, column) ?? false}
            onPointClick={
              records
                ? ({ row, column }) => records.open({ viewId: view.id, column, row })
                : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          model={presentation.table}
          scene={scene}
          allRows={allRows}
          canOpenCell={(_row, column) =>
            records?.canOpen(view.id, presentation.table.columns[column].formatKey) ?? false
          }
          onOpenCell={(row, column) =>
            records?.open({
              viewId: view.id,
              column: presentation.table.columns[column].formatKey,
              row,
            })
          }
        />
      )}
      {notices}
    </div>
  );
}

export function PageFooterBand({
  leading,
  children,
}: {
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-pa-line border-t px-3 py-3">
      {leading && <div className="flex min-w-0 grow items-center gap-2">{leading}</div>}
      {children}
    </div>
  );
}

export function ViewPageFooter({
  payload,
  presentation,
  actions,
  leading,
}: {
  payload: QueryPayload;
  presentation: PresentationBlock;
  actions: CardActions;
  leading?: React.ReactNode;
}) {
  const view = payload.view;
  const count = countStatement(view, presentation);
  return (
    <PageFooterBand leading={leading}>
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-pa-muted text-xs">
        {view.provenance && <Badge>派生</Badge>}
        {count && <span className="font-medium">{count}</span>}
        {(view.rows.length > 0 || view.observations || view.column_periods) &&
          presentation.type !== "kpi" && (
            <Notices
              view={view}
              exportLink={payload.capabilities?.export}
              rowCount={presentation.table.rows.length}
              actions={actions}
              allRows
            />
          )}
      </div>
    </PageFooterBand>
  );
}

export function ViewRenderer({
  payload,
  presentation,
  actions,
  scene,
  allRows = VIEW_SCENES[scene].allRows,
  records,
}: ViewRendererProps) {
  const traits = VIEW_SCENES[scene];
  const view = payload.view;
  const subtitle = headerSubtitle(payload, presentation);
  const notices = (view.observations ?? []).filter(
    (period) => period.requested || period.requested_date || period.requested_id,
  );
  const missingKeys = view.query_notes.find((note) => note.title === "缺少实体标识");
  const titleOf = makeTitleOf(view);
  const observationNotices = notices
    .filter((period) => notices.length === 1 || period.status !== "observed")
    .map((period) =>
      [period.columns?.map(titleOf).join("、"), observationSummary(period)]
        .filter(Boolean)
        .join(" · "),
    );

  return (
    <>
      {traits.title ? (
        <div className="px-4 pt-3 pb-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-medium text-base text-pa-fg">
              {cardTitle(payload, presentation)}
            </h2>
            {view.provenance && <Badge>派生</Badge>}
          </div>
          <p className="mt-0.5 text-pa-muted text-xs">
            {[...(subtitle ? [subtitle] : []), freshnessLabel(payload)].join(" · ")}
          </p>
        </div>
      ) : null}
      {(observationNotices.length > 0 || missingKeys) && (
        <div className={`shrink-0 ${sceneInsetClass(scene)} py-1.5 text-pa-muted text-xs`}>
          {observationNotices.length === 1 ? (
            <p>{observationNotices[0]}</p>
          ) : observationNotices.length > 1 ? (
            <details>
              <summary className="cursor-pointer">查看未投放或未观测的期间</summary>
              <ul>
                {observationNotices.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {missingKeys && <p>{missingKeys.text}</p>}
        </div>
      )}
      <ViewBody
        key={view.id}
        payload={payload}
        presentation={presentation}
        actions={actions}
        scene={scene}
        allRows={allRows}
        records={records}
      />
      {traits.scopeBand && (
        <div className="flex shrink-0 flex-col items-start gap-2 border-pa-line border-t bg-pa-surface px-4 py-3">
          <div className="flex gap-1.5 text-pa-muted text-xs">
            <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
            {payload.observation_scopes.map((scope) => (
              <p key={scope}>{scope}</p>
            ))}
          </div>
          <QueryNotesDetails payload={payload} />
        </div>
      )}
    </>
  );
}
