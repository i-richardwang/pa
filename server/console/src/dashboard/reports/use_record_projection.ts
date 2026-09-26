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
 * 已保存报告的来源，决定明细请求发往哪个端点（服务端按访问路径授权：自有报告或看板成员）。
 * 没有明细端点的页面（空白草稿、分析回放）传 `none`。
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

export function useRecordProjection({
  source,
  replay,
  disabled,
  onRequest,
}: RecordProjectionInput): ViewRendererProps["records"] {
  // 先展开成原始值再作为 useMemo 依赖：调用方通常在渲染时新建 source 对象。
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
            description: "当前单元格的时间或分组信息不完整，请刷新后重试。",
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
