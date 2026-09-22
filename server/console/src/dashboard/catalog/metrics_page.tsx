import { useMemo, useState } from "react";
import type {
  PublicCatalogMeasure as CatalogMeasurePayload,
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
  const rows = useMemo(
    () =>
      filterMeasures(data, domainId, keyword).map((measure) => ({
        measure,
        domain: domainOf(data, measure),
      })),
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
          {error && (
            <Alert variant="error">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {catalogQuery.isLoading && <LoadingMark className="py-16" />}
          {data &&
            (rows.length > 0 ? (
              <MeasureTable
                rows={rows}
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
        </ListScrollBody>
      </ListPageBody>
      {profile.dialog}
    </>
  );
}

type MeasureRow = { measure: CatalogMeasurePayload; domain: MetricDomainPayload | undefined };

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
  rows,
  onOpen,
  onOpenDomain,
}: {
  rows: MeasureRow[];
  onOpen: (measure: CatalogMeasurePayload) => void;
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
        {rows.map(({ measure, domain }) => (
          <TableRow className="cursor-pointer" key={measure.id} onClick={() => onOpen(measure)}>
            <MemberTitleCell fallback="暂无指标说明" member={measure} />
            <MetricDomainCell domain={domain} onOpenDomain={onOpenDomain} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
