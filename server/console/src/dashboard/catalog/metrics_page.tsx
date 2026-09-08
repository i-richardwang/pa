/**
 * 指标页：目录里可查询的指标清单。
 * 指标域是指标的归属而不是并列对象——它在这里是筛选器与行上的归属芯片，芯片点开域档案。
 */
import { useMemo, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicCatalogDocument as CatalogPayload,
  PublicMetricDomain as MetricDomainPayload,
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
import { ALL, domainOf, filterMeasures } from "./catalog_filters";
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

export function MetricsPage() {
  const catalogQuery = useCatalogQuery();
  const termsQuery = useBusinessTerms();
  const data = catalogQuery.data ?? null;
  const error = errorText(catalogQuery.error) ?? errorText(termsQuery.error);
  const [keyword, setKeyword] = usePrefilledKeyword();
  const [domainId, setDomainId] = useState(ALL);
  const profile = useCatalogProfile(data, termsQuery.data?.rows ?? []);

  const domainOptions = useMemo(
    () => [
      { value: ALL, label: "全部指标域" },
      ...(data?.metric_domains ?? []).map((domain) => ({ value: domain.id, label: domain.title })),
    ],
    [data],
  );
  const measures = useMemo(
    () => filterMeasures(data, domainId, keyword),
    [data, domainId, keyword],
  );

  return (
    <>
      <ListPageBody>
        <ListControlBar
          left={
            <ListControlCategory
              aria-label="指标域"
              options={domainOptions}
              value={domainId}
              onValueChange={setDomainId}
            />
          }
          right={
            <ListControlSearch
              aria-label="搜索指标"
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
              (measures.length > 0 ? (
                <MeasureTable
                  catalog={data}
                  measures={measures}
                  onOpen={(member) => profile.open({ kind: "member", member })}
                  onOpenDomain={(topic) => profile.open({ kind: "metric_domain", topic })}
                />
              ) : (
                <EmptyPanel
                  description={
                    keyword
                      ? "换一个名称、业务口径或同义词后重试。"
                      : "目录仅显示当前账号获准使用的指标。"
                  }
                  text={keyword ? `没有匹配「${keyword}」的指标` : "当前目录暂无可见指标"}
                />
              ))}
          </div>
        </ListScrollBody>
      </ListPageBody>
      {profile.dialog}
    </>
  );
}

/** 第二列印归属：芯片点开域档案，行的其余部分点开指标档案。 */
function MetricDomainCell({
  domain,
  onOpenDomain,
}: {
  domain: MetricDomainPayload | undefined;
  onOpenDomain: (topic: MetricDomainPayload) => void;
}) {
  return (
    <TableCell className="px-1.5 py-3">
      {domain ? (
        <ListCategoryPill
          onClick={(event) => {
            event.stopPropagation();
            onOpenDomain(domain);
          }}
        >
          {domain.title}
        </ListCategoryPill>
      ) : (
        <span className="text-pa-muted">—</span>
      )}
    </TableCell>
  );
}

function MeasureTable({
  catalog,
  measures,
  onOpen,
  onOpenDomain,
}: {
  catalog: CatalogPayload | null;
  measures: CatalogMemberPayload[];
  onOpen: (member: CatalogMemberPayload) => void;
  onOpenDomain: (topic: MetricDomainPayload) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[70%]">指标名</TableHead>
          <TableHead className="w-[30%]">指标域</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {measures.map((measure) => (
          <TableRow className="cursor-pointer" key={measure.id} onClick={() => onOpen(measure)}>
            <MemberTitleCell description="暂无指标说明" member={measure} />
            <MetricDomainCell domain={domainOf(catalog, measure)} onOpenDomain={onOpenDomain} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
