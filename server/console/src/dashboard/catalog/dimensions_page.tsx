/**
 * 维度页：目录里可用来切分的业务属性清单。
 * 属性组是维度的归属，与指标页的指标域同一形态：筛选器 + 行上的归属芯片。
 */
import { useMemo, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import type {
  PublicCatalogDimension as CatalogDimensionPayload,
  PublicCatalogMember as CatalogMemberPayload,
} from "@contracts/catalog_contract";
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
import { ALL, dimensionGroupTitle as groupTitle, filterDimensions } from "./catalog_filters";
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
  const [group, setGroup] = useState(ALL);
  const profile = useCatalogProfile(data, termsQuery.data?.rows ?? []);

  // 组序随目录给的成员次序，前端不另排；说不出业务名的组不进筛选器。
  const groupOptions = useMemo(() => {
    const titles: string[] = [];
    for (const dimension of data?.dimensions ?? []) {
      const title = groupTitle(dimension);
      if (title && !titles.includes(title)) titles.push(title);
    }
    return [
      { value: ALL, label: "全部属性组" },
      ...titles.map((title) => ({ value: title, label: title })),
    ];
  }, [data]);
  const dimensions = useMemo(
    () => filterDimensions(data?.dimensions ?? [], group, keyword),
    [data, group, keyword],
  );

  return (
    <>
      <ListPageBody>
        <ListControlBar
          left={
            <ListControlCategory
              aria-label="属性组"
              options={groupOptions}
              value={group}
              onValueChange={setGroup}
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
          <div className="mt-5">
            {error && (
              <Alert variant="error">
                <CircleAlertIcon />
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
          </div>
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
  onOpen: (member: CatalogMemberPayload) => void;
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
            <MemberTitleCell description="暂无维度说明" member={dimension} />
            <TableCell className="px-1.5 py-3">
              {groupTitle(dimension) ? (
                <ListCategoryPill>{groupTitle(dimension)}</ListCategoryPill>
              ) : (
                <span className="text-pa-muted">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
