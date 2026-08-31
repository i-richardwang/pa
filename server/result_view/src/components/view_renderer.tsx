/**
 * 一份载荷 → 完整呈现，三个宿主共用。形态判定在服务端，本组件只摆放；
 * 外壳与取数归容器。
 *
 * 配色只认 pa-* 语义令牌：宿主专有令牌会让类名在而 CSS 规则不在。
 */
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
  type QueryPayload,
  type ViewBlock,
} from "../../../src/semantic_core/query_payload.js";

export type ViewRendererProps = {
  payload: QueryPayload;
  /** 唯一结果的服务端确定性呈现产物；判型权在服务端。 */
  presentation: PresentationBlock;
  actions: CardActions;
  /** 宿主场景；chrome 取舍见 VIEW_SCENES。 */
  scene: ViewScene;
  /**
   * 表格全量渲染，运行态：MCP 结果卡在宿主全屏时放开。缺省跟场景默认档。
   */
  allRows?: boolean;
  /** 浏览器报告页注入的格子明细能力；MCP Widget 不注入，因而没有明细请求入口。 */
  records?: {
    /** 能否查看构成记录由指标的记录集绑定决定，与具体值无关——零值同样开放，空集也是诚实答案。 */
    canOpen: (viewId: string, column: string) => boolean;
    /**
     * `time` 是被点击读数的真实覆盖期间：指标卡的大数覆盖整窗（或降级后的终点期），
     * 与任何一行的时间桶都不是同一件事，显式携带才能让名单与读数同一身份；
     * 省略时按 `row` 的行键定位业务桶（表格格子路径）。
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

/**
 * 调用方声明的业务问题优先：它带着措辞与时间窗限定，结果列反推不出来。
 */
function cardTitle(payload: QueryPayload, presentation: PresentationBlock): string {
  return payload.title ?? presentation.structure_title ?? FALLBACK_TITLE;
}

/** 标题为调用方声明时，结构式退到副标题作口径锚点。 */
function headerSubtitle(payload: QueryPayload, presentation: PresentationBlock): string | null {
  return payload.title ? (presentation.structure_title ?? null) : null;
}

/**
 * 行数陈述（KPI 与空结果不陈述）。
 * 常规容器由表格行数条承载，查看面由页脚带承载——同一份措辞，两个归宿。
 */
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
            // 大数的名单沿用它的覆盖期间；派生单行没有期间，退回首行（即唯一一行）的桶。
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

/**
 * 不陈述数据截至：整页的常驻时间栏已经写着期间，底栏再报一次会被读成本次结果的时间。
 * 边界收在时间栏药丸的 Tooltip 里。
 */
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
      {/* 右段取内容宽，避免挤掉左槽 */}
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-pa-muted text-xs">
        {view.provenance && <Badge>派生</Badge>}
        {count && <span className="font-medium">{count}</span>}
        {view.rows.length > 0 && presentation.type !== "kpi" && (
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
