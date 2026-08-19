import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, PackageIcon } from "lucide-react";
import { Responsive, type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import {
  BOARD_GRID_COLUMNS,
  BOARD_PAYLOAD_SCHEMA,
  type BoardTile as BoardTileData,
} from "@contracts/board_contract";
import type { MePayload } from "@contracts/session_contract";
import type { MyAnalysisRow } from "@contracts/analysis_contract";
import type { ReportRow } from "@contracts/report_contract";
import { LoadingMark, useElementSize } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { AddBoardWidget } from "./add_board_widget";
import { useOpenerFocus } from "@/components/ui/command";
import { AddFromAnalysisDialog } from "./add_from_analysis_dialog";
import { BoardTimeOverride } from "./board_time_override";
import { BoardTile } from "./board_tile";
import { TextTile } from "./text_tile";
import { ApiError, getJson, patchJson } from "../api";
import { dashboardKeys, errorText, useCatalogQuery } from "../dashboard_queries";
import {
  addBoardReport,
  applyBoardLayout,
  beginBoardEdit,
  changeBoardText,
  isBoardEditDirty,
  moveBoardTile,
  newTextTile,
  removeBoardTile,
  tilesInReadingOrder,
  type BoardEditState,
} from "./board_draft";
import { HeaderTextAction } from "../layout/view_chrome";
import {
  useSetDetailChromeActions,
  useSetDetailCrumb,
  useSetMainSurface,
} from "../layout/layout_chrome";
import { CodeCopyButton } from "../kit/copy_button";
import { boardHash, useLeaveBlocker } from "../router";
import {
  RecordProjectionDialog,
  type RecordProjectionDialogRequest,
} from "../reports/record_projection_dialog";
import { SaveReportDialog, type SaveReportTarget } from "../reports/save_report_dialog";
import type { TimeIntent } from "@time";
import {
  CELL_ASPECT,
  GRID_MARGIN,
  MIN_ROW_HEIGHT,
  MOBILE_BREAKPOINT,
  MOBILE_GRID_MARGIN,
  mobileTileHeight,
  TILE_SIZES,
  tileShape,
} from "./tile_sizing";

const GridCanvas = Responsive;

// lg 是唯一可写入持久化的布局；sm 由 lg 派生为单列且不回写，避免多个桌面断点竞争坐标。
const GRID_COLS = { lg: BOARD_GRID_COLUMNS, sm: 1 };
// 断点与间距：≤752 单列；间距取自 tile_sizing 的单源常量，横纵与桌面移动端同值
const GRID_BREAKPOINTS = { lg: MOBILE_BREAKPOINT + 1, sm: 0 };
const GRID_MARGINS = { lg: GRID_MARGIN, sm: MOBILE_GRID_MARGIN };

function deriveRowHeight(canvasWidth: number | undefined): number {
  if (!canvasWidth) return MIN_ROW_HEIGHT;
  const raw = Math.max(canvasWidth / BOARD_GRID_COLUMNS / CELL_ASPECT, MIN_ROW_HEIGHT);
  const hasScroll = document.documentElement.scrollHeight > window.innerHeight;
  return hasScroll ? Math.ceil(raw) : Math.floor(raw);
}

function tileMin(tile: BoardTileData): { minW: number; minH: number } {
  const { minW, minH } = TILE_SIZES[tileShape(tile)];
  return { minW, minH };
}

function buildLayouts(tiles: BoardTileData[]): { lg: Layout; sm: Layout } {
  const lg: Layout = tiles.map((t) => ({ i: t.tile_id, ...t.place, ...tileMin(t) }));
  const stacked = [...tiles].sort((a, b) => a.place.y - b.place.y);
  let cursor = 0;
  const sm: Layout = stacked.map((t) => {
    const h = mobileTileHeight(tileShape(t), t.place.h);
    const item = { i: t.tile_id, x: 0, y: cursor, w: 1, h, minW: 1, minH: 1 };
    cursor += h;
    return item;
  });
  return { lg, sm };
}

export function BoardPage({
  me,
  id,
  timeOverride = null,
}: {
  me: MePayload;
  id: string;
  /** 板级时间覆盖（来自 hash `?t=`）；驱动查看态瓦片重放，编辑态只作设置入口。 */
  timeOverride?: TimeIntent | null;
}) {
  const [draft, setDraft] = useState<BoardEditState | null>(null);
  // 「从分析」两步：先 AddFromAnalysisDialog 选记录，再 SaveReportDialog 命名保存报告
  const [fromAnalysisOpen, setFromAnalysisOpen] = useState(false);
  /** 选记录面没有触发件；归还目标见 `useOpenerFocus`。 */
  const fromAnalysisFocus = useOpenerFocus();

  function openFromAnalysis(next: boolean) {
    if (next) fromAnalysisFocus.capture();
    setFromAnalysisOpen(next);
  }
  const [saveTarget, setSaveTarget] = useState<SaveReportTarget | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [recordProjectionRequest, setRecordProjectionRequest] =
    useState<RecordProjectionDialogRequest | null>(null);
  // 离开确认的 promise resolver：useLeaveBlocker 拦截导航时挂起，用户抉择后兑现
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null);
  // 拖拽/缩放进行中：瓦片据此冻结重图的重渲
  const [interacting, setInteracting] = useState(false);
  const beginInteraction = useCallback(() => {
    setRecordProjectionRequest(null);
    setInteracting(true);
  }, []);
  const endInteraction = useCallback(() => setInteracting(false), []);
  const { ref: canvasRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const rowHeight = deriveRowHeight(canvasSize?.width);

  const queryClient = useQueryClient();
  const boardQuery = useQuery({
    queryKey: dashboardKeys.board(id),
    queryFn: () => getJson(`/dashboard/api/boards/${encodeURIComponent(id)}`, BOARD_PAYLOAD_SCHEMA),
  });
  const data = boardQuery.data ?? null;
  const catalogQuery = useCatalogQuery();
  const dataAsOf = catalogQuery.data?.data_as_of ?? "未知";
  const error = errorText(boardQuery.error);

  // 保存看板：写回详情缓存并失效看板列表（名称/瓦片数变化随之刷新）。
  const saveBoard = useMutation({
    mutationFn: (body: { if_revision: number; name: string; tiles: BoardTileData[] }) =>
      patchJson(`/dashboard/api/boards/${encodeURIComponent(id)}`, body, BOARD_PAYLOAD_SCHEMA),
    onSuccess: (updated) => {
      queryClient.setQueryData(dashboardKeys.board(id), updated);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });
    },
  });

  // 切换看板即弃草稿；详情随 id 键位自动重取。
  useEffect(() => {
    setDraft(null);
    setRecordProjectionRequest(null);
  }, [id]);

  const isCreator = !!data && data.created_by === me.email;
  const editing = draft !== null;
  const tiles = draft?.tiles ?? data?.tiles ?? [];
  const dirty = !!draft && !!data && isBoardEditDirty(draft, data);

  useSetDetailCrumb(
    () => ({
      parentHref: "#/boards",
      parentLabel: "我的看板",
      current: (editing ? draft?.name : data?.name) || "看板",
    }),
    [editing, draft?.name, data?.name],
  );

  useSetMainSurface("canvas");

  const enterEdit = useCallback(() => {
    if (!data) return;
    setRecordProjectionRequest(null);
    setDraft(beginBoardEdit(data));
  }, [data]);

  const confirmLeave = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        leaveResolve.current = resolve;
        setLeaveOpen(true);
      }),
    [],
  );
  useLeaveBlocker(dirty, confirmLeave);

  function resolveLeave(ok: boolean) {
    leaveResolve.current?.(ok);
    leaveResolve.current = null;
    setLeaveOpen(false);
    if (ok) {
      setDraft(null);
    }
  }

  const closeAddDialogs = useCallback(() => {
    setFromAnalysisOpen(false);
    setSaveTarget(null);
  }, []);

  const cancelEdit = useCallback(async () => {
    if (dirty) {
      const confirmed = await confirmLeave();
      if (!confirmed) return;
    } else {
      setDraft(null);
    }
    closeAddDialogs();
  }, [dirty, confirmLeave, closeAddDialogs]);

  const save = useCallback(async () => {
    if (!data || !draft) return;
    try {
      await saveBoard.mutateAsync({
        if_revision: data.revision,
        name: draft.name,
        tiles: draft.tiles,
      });
      setDraft(null);
      closeAddDialogs();
      toastManager.add({ type: "success", title: "已保存看板" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toastManager.add({
        type: "error",
        title: "保存失败",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [data, draft, saveBoard, closeAddDialogs]);

  /** 完成：有改动则落库并退出，无改动直接退出。 */
  const finishEdit = useCallback(async () => {
    if (!draft) return;
    if (!dirty) {
      setDraft(null);
      closeAddDialogs();
      return;
    }
    await save();
  }, [draft, dirty, closeAddDialogs, save]);

  /**
   * 编辑态题条只放「取消」+「完成」；「重命名」沉到卡内 hero（仍开同一对话，不挤题条）。
   * 板级时间设置入口亦在 hero。
   */
  useSetDetailChromeActions(() => {
    const setTime = (next: TimeIntent | null) => {
      window.location.hash = boardHash(id, next).slice(1);
    };
    if (editing) {
      return (
        <>
          <HeaderTextAction disabled={saveBoard.isPending} onClick={() => void cancelEdit()}>
            取消
          </HeaderTextAction>
          <Button
            variant="filled"
            disabled={saveBoard.isPending}
            loading={saveBoard.isPending}
            onClick={() => void finishEdit()}
          >
            完成
          </Button>
        </>
      );
    }
    return (
      <>
        {data && (
          <CodeCopyButton
            code={data.id}
            label="看板 ID"
            hint="复制看板 ID——看板地址 #/board/<看板 id>，链接可直接转发"
          />
        )}
        <BoardTimeOverride dataAsOf={dataAsOf} time={timeOverride} onChange={setTime} />
        {isCreator ? <HeaderTextAction onClick={enterEdit}>编辑看板</HeaderTextAction> : null}
      </>
    );
  }, [
    editing,
    data,
    dataAsOf,
    timeOverride,
    isCreator,
    enterEdit,
    id,
    saveBoard.isPending,
    cancelEdit,
    finishEdit,
  ]);

  /** RGL 布局变更回写草稿：只认桌面（lg）坐标，移动端单列堆叠不落库；无实变化则跳过避免自激。 */
  function applyLayout(_current: Layout, all: Partial<Record<string, Layout>>) {
    const lg = all.lg;
    if (!lg) return;
    setDraft((current) => (current ? applyBoardLayout(current, lg) : current));
  }

  function addReport(report: ReportRow) {
    setDraft((current) => (current ? addBoardReport(current, report) : current));
  }
  function addText() {
    setDraft((current) =>
      current ? { ...current, tiles: [...current.tiles, newTextTile(current.tiles)] } : current,
    );
  }
  /** 草稿级移除 + Undo：撤销原位还原。 */
  function removeTile(tileId: string) {
    const removed = draft?.tiles.find((t) => t.tile_id === tileId);
    setDraft((current) => (current ? removeBoardTile(current, tileId) : current));
    if (removed) {
      toastManager.add({
        type: "success",
        title: "已从看板移除",
        actionProps: {
          children: "撤销",
          onClick: () =>
            setDraft((current) =>
              current ? { ...current, tiles: [...current.tiles, removed] } : current,
            ),
        },
      });
    }
  }
  function changeMd(tileId: string, md: string) {
    setDraft((current) => (current ? changeBoardText(current, tileId, md) : current));
  }

  function moveTile(tileId: string, direction: "up" | "down") {
    setDraft((current) => (current ? moveBoardTile(current, tileId, direction) : current));
  }

  const addedIds = useMemo(
    () => new Set((draft?.tiles ?? []).flatMap((t) => (t.kind === "report" ? [t.report_id] : []))),
    [draft?.tiles],
  );
  const readingOrder = useMemo(() => tilesInReadingOrder(tiles), [tiles]);
  const layouts = buildLayouts(tiles);
  const boardTitle = (editing ? draft?.name : data?.name) || "看板";

  const setTime = (next: TimeIntent | null) => {
    window.location.hash = boardHash(id, next).slice(1);
  };

  return (
    <>
      <div className="min-h-full flex-1 px-6 py-12 md:px-[60px]">
        <div
          className={
            editing
              ? "pa-board-editing rounded-2xl bg-pa-bg p-8 md:p-[54px]"
              : "rounded-2xl bg-pa-bg p-8 md:p-[54px]"
          }
          data-slot="board-section"
        >
          <div ref={canvasRef}>
            {error && (
              <Alert className="mb-8" variant="error">
                <CircleAlertIcon />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {!data && !error ? (
              <LoadingMark className="py-24" />
            ) : data ? (
              <>
                <div className="mb-12 min-w-0" data-slot="board-hero">
                  {editing ? (
                    <div className="mb-4">
                      <BoardTimeOverride
                        dataAsOf={dataAsOf}
                        editing
                        time={timeOverride}
                        onChange={setTime}
                      />
                    </div>
                  ) : null}
                  {/* 编辑态标题也是只读字；改名入口在 hero，不回题条 */}
                  <div className="flex min-w-0 items-end gap-3">
                    <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-pa-fg">
                      {boardTitle}
                    </h1>
                    {editing ? (
                      <HeaderTextAction
                        className="mb-1 shrink-0"
                        disabled={saveBoard.isPending}
                        onClick={() => {
                          setRenameDraft(draft?.name ?? "");
                          setRenameOpen(true);
                        }}
                      >
                        重命名
                      </HeaderTextAction>
                    ) : null}
                  </div>
                </div>

                {tiles.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <PackageIcon />
                      </EmptyMedia>
                      <EmptyTitle>这个看板还没有瓦片</EmptyTitle>
                      <EmptyDescription>
                        {editing
                          ? "用下方「添加瓦片」从报告库加入，或插入文本说明。"
                          : "维护人可点右上「编辑看板」加入报告与文本。"}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : canvasSize === null ? null : (
                  <GridCanvas
                    width={canvasSize.width}
                    layouts={layouts}
                    breakpoints={GRID_BREAKPOINTS}
                    cols={GRID_COLS}
                    rowHeight={rowHeight}
                    margin={GRID_MARGINS}
                    containerPadding={[0, 0]}
                    isDraggable={editing}
                    isResizable={editing}
                    // 编辑态整卡可拖；交互元素（浮出操作面板与一切控件）豁免。
                    draggableCancel="[data-dontdrag], button, a, input, textarea, select"
                    compactType="vertical"
                    onLayoutChange={editing ? applyLayout : undefined}
                    onDragStart={beginInteraction}
                    onDragStop={endInteraction}
                    onResizeStart={beginInteraction}
                    onResizeStop={endInteraction}
                  >
                    {tiles.map((tile) => {
                      const orderIdx = readingOrder.findIndex((t) => t.tile_id === tile.tile_id);
                      const canMoveUp = orderIdx > 0;
                      const canMoveDown = orderIdx >= 0 && orderIdx < readingOrder.length - 1;
                      return (
                        // 不设 overflow-hidden：浮出操作面板要越过卡缘；内容裁切归 TileShell 卡面
                        <div key={tile.tile_id} className="min-h-0 min-w-0">
                          {tile.kind === "text" ? (
                            <TextTile
                              md={tile.md}
                              editing={editing}
                              interacting={interacting}
                              canMoveUp={canMoveUp}
                              canMoveDown={canMoveDown}
                              onMoveUp={() => moveTile(tile.tile_id, "up")}
                              onMoveDown={() => moveTile(tile.tile_id, "down")}
                              onChangeMd={(md) => changeMd(tile.tile_id, md)}
                              onRemove={editing ? () => removeTile(tile.tile_id) : undefined}
                            />
                          ) : (
                            <BoardTile
                              boardId={data.id}
                              reportId={tile.report_id}
                              name={tile.name}
                              editing={editing}
                              interacting={interacting}
                              viewerEmail={me.email}
                              timeOverride={timeOverride}
                              canMoveUp={canMoveUp}
                              canMoveDown={canMoveDown}
                              onMoveUp={() => moveTile(tile.tile_id, "up")}
                              onMoveDown={() => moveTile(tile.tile_id, "down")}
                              onRecordProjectionRequest={setRecordProjectionRequest}
                              onRemove={editing ? () => removeTile(tile.tile_id) : undefined}
                            />
                          )}
                        </div>
                      );
                    })}
                  </GridCanvas>
                )}

                {editing ? (
                  <div className="mt-8">
                    <AddBoardWidget
                      addedIds={addedIds}
                      onAddText={addText}
                      onFromAnalysis={() => openFromAnalysis(true)}
                      onPickReport={addReport}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      <RecordProjectionDialog
        request={recordProjectionRequest}
        onClose={() => setRecordProjectionRequest(null)}
      />

      <AddFromAnalysisDialog
        open={fromAnalysisOpen}
        onOpenChange={openFromAnalysis}
        finalFocus={fromAnalysisFocus.finalFocus}
        onPick={(row: MyAnalysisRow) => {
          setFromAnalysisOpen(false);
          if (row.view_id) setSaveTarget({ id: row.view_id, title: row.title });
        }}
      />

      <SaveReportDialog
        target={saveTarget}
        onClose={() => setSaveTarget(null)}
        onSaved={(row) => {
          addReport(row);
          toastManager.add({ type: "success", title: `已加入看板「${row.name}」` });
        }}
      />

      <AlertDialog open={leaveOpen} onOpenChange={(o) => !o && resolveLeave(false)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              你对这块看板的改动尚未保存，离开将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="subtle" onClick={() => resolveLeave(false)} />}
            >
              留在此页
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="danger" onClick={() => resolveLeave(true)} />}
            >
              放弃并离开
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) setRenameDraft("");
        }}
      >
        <DialogPopup className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名看板</DialogTitle>
          </DialogHeader>
          <Form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              const next = renameDraft.trim();
              if (!next) return;
              setDraft((current) => (current ? { ...current, name: next } : current));
              setRenameOpen(false);
            }}
          >
            <DialogPanel className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="board-rename">名称</FieldLabel>
                <Input
                  autoFocus
                  id="board-rename"
                  maxLength={100}
                  required
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                />
              </Field>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
              <Button variant="filled" type="submit" disabled={renameDraft.trim().length === 0}>
                确定
              </Button>
            </DialogFooter>
          </Form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
