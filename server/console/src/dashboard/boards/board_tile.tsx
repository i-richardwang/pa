/**
 * 看板瓦片：以当前浏览者权限运行报告的薄容器——取数、瓦片外壳与编辑动作归本组件，
 * 载荷呈现全部交给 ViewRenderer（与结果卡同一份渲染栈，compact + fill 形态）。
 * 各瓦片独立成败，权限或规格错误不影响整板。
 * chrome 走 TileShell（与文本瓦片同一份）：单行标题头、正文填满且不套滚动容器。
 * 拖拽和缩放由外层画布管理，编辑态整卡可拖；按钮/表单等交互元素经
 * draggableCancel 豁免，见 board_page 的 GridCanvas。
 * 瓦片菜单与整板「编辑看板」分立：查看「打开报告」/「调整并另存」，整板编辑里「编辑报告」。
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  CopyPlusIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { REPLAY_PAYLOAD_SCHEMA } from "@contracts/replay_contract";
import type { TimeIntent } from "@time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingMark, type CardActions, ViewRenderer } from "pa-result-view";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuDangerGroup,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { getJson } from "../api";
import { dashboardKeys, errorText } from "../dashboard_queries";
import type { RecordProjectionDialogRequest } from "../reports/record_projection_dialog";
import { useRecordProjection } from "../reports/use_record_projection";
import { TileShell, tileEditMenuTriggerClass } from "./tile_shell";
import { boardReportEditHash, reportHash } from "../router";

/**
 * 环境动作注入（与回放弹窗同款 web 原生接线）：导出走浏览器新标签页打开签名链接
 * ——不把"打开链接"伪装成下载；剪贴板用原生 API。瓦片常驻全幅形态，不注入 requestFullscreen。
 */
const TILE_ACTIONS: CardActions = {
  exportAction: {
    kind: "open_link",
    run: async (link) => {
      window.open(link.url, "_blank", "noopener");
    },
  },
  copyText: async (text) => navigator.clipboard.writeText(text),
};

function timeKeyOf(time: TimeIntent | null | undefined): string {
  return time ? JSON.stringify(time) : "default";
}

export function TileError({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertTitle>报告无法加载</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

export function BoardTile({
  boardId,
  reportId,
  name,
  editing,
  interacting,
  viewerEmail,
  timeOverride,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRecordProjectionRequest,
  onRemove,
}: {
  boardId: string;
  reportId: string;
  name: string;

  interacting?: boolean;
  /** 编辑态（仅创建者可达）：浮出「…」操作菜单，取数走 owner 端点实时预览 */
  editing?: boolean;
  viewerEmail: string;
  /** 查看态板级时间覆盖；编辑态忽略。 */
  timeOverride?: TimeIntent | null;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 看板页集中承载唯一明细弹层。 */
  onRecordProjectionRequest: (request: RecordProjectionDialogRequest) => void;

  onRemove?: () => void;
}) {
  const override = !editing && timeOverride ? timeOverride : null;
  const timeKey = timeKeyOf(override);
  // 编辑期草稿新加的瓦片尚未落库，board-scoped 端点（校验瓦片在持久化看板内）会 404；
  // 编辑仅创建者可达、瓦片引用的都是本人报告，故编辑期走 owner 端点实时预览，查看期走成员端点。
  const replayQuery = useQuery({
    queryKey: editing
      ? (["tile_replay", boardId, reportId, "editing"] as const)
      : dashboardKeys.boardReportReplay(boardId, reportId, timeKey),
    queryFn: () => {
      if (editing) {
        return getJson(
          `/dashboard/api/reports/${encodeURIComponent(reportId)}/replay`,
          REPLAY_PAYLOAD_SCHEMA,
        );
      }
      const params = override ? `?time=${encodeURIComponent(JSON.stringify(override))}` : "";
      return getJson(
        `/dashboard/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(reportId)}/replay${params}`,
        REPLAY_PAYLOAD_SCHEMA,
      );
    },
  });
  const data = replayQuery.data ?? null;
  const error = errorText(replayQuery.error);
  const ownScope = data?.time_override === "unsupported";
  const records = useRecordProjection({
    scope: "board",
    boardId,
    reportId,
    timeOverride: override,
    replay: data,
    disabled: !!editing || !!interacting,
    onRequest: onRecordProjectionRequest,
  });

  const isReportOwner = data?.caller === viewerEmail;
  const hasReportAction = !!data && (isReportOwner || !!data.payload.analysis_id);
  /**
   * 文案与整板「编辑看板」刻意分立：查看态不说「编辑」，避免像在改板；
   * 整板编辑态才用「编辑报告」。非报告主只给「调整并另存」。
   */
  const reportMenuItem = hasReportAction ? (
    isReportOwner ? (
      <MenuLinkItem href={reportHash(reportId)}>
        {editing ? <PencilIcon aria-hidden="true" /> : <ExternalLinkIcon aria-hidden="true" />}
        {editing ? "编辑报告" : "打开报告"}
      </MenuLinkItem>
    ) : (
      <MenuLinkItem href={boardReportEditHash(boardId, reportId)}>
        <CopyPlusIcon aria-hidden="true" />
        调整并另存
      </MenuLinkItem>
    )
  ) : null;

  const title = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name}</span>
      {ownScope && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="shrink-0 rounded-sm bg-pa-surface px-1.5 font-medium text-pa-muted text-xs leading-5"
                data-testid="tile-own-scope"
              />
            }
          >
            自身口径
          </TooltipTrigger>
          <TooltipPopup>
            <p>该分析含多视图或异窗派生，板级时间覆盖不适用，仍按自身声明运行。</p>
          </TooltipPopup>
        </Tooltip>
      )}
    </span>
  );

  const showMenu = editing || hasReportAction;

  return (
    <TileShell
      title={title}
      interacting={interacting}
      affordance={editing ? "pinned" : "hover"}
      frame="xl"
      actions={
        showMenu ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="瓦片操作"
                  size="icon-xs"
                  variant="subtle"
                  className={tileEditMenuTriggerClass}
                />
              }
            >
              <EllipsisIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end">
              {editing ? (
                <>
                  <MenuItem disabled={!canMoveUp} onClick={onMoveUp}>
                    <ArrowUpIcon aria-hidden="true" />
                    上移
                  </MenuItem>
                  <MenuItem disabled={!canMoveDown} onClick={onMoveDown}>
                    <ArrowDownIcon aria-hidden="true" />
                    下移
                  </MenuItem>
                  {reportMenuItem}
                  {onRemove ? (
                    <MenuDangerGroup>
                      <MenuItem onClick={onRemove}>
                        <Trash2Icon aria-hidden="true" />
                        删除
                      </MenuItem>
                    </MenuDangerGroup>
                  ) : null}
                </>
              ) : (
                reportMenuItem
              )}
            </MenuPopup>
          </Menu>
        ) : undefined
      }
    >
      {error ? (
        <TileError message={error} />
      ) : !data ? (
        <LoadingMark size="small" />
      ) : (
        <ViewRenderer
          payload={data.payload}
          presentation={data.presentation}
          actions={TILE_ACTIONS}
          records={records}
          interacting={!!interacting}
          scene="tile"
        />
      )}
    </TileShell>
  );
}
