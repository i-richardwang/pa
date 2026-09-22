import type {
  PublicCatalogDimension,
  PublicCatalogDocument,
  PublicCatalogMeasure,
  PublicCatalogMember,
} from "@contracts/catalog_contract";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";

export const ALL = "";

function contains(term: string, fields: Array<string | null | undefined>): boolean {
  return fields.some((field) => (field ?? "").toLowerCase().includes(term));
}

export function domainOf(catalog: PublicCatalogDocument | null, member: PublicCatalogMember) {
  if (member.kind !== "measure") return undefined;
  return catalog?.metric_domains.find((domain) => domain.measure_ids.includes(member.id));
}

export function filterMeasures(
  catalog: PublicCatalogDocument | null,
  domainId: string,
  keyword: string,
): PublicCatalogMeasure[] {
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
  groupId: string,
  keyword: string,
): PublicCatalogDimension[] {
  const term = keyword.trim().toLowerCase();
  return dimensions.filter((dimension) => {
    if (groupId !== ALL && dimension.dimension_group.id !== groupId) return false;
    if (!term) return true;
    return contains(term, [
      dimension.title,
      dimension.description,
      dimension.ai_context,
      dimension.dimension_group.title,
    ]);
  });
}

export function filterTerms(
  terms: readonly PublicBusinessTerm[],
  keyword: string,
): PublicBusinessTerm[] {
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
