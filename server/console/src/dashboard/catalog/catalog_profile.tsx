import { useCallback, useState } from "react";
import type {
  PublicCatalogMeasure as CatalogMeasurePayload,
  PublicCatalogMember as CatalogMemberPayload,
  PublicCatalogDocument as CatalogPayload,
  PublicMetricDomain as MetricDomainPayload,
} from "@contracts/catalog_contract";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";
import { isSearchableCatalogDimension } from "@contracts/catalog_contract";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InspectorRow, InspectorProfileCard, InspectorSection } from "@/components/ui/inspector";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { PopoverListPanel } from "@/components/ui/popover-list";
import { TableCell } from "@/components/ui/table";
import { CatalogValuesDialog, type ValuesTarget } from "./catalog_values_dialog";
import { domainOf } from "./catalog_filters";
import { ListCategoryPill, useSetStageAside } from "../layout/layout_chrome";
import { ProfileAside } from "../layout/view_chrome";

export type Detail =
  | { kind: "member"; member: CatalogMemberPayload }
  | { kind: "metric_domain"; topic: MetricDomainPayload };

function formatLabel(format: string | undefined): string | null {
  if (!format) return null;
  if (format === "percent") return "百分比";
  if (format === "number") return "数值";
  return format;
}

export type DimensionGroupRow = { group: string; titles: string[] };

// 目录里找不到的维度 id 直接跳过，不显示 id；组序和组内顺序沿用目录顺序。
function dimensionGroups(catalog: CatalogPayload | null, ids: string[]): DimensionGroupRow[] {
  const wanted = new Set(ids);
  const rows: DimensionGroupRow[] = [];
  const byGroup = new Map<string, DimensionGroupRow>();
  for (const member of catalog?.dimensions ?? []) {
    if (!wanted.has(member.id)) continue;
    const group = member.dimension_group.title;
    let row = byGroup.get(group);
    if (!row) {
      row = { group, titles: [] };
      byGroup.set(group, row);
      rows.push(row);
    }
    row.titles.push(member.title);
  }
  return rows;
}

export function MemberTitleCell({
  member,
  fallback,
}: {
  member: CatalogMemberPayload;
  fallback: string;
}) {
  return (
    <TableCell className="whitespace-normal">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
          <span className="truncate">{member.title}</span>
          {member.sensitivity && (
            <LockIcon aria-label="受限" className="size-3.5 shrink-0 text-pa-muted" role="img">
              <title>受限：按数据权限可见</title>
            </LockIcon>
          )}
        </div>
        <p className="line-clamp-2 text-sm text-pa-muted">{member.description || fallback}</p>
      </div>
    </TableCell>
  );
}

export function useCatalogProfile(catalog: CatalogPayload | null, terms: PublicBusinessTerm[]) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [valuesTarget, setValuesTarget] = useState<ValuesTarget | null>(null);

  // 先关闭右栏再打开弹窗，避免两者同时持有焦点。
  const openValues = useCallback((target: ValuesTarget) => {
    setDetail(null);
    setValuesTarget(target);
  }, []);

  const openMember = useCallback(
    (id: string) => {
      const member = [...(catalog?.measures ?? []), ...(catalog?.dimensions ?? [])].find(
        (candidate) => candidate.id === id,
      );
      if (member) setDetail({ kind: "member", member });
    },
    [catalog],
  );

  useSetStageAside(
    () =>
      detail ? (
        <CatalogProfileAside
          catalog={catalog}
          terms={terms}
          detail={detail}
          onClose={() => setDetail(null)}
          onOpenMember={openMember}
          onValues={openValues}
        />
      ) : null,
    [detail, terms, catalog, openMember, openValues],
    () => setDetail(null),
    "profile",
  );

  return {
    open: (next: Detail) => setDetail(next),
    dialog: <CatalogValuesDialog target={valuesTarget} onClose={() => setValuesTarget(null)} />,
  };
}

function CatalogProfileAside({
  catalog,
  detail,
  terms,
  onClose,
  onOpenMember,
  onValues,
}: {
  catalog: CatalogPayload | null;
  detail: Detail;
  terms: PublicBusinessTerm[];
  onClose: () => void;
  onOpenMember: (id: string) => void;
  onValues: (target: ValuesTarget) => void;
}) {
  const domain = detail.kind === "member" ? domainOf(catalog, detail.member) : detail.topic;
  const dimensions = dimensionGroups(catalog, domain?.dimension_ids ?? []);

  return (
    <ProfileAside closeLabel="关闭详情" label="字典详情" onClose={onClose}>
      {detail.kind === "member" ? (
        <MemberProfileBody
          dimensions={dimensions}
          domain={domain}
          member={detail.member}
          onOpenMember={onOpenMember}
          onValues={onValues}
          terms={terms}
        />
      ) : (
        <MetricDomainProfileBody dimensions={dimensions} topic={detail.topic} />
      )}
    </ProfileAside>
  );
}

function DimensionsRow({ groups }: { groups: DimensionGroupRow[] }) {
  const count = groups.reduce((total, row) => total + row.titles.length, 0);
  if (count === 0) return null;
  return (
    <InspectorRow label="可用维度">
      <Popover>
        <PopoverTrigger render={<ListCategoryPill />}>{count} 个</PopoverTrigger>
        <PopoverPopup align="end" width="list">
          <PopoverListPanel>
            <ul className="flex flex-col gap-1.5 px-1 py-0.5 text-sm leading-5">
              {groups.map((row) => (
                <li key={row.group}>
                  <span className="font-medium">{row.group}</span>：{row.titles.join("、")}
                </li>
              ))}
            </ul>
          </PopoverListPanel>
        </PopoverPopup>
      </Popover>
    </InspectorRow>
  );
}

function FormulaRow({
  formula,
  onOpenMember,
}: {
  formula: NonNullable<CatalogMeasurePayload["formula"]>;
  onOpenMember: (id: string) => void;
}) {
  const end = (title: string, id: string | undefined) =>
    id ? (
      <ListCategoryPill onClick={() => onOpenMember(id)}>{title}</ListCategoryPill>
    ) : (
      <ListCategoryPill absent>{title}</ListCategoryPill>
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {end(formula.numerator, formula.numerator_id)}
      <span className="text-sm text-pa-muted">÷</span>
      {end(formula.denominator, formula.denominator_id)}
    </div>
  );
}

function MemberProfileBody({
  member,
  dimensions,
  domain,
  terms,
  onOpenMember,
  onValues,
}: {
  member: CatalogMemberPayload;
  dimensions: DimensionGroupRow[];
  domain?: MetricDomainPayload;
  terms: PublicBusinessTerm[];
  onOpenMember: (id: string) => void;
  onValues: (target: ValuesTarget) => void;
}) {
  const related = terms.filter((term) =>
    term.related_members.some((relatedMember) => relatedMember.id === member.id),
  );
  const format = formatLabel(member.format);
  const dimensionKind =
    member.kind === "dimension" && member.dimension_kind === "overlapping" ? "可重叠" : null;
  const formula = member.kind === "measure" ? member.formula : undefined;
  const action = isSearchableCatalogDimension(member) ? (
    <Button
      onClick={() => onValues({ member: member.id, title: member.title })}
      size="compact"
      variant="default"
    >
      查看取值
    </Button>
  ) : undefined;
  const facts =
    (domain ? 1 : 0) +
    (dimensions.length ? 1 : 0) +
    [format, member.sensitivity, dimensionKind].filter(Boolean).length;
  return (
    <>
      <InspectorProfileCard action={action} description={member.description} title={member.title}>
        {formula ? <FormulaRow formula={formula} onOpenMember={onOpenMember} /> : null}
        {facts > 0 ? (
          <>
            {domain ? <InspectorRow label="指标域">{domain.title}</InspectorRow> : null}
            <DimensionsRow groups={dimensions} />
            {domain?.time_context_title ? (
              <InspectorRow label="数据时间">{domain.time_context_title}</InspectorRow>
            ) : null}
            {format ? <InspectorRow label="格式">{format}</InspectorRow> : null}
            {member.sensitivity ? <InspectorRow label="敏感度">受限</InspectorRow> : null}
            {dimensionKind ? <InspectorRow label="维度种类">{dimensionKind}</InspectorRow> : null}
          </>
        ) : null}
      </InspectorProfileCard>
      {related.length > 0 ? (
        <InspectorSection title="相关业务术语">
          <ul className="flex flex-col gap-1 text-sm leading-5">
            {related.map((term) => (
              <li key={term.id}>
                <span className="font-medium">{term.canonical_term}</span>：{term.definition}
              </li>
            ))}
          </ul>
        </InspectorSection>
      ) : null}
    </>
  );
}

function MetricDomainProfileBody({
  topic,
  dimensions,
}: {
  topic: MetricDomainPayload;
  dimensions: DimensionGroupRow[];
}) {
  return (
    <InspectorProfileCard description={topic.query_contract} title={topic.title}>
      <DimensionsRow groups={dimensions} />
      {topic.time_context_title ? (
        <InspectorRow label="数据时间">{topic.time_context_title}</InspectorRow>
      ) : null}
      {topic.synonyms.length > 0 ? (
        <InspectorRow label="也叫">{topic.synonyms.join("、")}</InspectorRow>
      ) : null}
    </InspectorProfileCard>
  );
}
