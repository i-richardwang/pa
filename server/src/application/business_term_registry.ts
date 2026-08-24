/** 业务术语的持久化集合、目录成员校验与权限后投影。 */
import { matchBusinessTerms, normalizeBusinessTerm } from "../engine/business_term_matcher.js";
import type {
  BusinessTermContentInput,
  BusinessTermRelatedMember,
  BusinessTermResolution,
  PublicBusinessTerm,
} from "../contracts/business_term_contract.js";
import { BUSINESS_TERM_CONTENT_INPUT } from "../contracts/business_term_contract.js";
import type { PublicCatalogMember } from "../contracts/catalog_contract.js";
import type {
  BusinessTermRepository,
  StoredBusinessTerm,
} from "../ports/business_term_repository.js";
import { InvalidRequestError } from "./errors.js";

export type VisibleCatalogMember = Pick<PublicCatalogMember, "id" | "kind" | "title">;

export function createBusinessTermRegistry(deps: { repository: BusinessTermRepository }) {
  const memberMap = (members: VisibleCatalogMember[]) =>
    new Map(members.map((member) => [member.id, member]));

  const validate = (input: BusinessTermContentInput, members: VisibleCatalogMember[]) => {
    const parsed = BUSINESS_TERM_CONTENT_INPUT.safeParse(input);
    if (!parsed.success) {
      throw new InvalidRequestError(parsed.error.issues[0]?.message ?? "业务术语输入无效");
    }
    const normalized = parsed.data;
    const labels = [normalized.canonical_term, ...normalized.aliases].map(normalizeBusinessTerm);
    if (new Set(labels).size !== labels.length) {
      throw new InvalidRequestError("规范术语与其他叫法不能在归一后重复");
    }
    const ids = normalized.related_member_ids;
    if (new Set(ids).size !== ids.length) {
      throw new InvalidRequestError("相关数据成员不能重复");
    }
    const visible = memberMap(members);
    const invalid = ids.filter((id) => !visible.has(id));
    if (invalid.length) {
      throw new InvalidRequestError(`相关数据成员不在当前可见目录：${invalid.join("、")}`);
    }
    return {
      canonical_term: normalized.canonical_term,
      definition: normalized.definition,
      ...(normalized.context ? { context: normalized.context } : {}),
      aliases: normalized.aliases,
      related_member_ids: ids,
    };
  };

  const projector = (members: VisibleCatalogMember[], includeMissing: boolean) => {
    const visible = memberMap(members);
    return (term: StoredBusinessTerm): PublicBusinessTerm => {
      const related_members = term.related_member_ids
        .map((id): BusinessTermRelatedMember | null => {
          const member = visible.get(id);
          if (member) {
            return { id, title: member.title, kind: member.kind, status: "available" };
          }
          return includeMissing ? { id, title: null, kind: null, status: "missing" } : null;
        })
        .filter((member): member is BusinessTermRelatedMember => member !== null);
      return {
        id: term.id,
        canonical_term: term.canonical_term,
        definition: term.definition,
        ...(term.context ? { context: term.context } : {}),
        aliases: term.aliases,
        related_members,
      };
    };
  };

  async function listPublic(members: VisibleCatalogMember[]): Promise<PublicBusinessTerm[]> {
    return (await deps.repository.list()).map(projector(members, false));
  }

  async function listAdmin(members: VisibleCatalogMember[]): Promise<PublicBusinessTerm[]> {
    return (await deps.repository.list()).map(projector(members, true));
  }

  async function resolve(
    inputs: string[],
    members: VisibleCatalogMember[],
  ): Promise<BusinessTermResolution[]> {
    const stored = await deps.repository.list();
    const byId = new Map(stored.map((term) => [term.id, term]));
    const project = projector(members, false);
    return matchBusinessTerms(inputs, stored).map((match) => ({
      input_term: match.input_term,
      status: match.status,
      matches: match.term_ids.map((id) => project(byId.get(id)!)),
    }));
  }

  async function create(input: BusinessTermContentInput, members: VisibleCatalogMember[]) {
    return projector(members, true)(await deps.repository.create(validate(input, members)));
  }

  async function update(
    id: string,
    input: BusinessTermContentInput,
    members: VisibleCatalogMember[],
  ) {
    return projector(members, true)(await deps.repository.replace(id, validate(input, members)));
  }

  async function remove(id: string) {
    return projector([], true)(await deps.repository.remove(id));
  }

  return { listPublic, listAdmin, resolve, create, update, remove };
}

export type BusinessTermRegistry = ReturnType<typeof createBusinessTermRegistry>;
