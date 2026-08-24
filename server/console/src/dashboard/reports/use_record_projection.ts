import { useMemo } from "react";
import type { ReplayPayload } from "@contracts/replay_contract";
import { monthRangeLabel } from "@format";
import type { TimeIntent } from "@time";
import type { ViewRendererProps } from "pa-result-view";
import { toastManager } from "@/components/ui/toast";
import type { RecordProjectionDialogRequest } from "./record_projection_dialog";
import {
  recordProjectionCoordinates,
  recordProjectionTimeCoordinate,
} from "./record_projection_request";

/**
 * 已保存重放的来源身份。明细能力随它派生：服务端只按访问路径授权
 * （自有报告 / 看板成员），来源即请求目标。没有明细端点的宿主
 * （空白草稿、分析回放）显式声明 `none`——缺能力必须是声明，不是遗漏。
 */
export type RecordProjectionSource =
  | { kind: "report"; reportId: string }
  | { kind: "board"; boardId: string; reportId: string; timeOverride?: TimeIntent | null }
  | { kind: "none" };

type RecordProjectionInput = {
  source: RecordProjectionSource;
  /** revision、bindings 与 payload 必须来自同一次重放响应。 */
  replay: ReplayPayload | null;
  disabled: boolean;
  onRequest: (request: RecordProjectionDialogRequest) => void;
};

/** 报告与看板共用的格点记录投影绑定；来源只决定请求目标，不改变坐标推导。 */
export function useRecordProjection({
  source,
  replay,
  disabled,
  onRequest,
}: RecordProjectionInput): ViewRendererProps["records"] {
  // 摊平成原始值再进 useMemo：调用方多在渲染中现造 source 字面量，按引用比较会让
  // 返回值每帧换身份。
  const reportId = source.kind === "none" ? null : source.reportId;
  const boardId = source.kind === "board" ? source.boardId : null;
  const timeOverride = source.kind === "board" ? (source.timeOverride ?? null) : null;
  return useMemo(() => {
    if (!reportId || !replay || replay.revision === undefined || disabled) {
      return undefined;
    }
    const revision = replay.revision;
    const bindingByView = new Map(
      replay.record_projection_bindings.views.map((binding) => [binding.result_view_id, binding]),
    );
    return {
      // 可点性是指标列属性；零值仍可打开并得到诚实的空名单。
      canOpen(viewId, column) {
        return !!bindingByView.get(viewId)?.metrics[column];
      },
      open(cell) {
        const view = replay.payload.view.id === cell.viewId ? replay.payload.view : null;
        const binding = bindingByView.get(cell.viewId);
        const metric = binding?.metrics[cell.column];
        const timeCoordinate = view
          ? recordProjectionTimeCoordinate(view, cell.row, cell.time)
          : null;
        if (!view || !binding || !metric || !timeCoordinate) {
          toastManager.add({
            type: "error",
            title: "无法查看明细",
            description: "当前格子的时间或分组坐标不完整，请刷新后重试。",
          });
          return;
        }
        const coordinates = recordProjectionCoordinates(view, cell.row, binding.dimensions);
        const titleByDimensionId = new Map(
          Object.values(binding.dimensions).map((dimension) => [
            dimension.dimension_id,
            dimension.title,
          ]),
        );
        onRequest({
          target: boardId
            ? {
                kind: "board",
                board_id: boardId,
                report_id: reportId,
                ...(timeOverride ? { time_override: timeOverride } : {}),
              }
            : { kind: "report", report_id: reportId },
          revision,
          result_view_id: cell.viewId,
          metric_id: metric.metric_id,
          coordinates,
          time_coordinate: timeCoordinate,
          data_as_of: replay.payload.data_as_of,
          display: {
            metric_title: metric.title,
            dimensions: coordinates.map((coordinate) => ({
              title: titleByDimensionId.get(coordinate.dimension_id) ?? coordinate.dimension_id,
              value: coordinate.value,
            })),
            time_label: monthRangeLabel(timeCoordinate.from, timeCoordinate.to),
          },
        });
      },
    };
  }, [boardId, disabled, onRequest, replay, reportId, timeOverride]);
}
