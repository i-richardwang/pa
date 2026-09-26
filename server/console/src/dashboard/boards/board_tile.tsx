/** 以当前浏览者的权限运行报告；单个瓦片失败不影响其他瓦片。 */
import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
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
import { errorText } from "../api";
import { boardReportReplayQueryOptions } from "../dashboard_queries";
import { reportReplayQueryOptions } from "../editor_queries";
import type { RecordProjectionDialogRequest } from "../reports/record_projection_dialog";
import { useRecordProjection } from "../reports/use_record_projection";
import { TileShell, tileEditMenuTriggerClass } from "./tile_shell";
import { boardReportEditHash, reportHash } from "../router";

export function TileError({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <Alert variant="error">
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
  /** 查看时的看板级时间覆盖；编辑时忽略。 */
  timeOverride?: TimeIntent | null;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 明细对话框由看板页统一渲染。 */
  onRecordProjectionRequest: (request: RecordProjectionDialogRequest) => void;

  onRemove?: () => void;
}) {
  const override = !editing && timeOverride ? timeOverride : null;
  // 编辑时新加的瓦片尚未保存，看板端点会返回 404，所以编辑时直接重放报告。
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
  /** 非报告所有者只提供「调整并另存」。 */
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
            使用报告时间
          </TooltipTrigger>
          <TooltipPopup>
            <p>该报告由多个查询组合而成，看板统一设置的时间对它不生效，仍按报告自己的时间运行。</p>
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
