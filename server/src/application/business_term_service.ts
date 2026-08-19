/** 业务术语的维护、公共投影与查前解析；定义是事实源，成员关联只帮助目录导航。 */
import { matchBusinessTerms, normalizeBusinessTerm } from "../engine/business_term_matcher.js";
import type {
  BusinessTermContentInput,
  BusinessTermRelatedMember,
  BusinessTermResolution,
  PublicBusinessTerm,
} from "../contracts/business_term_contract.js";
import type { PublicCatalogMember } from "../contracts/catalog_contract.js";
import type {
  BusinessTermRepository,
  StoredBusinessTerm,
} from "../ports/business_term_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import { InvalidRequestError } from "./errors.js";

export class BusinessTermInputError extends InvalidRequestError {}

type VisibleMember = Pick<PublicCatalogMember, "id" | "kind" | "title">;

export type BusinessTermService = ReturnType<typeof createBusinessTermService>;

export function createBusinessTermService(deps: {
  repository: BusinessTermRepository;
  usage: Pick<UsageLog, "log">;
}) {
  const memberMap = (members: VisibleMember[]) =>
    new Map(members.map((member) => [member.id, member]));

  const validate = (input: BusinessTermContentInput, members: VisibleMember[]) => {
    const labels = [input.canonical_term, ...input.aliases].map(normalizeBusinessTerm);
    if (new Set(labels).size !== labels.length) {
      throw new BusinessTermInputError("规范术语与其他叫法不能在归一后重复");
    }
    const ids = input.related_member_ids.map((id) => id.trim());
    if (new Set(ids).size !== ids.length) {
      throw new BusinessTermInputError("相关数据成员不能重复");
    }
    const visible = memberMap(members);
    const invalid = ids.filter((id) => !visible.has(id));
    if (invalid.length) {
      throw new BusinessTermInputError(`相关数据成员不在当前可见目录：${invalid.join("、")}`);
    }
    return {
      canonical_term: input.canonical_term,
      definition: input.definition,
      ...(input.context ? { context: input.context } : {}),
      aliases: input.aliases,
      related_member_ids: ids,
    };
  };

  const projector = (members: VisibleMember[], includeMissing: boolean) => {
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

  async function listPublic(members: VisibleMember[]): Promise<PublicBusinessTerm[]> {
    return (await deps.repository.list()).map(projector(members, false));
  }

  async function listAdmin(members: VisibleMember[]): Promise<PublicBusinessTerm[]> {
    return (await deps.repository.list()).map(projector(members, true));
  }

  async function resolve(
    inputs: string[],
    members: VisibleMember[],
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

  async function create(
    input: BusinessTermContentInput,
    members: VisibleMember[],
    actor: string,
  ): Promise<PublicBusinessTerm> {
    const row = projector(members, true)(await deps.repository.create(validate(input, members)));
    await deps.usage.log({
      caller: actor,
      tool: "business_term_admin",
      title: `新建业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  async function update(
    id: string,
    input: BusinessTermContentInput,
    members: VisibleMember[],
    actor: string,
  ): Promise<PublicBusinessTerm> {
    const row = projector(
      members,
      true,
    )(await deps.repository.replace(id, validate(input, members)));
    await deps.usage.log({
      caller: actor,
      tool: "business_term_admin",
      title: `更新业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  async function remove(id: string, actor: string): Promise<PublicBusinessTerm> {
    const row = projector([], true)(await deps.repository.remove(id));
    await deps.usage.log({
      caller: actor,
      tool: "business_term_admin",
      title: `删除业务术语：「${row.canonical_term}」`,
      outcome: "ok",
      duration_ms: 0,
    });
    return row;
  }

  return {
    listPublic,
    listAdmin,
    resolve,
    create,
    update,
    remove,
  };
}
