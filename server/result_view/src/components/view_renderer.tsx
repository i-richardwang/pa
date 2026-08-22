/**
 * 统一渲染器：一份应答载荷 → 完整呈现，三个宿主（MCP widget 结果卡、控制台看板瓦片、
 * 控制台查看面）共用。
 * 呈现形态全部消费服务端编译的 PresentationBlock，本组件只摆放，不做形态判定；
 * 图 = 服务端下发的 echarts 配置，表 = 服务端下发的 TableModel，标题 = 服务端下发的结构式。
 * 一个回答只有一个用户可见结果，形态由作者在规格里声明：声明图就出图，声明表就出表。
 * 内部执行腿不进入交付面。
 *
 * 宿主身份是**一个枚举**：`scene` 取 card / tile / page，chrome 的每项取舍由
 * `VIEW_SCENES`（scene.ts）一张表答完，子构件各自按 scene 查表。新增场景 = 表里加一行。
 *
 * 外壳（边框、圆角、取数、加载与错误态）归容器，本组件只产出载荷派生的内容栈。
 *
 * 配色只认 pa-* 语义令牌，每个宿主在自己的样式表里映射到本宿主调色板；
 * 直接使用宿主专有令牌会让类名在而 CSS 规则不在（由 source_boundary.test.ts 机械校验）。
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

/** 结构派生不出任何一段时的通用标题。 */
const FALLBACK_TITLE = "查询结果";

/**
 * 卡片标题：调用方在查询时声明的业务问题（payload.title）优先——它带着用户的措辞与
 * 过滤/时间窗限定，是结果列反推不出来的；缺省时退服务端派生的结构式标题。
 */
function cardTitle(payload: QueryPayload, presentation: PresentationBlock): string {
  return payload.title ?? presentation.structure_title ?? FALLBACK_TITLE;
}

/**
 * 结构式副标题：标题为调用方声明时，结构式仍作为口径锚点展示在副标题——
 * 标题说意图、副标题说事实，声明与数据错位时读者有对照。
 */
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

/** 单个视图的内容体：指标卡 / 图表 / 表格 + 随附提示；页态下提示让位给页脚带 */
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
    // 空态替掉的是整块结果，故在给定高度的场景里与错误态同规居中；
    // 答数卡高度由内容撑，没有可居中的余量，那一档由 emptyPad 给呼吸。
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
      {presentation.chart ? (
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
      {/* 左槽在场即吃掉全部余量（时间栏优先，右段只取内容宽） */}
      {leading && <div className="flex min-w-0 grow items-center gap-2">{leading}</div>}
      {children}
    </div>
  );
}

/**
 * 查看面页面底栏：左段承接宿主注入的时间栏，行数与导出提示居右。
 *
 * **不陈述数据截至**：整页有常驻时间栏，那里已经写着这份结果读的是哪一段时间；
 * 底栏再报一次数据边界，读者会把它当成本次结果的时间，与自己刚选的期间对不上。
 * 边界本身收进时间栏期间药丸的 Tooltip——要查的时候查得到，不占常驻版面。
 *
 * 它由宿主摆在结果框外（工作台经 `ChartStage` 的 `footer` 槽）。
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
      {/* 右段恒为内容宽度靠右：定占四成会在窄舞台把左槽的时间栏挤到换行 */}
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
      {/* 口径带只在答数态常驻 */}
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
