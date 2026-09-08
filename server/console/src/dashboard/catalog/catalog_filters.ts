/**
 * 字典三页的检索谓词。
 * 每页只搜自己那类对象；跨类查找归全局搜索，不靠这里兼职。
 */
import type {
  PublicCatalogDimension,
  PublicCatalogMember,
  PublicCatalogDocument,
} from "@contracts/catalog_contract";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";

/** 筛选器的「全部」档；空串不与任何指标域 id 或属性组标题冲突。 */
export const ALL = "";

function contains(term: string, fields: Array<string | null | undefined>): boolean {
  return fields.some((field) => (field ?? "").toLowerCase().includes(term));
}

/** 指标 → 归属指标域。从属只由域这一头声明一次，成员不反向携带域 id。 */
export function domainOf(catalog: PublicCatalogDocument | null, member: PublicCatalogMember) {
  if (member.kind !== "measure") return undefined;
  return catalog?.metric_domains.find((domain) => domain.measure_ids.includes(member.id));
}

export function dimensionGroupTitle(member: PublicCatalogDimension): string | undefined {
  return member.dimension_group?.title;
}

/**
 * 指标命中它自己的文本，也命中所属域的名字与别名——问「Turnover」的人要的是离职域下的指标。
 * 这条路径原先由指标域分面承担，分面撤掉后并进这里。
 */
export function filterMeasures(
  catalog: PublicCatalogDocument | null,
  domainId: string,
  keyword: string,
): PublicCatalogMember[] {
  const term = keyword.trim().toLowerCase();
  return (catalog?.measures ?? []).filter((measure) => {
    const domain = domainOf(catalog, measure);
    if (domainId !== ALL && domain?.id !== domainId) return false;
    if (!term) return true;
    return (
      contains(term, [measure.title, measure.description, measure.ai_context]) ||
      contains(term, [domain?.title, ...(domain?.synonyms ?? [])])
    );
  });
}

export function filterDimensions(
  dimensions: readonly PublicCatalogDimension[],
  group: string,
  keyword: string,
): PublicCatalogDimension[] {
  const term = keyword.trim().toLowerCase();
  return dimensions.filter((dimension) => {
    if (group !== ALL && dimensionGroupTitle(dimension) !== group) return false;
    if (!term) return true;
    return contains(term, [
      dimension.title,
      dimension.description,
      dimension.ai_context,
      dimensionGroupTitle(dimension),
    ]);
  });
}

/** 术语按规范叫法、定义、语境、别名和关联成员命中：黑话是这页存在的理由。 */
export function filterTerms(terms: readonly PublicBusinessTerm[], keyword: string) {
  const term = keyword.trim().toLowerCase();
  if (!term) return [...terms];
  return terms.filter((row) =>
    contains(term, [
      row.canonical_term,
      row.definition,
      row.context,
      ...row.aliases,
      ...row.related_members.flatMap((member) => [member.title ?? undefined, member.id]),
    ]),
  );
}
