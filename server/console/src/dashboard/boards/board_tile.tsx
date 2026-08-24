/**
 * 以当前浏览者权限运行报告的薄容器；各瓦片独立成败，权限或规格错误不影响整板。
 */
import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
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
import type { ReplayPayload } from "@contracts/replay_contract";
import type { TimeIntent } from "@time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingMark, ViewRenderer } from "pa-result-view";
import { BROWSER_CARD_ACTIONS } from "../kit/browser_actions";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLinkItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { PopupSection } from "@/components/ui/surface";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { boardReportReplayQueryOptions, errorText } from "../dashboard_queries";
import { reportReplayQueryOptions } from "../editor_queries";
import type { RecordProjectionDialogRequest } from "../reports/record_projection_dialog";
import { useRecordProjection } from "../reports/use_record_projection";
import { TileShell, tileEditMenuTriggerClass } from "./tile_shell";
import { boardReportEditHash, reportHash } from "../router";

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
  // 编辑期草稿瓦片未落库，board-scoped 端点会 404，故编辑期走所有者重放。
  const replayOptions: UseQueryOptions<ReplayPayload, Error, ReplayPayload, readonly unknown[]> =
    editing
      ? reportReplayQueryOptions(reportId)
      : boardReportReplayQueryOptions(boardId, reportId, override);
  const replayQuery = useQuery(replayOptions);
  const data = replayQuery.data ?? null;
  const error = errorText(replayQuery.error);
  const ownScope = data?.time_override === "unsupported";
  const records = useRecordProjection({
    source: { kind: "board", boardId, reportId, timeOverride: override },
    replay: data,
    disabled: !!editing,
    onRequest: onRecordProjectionRequest,
  });

  const isReportOwner = data?.caller === viewerEmail;
  const hasReportAction = !!data && (isReportOwner || !!data.payload.view_id);
  /** 非报告主只给「调整并另存」。 */
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
      affordance={editing ? "pinned" : "hover"}
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
                    <PopupSection>
                      <MenuItem onClick={onRemove}>
                        <Trash2Icon aria-hidden="true" />
                        删除
                      </MenuItem>
                    </PopupSection>
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
          actions={BROWSER_CARD_ACTIONS}
          records={records}
          scene="tile"
        />
      )}
    </TileShell>
  );
}
