import { PlusIcon } from "lucide-react";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";
import { LoadingMark } from "pa-result-view";
import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MenuItem } from "@/components/ui/menu";
import { PopupSection } from "@/components/ui/surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorText } from "../api";
import {
  useAdminBusinessTerms,
  useBusinessTerms,
  useCatalogQuery,
  useDeleteBusinessTerm,
  useMe,
  useRestoreBusinessTerm,
} from "../dashboard_queries";
import { BusinessTermEditorDialog } from "./business_term_editor";
import { filterTerms } from "./catalog_filters";
import { toastWithUndo } from "../kit/undo";
import {
  ListCategoryPill,
  ListControlBar,
  ListControlSearch,
  ListPageBody,
  ListScrollBody,
  useSetTitlebarActions,
} from "../layout/layout_chrome";
import { HeaderTextAction } from "../layout/view_chrome";
import { EmptyPanel } from "../kit/empty_panel";
import { RowMenu } from "../kit/table_kit";
import { usePrefilledKeyword } from "./prefill";

export function BusinessTermsPage() {
  const isAdmin = useMe().data?.is_admin ?? false;
  const catalogQuery = useCatalogQuery();
  const termsQuery = useBusinessTerms();
  const adminTermsQuery = useAdminBusinessTerms(isAdmin);
  const error = errorText(termsQuery.error) ?? errorText(adminTermsQuery.error);
  const loading = isAdmin ? adminTermsQuery.isLoading : termsQuery.isLoading;
  const [keyword, setKeyword] = usePrefilledKeyword();
  const [editing, setEditing] = useState<PublicBusinessTerm | "new" | null>(null);
  const removeTerm = useDeleteBusinessTerm();
  const restoreTerm = useRestoreBusinessTerm();

  const terms: PublicBusinessTerm[] = isAdmin
    ? (adminTermsQuery.data?.rows ?? [])
    : (termsQuery.data?.rows ?? []);
  const found = filterTerms(terms, keyword);

  function deleteTerm(term: PublicBusinessTerm) {
    removeTerm.mutate(term.id, {
      onSuccess: () =>
        toastWithUndo({
          title: `已删除「${term.canonical_term}」`,
          undo: () => restoreTerm.mutateAsync(term.id),
        }),
    });
  }

  useSetTitlebarActions(
    () =>
      isAdmin ? (
        <HeaderTextAction onClick={() => setEditing("new")}>
          <PlusIcon aria-hidden="true" />
          新建术语
        </HeaderTextAction>
      ) : null,
    [isAdmin],
  );

  return (
    <>
      <ListPageBody>
        <ListControlBar
          right={
            <ListControlSearch
              aria-label="搜索业务术语"
              placeholder="搜索"
              value={keyword}
              onValueChange={setKeyword}
            />
          }
        />
        <ListScrollBody>
          {error && (
            <Alert variant="error">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {loading && <LoadingMark className="py-16" />}
          {!loading && (
            <TermSection
              terms={found}
              filtered={Boolean(keyword.trim())}
              onEdit={isAdmin ? setEditing : undefined}
              onDelete={isAdmin ? deleteTerm : undefined}
            />
          )}
        </ListScrollBody>
      </ListPageBody>
      <BusinessTermEditorDialog
        members={[...(catalogQuery.data?.measures ?? []), ...(catalogQuery.data?.dimensions ?? [])]}
        onClose={() => setEditing(null)}
        target={editing}
      />
    </>
  );
}

function TermSection({
  terms,
  filtered,
  onEdit,
  onDelete,
}: {
  terms: PublicBusinessTerm[];
  filtered: boolean;
  onEdit?: (row: PublicBusinessTerm) => void;
  onDelete?: (row: PublicBusinessTerm) => void;
}) {
  if (terms.length === 0) {
    return filtered ? (
      <EmptyPanel description="清空搜索框可查看全部。" text="没有匹配的业务术语" />
    ) : (
      <EmptyPanel description="可从一句准确、可独立理解的定义开始。" text="暂无业务术语" />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[24%]">规范术语</TableHead>
          <TableHead className="w-[46%]">定义</TableHead>
          <TableHead className="w-[25%]">关联</TableHead>
          {onEdit && <TableHead className="w-[5%]" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {terms.map((term) => (
          <TableRow key={term.id}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{term.canonical_term}</span>
                {term.aliases.length ? (
                  <span className="truncate text-xs text-pa-muted">
                    也叫：{term.aliases.join("、")}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="whitespace-normal text-sm leading-5 text-pa-fg">
              {term.definition}
              {term.context ? (
                <p className="mt-1 text-xs text-pa-muted">语境：{term.context}</p>
              ) : null}
            </TableCell>
            <TableCell className="px-1.5 py-3">
              <div className="flex flex-wrap gap-1">
                {term.related_members.length ? (
                  term.related_members.map((member) =>
                    member.status === "available" ? (
                      <ListCategoryPill key={member.id}>{member.title}</ListCategoryPill>
                    ) : (
                      <Badge key={member.id} variant="warning">
                        绑定已下线
                      </Badge>
                    ),
                  )
                ) : (
                  <span className="text-pa-muted">无需绑定</span>
                )}
              </div>
            </TableCell>
            {onEdit && (
              <TableCell className="px-1.5">
                <RowMenu label={`术语操作：${term.canonical_term}`}>
                  <MenuItem onClick={() => onEdit(term)}>编辑</MenuItem>
                  {onDelete ? (
                    <PopupSection>
                      <MenuItem onClick={() => onDelete(term)}>删除</MenuItem>
                    </PopupSection>
                  ) : null}
                </RowMenu>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
