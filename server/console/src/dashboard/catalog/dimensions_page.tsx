import { useMemo, useState } from "react";
import type { PublicCatalogDimension as CatalogDimensionPayload } from "@contracts/catalog_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorText } from "../api";
import { useBusinessTerms, useCatalogQuery } from "../dashboard_queries";
import { MemberTitleCell, useCatalogProfile } from "./catalog_profile";
import { ALL, filterDimensions } from "./catalog_filters";
import {
  ListCategoryPill,
  ListControlBar,
  ListControlCategory,
  ListControlSearch,
  ListPageBody,
  ListScrollBody,
} from "../layout/layout_chrome";
import { EmptyPanel } from "../kit/empty_panel";
import { usePrefilledKeyword } from "./prefill";

export function DimensionsPage() {
  const catalogQuery = useCatalogQuery();
  const termsQuery = useBusinessTerms();
  const data = catalogQuery.data ?? null;
  const error = errorText(catalogQuery.error) ?? errorText(termsQuery.error);
  const [keyword, setKeyword] = usePrefilledKeyword();
  const [groupId, setGroupId] = useState(ALL);
  const profile = useCatalogProfile(data, termsQuery.data?.rows ?? []);

  // 组序随目录给的成员次序，前端不另排。
  const groupOptions = useMemo(() => {
    const groups: { value: string; label: string }[] = [];
    for (const { dimension_group: group } of data?.dimensions ?? []) {
      if (!groups.some((option) => option.value === group.id)) {
        groups.push({ value: group.id, label: group.title });
      }
    }
    return [{ value: ALL, label: "全部属性组" }, ...groups];
  }, [data]);
  const dimensions = useMemo(
    () => filterDimensions(data?.dimensions ?? [], groupId, keyword),
    [data, groupId, keyword],
  );

  return (
    <>
      <ListPageBody>
        <ListControlBar
          left={
            <ListControlCategory
              aria-label="属性组"
              options={groupOptions}
              value={groupId}
              onValueChange={setGroupId}
            />
          }
          right={
            <ListControlSearch
              aria-label="搜索维度"
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
          {catalogQuery.isLoading && <LoadingMark className="py-16" />}
          {data &&
            (dimensions.length > 0 ? (
              <DimensionTable
                dimensions={dimensions}
                onOpen={(member) => profile.open({ kind: "member", member })}
              />
            ) : (
              <EmptyPanel
                description={
                  keyword ? "换一个名称或业务口径后重试。" : "目录仅显示当前账号获准使用的维度。"
                }
                text={keyword ? `没有匹配「${keyword}」的维度` : "当前目录暂无可见维度"}
              />
            ))}
        </ListScrollBody>
      </ListPageBody>
      {profile.dialog}
    </>
  );
}

function DimensionTable({
  dimensions,
  onOpen,
}: {
  dimensions: CatalogDimensionPayload[];
  onOpen: (dimension: CatalogDimensionPayload) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[70%]">维度</TableHead>
          <TableHead className="w-[30%]">属性组</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dimensions.map((dimension) => (
          <TableRow className="cursor-pointer" key={dimension.id} onClick={() => onOpen(dimension)}>
            <MemberTitleCell fallback="暂无维度说明" member={dimension} />
            <TableCell className="px-1.5 py-3">
              <ListCategoryPill>{dimension.dimension_group.title}</ListCategoryPill>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
