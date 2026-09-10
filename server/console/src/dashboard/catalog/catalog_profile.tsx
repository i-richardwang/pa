/**
 * 字典三页（指标、维度、业务术语）共用的档案面与目录派生。
 * 档案面是右栏，三页各自只管自己的清单；被点开的成员是谁，由页面传进来。
 */
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

function sensitivityLabel(sensitivity: string): string {
  return sensitivity === "restricted" ? "受限" : sensitivity;
}

function formatLabel(format: string | undefined): string | null {
  if (!format) return null;
  if (format === "percent") return "百分比";
  if (format === "number") return "数值";
  return format;
}

export type DimensionGroupRow = { group: string; titles: string[] };

/**
 * 维度语义 id 清单 → 按业务属性组归拢的业务名。查不到名字的直接丢掉，
 * 宁可少一项也不退回 id 顶替。组序与组内序都随模型给的次序，前端不另排。
 */
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

/** 名字 + 受限锁；指标与维度两张表共用同一枚身份格。 */
export function MemberTitleCell({
  member,
  fallback,
}: {
  member: CatalogMemberPayload;
  /** 成员自己没写说明时印的句子。 */
  fallback: string;
}) {
  return (
    <TableCell className="whitespace-normal">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
          <span className="truncate">{member.title}</span>
          {member.sensitivity === "restricted" && (
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

/**
 * 字典页的档案面接线：右栏开合、成员跳转与取值弹层是同一件事的三个出口。
 * 返回的 `dialog` 必须渲染，取值弹层才有承载。
 */
export function useCatalogProfile(catalog: CatalogPayload | null, terms: PublicBusinessTerm[]) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [valuesTarget, setValuesTarget] = useState<ValuesTarget | null>(null);

  // 先收栏再开弹窗，两者不同时持有焦点。
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
    <ProfileAside closeLabel="关闭档案" label="字典档案" onClose={onClose}>
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

/**
 * 分子分母是本目录成员，做成可点芯片；内部计算件无公开身份，只出静态芯片。
 */
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
  /** 该指标可拆的维度，按业务属性组归拢；维度成员为空。 */
  dimensions: DimensionGroupRow[];
  /** 该指标归属的指标域；维度不属于任何域。 */
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
  // 元信息一张网格，缺项少一行、一行不剩整块不出；「类型」不入网格。
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
            {member.sensitivity ? (
              <InspectorRow label="敏感度">{sensitivityLabel(member.sensitivity)}</InspectorRow>
            ) : null}
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
    <InspectorProfileCard description={topic.query_contract ?? ""} title={topic.title}>
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
