import type { BusinessTermRegistry } from "../src/application/business_term_registry.js";
import { normalizeBusinessTerm } from "../src/engine/business_term_matcher.js";
import {
  BUSINESS_TERM_CONTENT_INPUT,
  type BusinessTermContentInput,
  type PublicBusinessTerm,
} from "../src/contracts/business_term_contract.js";
import type { PublicCatalogMember } from "../src/contracts/catalog_contract.js";

export const DEMO_BUSINESS_TERMS = [
  {
    canonical_term: "组织",
    definition: "在公开 Demo 中，指示例员工归属的一级组织；部门是组织下的下一层分类。",
    context: "用于按组织统计、筛选或对比人员指标。",
    aliases: ["一级组织"],
    related_member_ids: ["dimension:organization_name"],
  },
  {
    canonical_term: "主动离职",
    definition: "由员工主动提出并在所选期间实际发生的离职事件。",
    context: "用于分析主动离职人数、主动离职率或筛选离职记录。",
    aliases: ["自愿离职"],
    related_member_ids: ["dimension:leave_type", "measure:voluntary_separation_count"],
  },
  {
    canonical_term: "编制达成率",
    definition: "月末在职人数除以同月计划编制；超过100%表示实际人数高于计划。",
    context: "用于按组织或部门比较实际人员规模与计划编制。",
    aliases: ["编制完成率"],
    related_member_ids: ["measure:headcount_plan_attainment_rate"],
  },
  {
    canonical_term: "Q12调研",
    definition: "周期开展的十二项员工敬业度调研；公开 Demo 使用虚构答卷和行业通用短标题。",
    context: "用于分析最近一期的总体得分、四个层级得分、正向作答率与回复率。",
    aliases: ["员工敬业度调研", "敬业度调研"],
    related_member_ids: [
      "measure:q12_average_score",
      "measure:q12_favorable_rate",
      "measure:q12_response_rate",
    ],
  },
] satisfies BusinessTermContentInput[];

type Seed_dependencies = {
  registry: BusinessTermRegistry;
  members: PublicCatalogMember[];
};

const labels_of = (term: Pick<PublicBusinessTerm, "canonical_term" | "aliases">): string[] => [
  term.canonical_term,
  ...term.aliases,
];

/**
 * Demo 术语是全局内容：空库创建，同规范词已有内容时保留管理员版本。
 * 新内容若会占用其他术语的既有标签则拒绝，避免播种把明确叫法变成歧义。
 */
export async function seed_demo_business_terms({ registry, members }: Seed_dependencies) {
  const inputs = DEMO_BUSINESS_TERMS.map((term) => BUSINESS_TERM_CONTENT_INPUT.parse(term));
  const existing = await registry.listAdmin(members);
  const visible_member_ids = new Set(members.map((member) => member.id));
  const existing_by_canonical = new Map<string, PublicBusinessTerm[]>();
  const existing_by_label = new Map<string, PublicBusinessTerm[]>();

  for (const term of existing) {
    const canonical = normalizeBusinessTerm(term.canonical_term);
    existing_by_canonical.set(canonical, [...(existing_by_canonical.get(canonical) ?? []), term]);
    for (const label of labels_of(term)) {
      const normalized = normalizeBusinessTerm(label);
      existing_by_label.set(normalized, [...(existing_by_label.get(normalized) ?? []), term]);
    }
  }

  const seed_label_owner = new Map<string, string>();
  const to_create: BusinessTermContentInput[] = [];
  const preserved: PublicBusinessTerm[] = [];

  for (const input of inputs) {
    const normalized_canonical = normalizeBusinessTerm(input.canonical_term);
    const same_canonical = existing_by_canonical.get(normalized_canonical) ?? [];
    if (same_canonical.length > 1) {
      throw new Error(`业务术语“${input.canonical_term}”存在多个同名条目，无法安全播种`);
    }
    if (same_canonical.length === 1) {
      preserved.push(same_canonical[0]!);
      continue;
    }

    const invalid_members = input.related_member_ids.filter((id) => !visible_member_ids.has(id));
    if (invalid_members.length > 0) {
      throw new Error(
        `Demo 业务术语“${input.canonical_term}”关联了当前目录不存在的成员：${invalid_members.join("、")}`,
      );
    }

    for (const label of [input.canonical_term, ...input.aliases]) {
      const normalized = normalizeBusinessTerm(label);
      const conflicts = existing_by_label.get(normalized) ?? [];
      if (conflicts.length > 0) {
        throw new Error(
          `Demo 业务术语“${input.canonical_term}”的叫法“${label}”已属于“${conflicts[0]!.canonical_term}”`,
        );
      }
      const seed_owner = seed_label_owner.get(normalized);
      if (seed_owner) {
        throw new Error(
          `Demo 业务术语“${input.canonical_term}”的叫法“${label}”与“${seed_owner}”重复`,
        );
      }
      seed_label_owner.set(normalized, input.canonical_term);
    }
    to_create.push(input);
  }

  const created: PublicBusinessTerm[] = [];
  for (const input of to_create) {
    created.push(await registry.create(input, members));
  }
  return { created, preserved };
}
