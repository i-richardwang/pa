import { useState } from "react";
import { LayoutDashboardIcon, PlusIcon } from "lucide-react";
import type { BoardRow } from "@contracts/board_contract";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteSearch,
  AutocompleteTrigger,
} from "@/components/ui/autocomplete";
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";
import { useAddReportToBoard, useBoards, useCreateBoard } from "../dashboard_queries";
import { HeaderTextAction } from "../layout/view_chrome";
import { boardHash } from "../router";

/** 文档 + 加号图标：lucide 里没有对位，手绘一份。 */
function AddToBoardIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      viewBox="0 0 16 17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M4.25001 0.999878C3.14543 0.999874 2.25 1.89531 2.25 2.99988V8.34638C2.25 8.70537 2.54101 8.99638 2.9 8.99638C3.25899 8.99638 3.55 8.70537 3.55 8.34638V2.99988C3.55 2.61328 3.8634 2.29988 4.25 2.29988L7.86218 2.29989V5.51284C7.86218 6.4103 8.58972 7.13784 9.48718 7.13784L12.7 7.13784V11.8169C12.7 12.2035 12.3866 12.5169 12 12.5169H7.65923C7.30025 12.5169 7.00923 12.8079 7.00923 13.1669C7.00923 13.5258 7.30025 13.8169 7.65923 13.8169H12C13.1046 13.8169 14 12.9214 14 11.8169V6.43992C14 5.89784 13.78 5.37899 13.3903 5.00217L9.8328 1.56214C9.45985 1.2015 8.96134 0.999896 8.44254 0.999894L4.25001 0.999878ZM12.4361 5.88784L9.11218 2.67369V5.51284C9.11218 5.71994 9.28008 5.88784 9.48718 5.88784L12.4361 5.88784Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M2.90001 10.2668C3.25899 10.2668 3.55001 10.5579 3.55001 10.9168V12.5168H5.15C5.50899 12.5168 5.8 12.8079 5.8 13.1668C5.8 13.5258 5.50899 13.8168 5.15 13.8168H3.55001V15.4168C3.55001 15.7758 3.25899 16.0668 2.90001 16.0668C2.54102 16.0668 2.25001 15.7758 2.25001 15.4168V13.8168H0.65C0.291015 13.8168 0 13.5258 0 13.1668C0 12.8079 0.291015 12.5168 0.65 12.5168H2.25001V10.9168C2.25001 10.5579 2.54102 10.2668 2.90001 10.2668Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function AddToBoardAction({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boardsQuery = useBoards(open);
  const addToBoard = useAddReportToBoard();
  const createBoard = useCreateBoard();
  const rows = boardsQuery.data?.rows ?? null;

  async function pick(board: BoardRow) {
    try {
      const result = await addToBoard.mutateAsync({ boardId: board.id, reportId });
      setOpen(false);
      if (result.added) {
        toastManager.add({
          type: "success",
          title: `已加入「${result.board.name}」`,
          description: "可在「我的看板」打开查看。",
        });
      } else {
        toastManager.add({
          type: "success",
          title: `已在「${result.board.name}」中`,
        });
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      toastManager.add({
        type: "error",
        title: "加入看板失败",
        description: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  async function createNew() {
    try {
      const board = await createBoard.mutateAsync("未命名看板");
      const result = await addToBoard.mutateAsync({ boardId: board.id, reportId });
      setOpen(false);
      toastManager.add({
        type: "success",
        title: result.added ? `已新建并加入「${board.name}」` : `已在「${board.name}」中`,
      });
      window.location.hash = boardHash(board.id);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      toastManager.add({
        type: "error",
        title: "新建看板失败",
        description: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return (
    <Autocomplete
      items={rows ?? []}
      itemToStringValue={(item: unknown) => (item as BoardRow).name}
      onOpenChange={setOpen}
      onOpenChangeComplete={() => setQuery("")}
      onValueChange={(next, details) => {
        if (details.reason !== "item-press") setQuery(next);
      }}
      open={open}
      value={query}
    >
      <AutocompleteTrigger render={<HeaderTextAction aria-label="添加到看板" />}>
        <AddToBoardIcon />
        添加到看板
      </AutocompleteTrigger>
      <AutocompletePopup align="end" sideOffset={6} width="list">
        <div className="flex h-11 shrink-0 items-center border-pa-line border-b px-2">
          <div className="min-w-0 flex-1 truncate px-2 pb-0.5 font-medium text-pa-fg text-sm">
            添加到看板
          </div>
          <HeaderTextAction
            className="h-7 gap-1 px-2.5"
            disabled={createBoard.isPending || addToBoard.isPending}
            onClick={() => void createNew()}
          >
            <PlusIcon aria-hidden="true" className="size-4 text-pa-muted" />
            新建
          </HeaderTextAction>
        </div>
        <AutocompleteSearch aria-label="搜索看板" placeholder="搜索" />
        {/* Empty 的根必须常挂着，读屏靠它播报结果条数的变化；变的只是它的孩子。 */}
        <AutocompleteEmpty>
          {rows === null
            ? "载入中…"
            : rows.length === 0
              ? "还没有看板，点「新建」创建"
              : "没有匹配的看板"}
        </AutocompleteEmpty>
        <AutocompleteList className="max-h-56">
          {(board: BoardRow) => (
            <AutocompleteItem
              disabled={addToBoard.isPending}
              key={board.id}
              onClick={() => void pick(board)}
              value={board}
            >
              <LayoutDashboardIcon aria-hidden="true" className="size-4 shrink-0 text-pa-fg" />
              <span className="min-w-0 flex-1 truncate">{board.name}</span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
