/** 删除只对创建者开放；看板码仅在详情页展示。 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, PackageIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { BoardRow, BoardsPayload } from "@contracts/board_contract";
import type { MePayload } from "@contracts/session_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MenuItem } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ListControlBar,
  ListControlSearch,
  ListPageBody,
  ListScrollBody,
  ListSegment,
  ListSegmentGroup,
  useSetTitlebarActions,
} from "../layout/layout_chrome";
import { HeaderTextAction } from "../layout/view_chrome";
import { ApiError, formatAt } from "../api";
import {
  dashboardKeys,
  errorText,
  useBoards,
  useCreateBoard,
  useDeleteBoard,
} from "../dashboard_queries";
import { boardHash } from "../router";
import { ResourceName, RowMenu, SortableHead, useTableSort } from "../kit/table_kit";
import { performUndoable } from "../kit/undo";

const BOARD_SORT: Record<
  "name" | "creator" | "updated" | "count",
  (row: BoardRow) => string | number | null | undefined
> = {
  name: (row) => row.name,
  creator: (row) => row.created_by,
  updated: (row) => row.updated_at,
  count: (row) => row.count,
};

export function BoardsPage({ me }: { me: MePayload }) {
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  /** 归属分面：控制条左半恒有一组档位。 */
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const queryClient = useQueryClient();
  const boardsQuery = useBoards();
  const deleteBoard = useDeleteBoard();
  const data = boardsQuery.data ?? null;
  const error = errorText(boardsQuery.error);
  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (owner === "mine" && row.created_by !== me.email) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.created_by.toLowerCase().includes(q);
    });
  }, [data?.rows, query, owner, me.email]);
  const { rows, sort, toggle } = useTableSort(filtered, BOARD_SORT);

  useSetTitlebarActions(
    () => (
      <HeaderTextAction onClick={() => setShowCreate(true)}>
        <PlusIcon aria-hidden="true" />
        新建看板
      </HeaderTextAction>
    ),
    [],
  );

  const reloadBoards = () => void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });

  function removeBoard(row: BoardRow) {
    queryClient.setQueryData<BoardsPayload>(dashboardKeys.boards, (current) =>
      current ? { ...current, rows: current.rows.filter((r) => r.id !== row.id) } : current,
    );
    performUndoable({
      title: `已删除「${row.name}」`,
      failureTitle: "删除失败",
      revert: reloadBoards,
      commit: () => deleteBoard.mutateAsync(row.id),
    });
  }

  return (
    <ListPageBody>
      <ListControlBar
        left={
          <ListSegmentGroup label="按归属筛选">
            <ListSegment onClick={() => setOwner("all")} selected={owner === "all"}>
              全部看板
            </ListSegment>
            <ListSegment onClick={() => setOwner("mine")} selected={owner === "mine"}>
              我创建的
            </ListSegment>
          </ListSegmentGroup>
        }
        right={<ListControlSearch aria-label="搜索看板" value={query} onValueChange={setQuery} />}
      />

      <ListScrollBody>
        {error && (
          <Alert className="mt-5" variant="error">
            <CircleAlertIcon />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        {!data ? (
          <div className="mt-5">
            <LoadingMark className="py-16" />
          </div>
        ) : data.rows.length === 0 ? (
          <div className="mt-5">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageIcon />
                </EmptyMedia>
                <EmptyTitle>还没有看板</EmptyTitle>
                <EmptyDescription>
                  新建一个空看板，再去「我的报告」把保存的报告装进来。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="filled" onClick={() => setShowCreate(true)}>
                  <PlusIcon />
                  新建看板
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-5">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有匹配的看板</EmptyTitle>
                <EmptyDescription>换个关键词试试。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="mt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="名称" k="name" sort={sort} onToggle={toggle} />
                  <SortableHead
                    label="创建者"
                    k="creator"
                    sort={sort}
                    onToggle={toggle}
                    className="min-w-[120px]"
                  />
                  <SortableHead
                    label="更新时间"
                    k="updated"
                    sort={sort}
                    onToggle={toggle}
                    className="min-w-[120px]"
                  />
                  <SortableHead
                    label="报告数"
                    k="count"
                    sort={sort}
                    onToggle={toggle}
                    className="min-w-[120px]"
                  />
                  <TableHead className="min-w-[30px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const mine = row.created_by === me.email;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <ResourceName href={boardHash(row.id)}>{row.name}</ResourceName>
                      </TableCell>
                      <TableCell className="text-pa-muted">
                        {mine ? "我" : row.created_by}
                      </TableCell>
                      <TableCell className="text-pa-muted tabular-nums">
                        {formatAt(row.updated_at)}
                      </TableCell>
                      <TableCell className="text-pa-muted tabular-nums">{row.count}</TableCell>
                      <TableCell className="relative p-2 text-right">
                        {mine && (
                          <RowMenu label="看板操作">
                            <MenuItem onClick={() => removeBoard(row)}>
                              <Trash2Icon aria-hidden="true" />
                              删除看板
                            </MenuItem>
                          </RowMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ListScrollBody>

      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => setShowCreate(false)}
      />
    </ListPageBody>
  );
}

function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createBoard = useCreateBoard();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createBoard.mutateAsync(name);
      setName("");
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新建看板</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={submit}>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="board-name">名称</FieldLabel>
              <Input
                id="board-name"
                required
                placeholder="如：人委会看板"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {error && (
              <Field>
                <FieldError match>{error}</FieldError>
              </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
            <Button
              variant="filled"
              type="submit"
              loading={createBoard.isPending}
              disabled={name.trim().length === 0}
            >
              创建
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
