import { z } from "zod";
import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import { resolveMetricTime, type MetricTimeEvaluation } from "./metric_time.js";

const RECORD_FIELD_META = z
  .object({
    member: z.string().min(1),
    title: z.string().min(1).optional(),
  })
  .strict();

const RECORD_SET_META = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    record_key: z.string().min(1),
    entity_key: z.string().min(1),
    fields: z.array(RECORD_FIELD_META).min(1),
    entity_order: z
      .array(
        z
          .object({
            member: z.string().min(1),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const RECORD_SETS_META = z
  .record(z.string().min(1), RECORD_SET_META)
  .refine((sets) => Object.keys(sets).length > 0, { message: "至少声明一个记录集" });

const RECORD_SELECTION = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("numerator") }).strict(),
  z.object({ kind: z.literal("measure"), member: z.string().min(1) }).strict(),
]);

const MEMBER_UNDERLYING_RECORDS_META = z
  .object({
    record_set: z.string().min(1),
    selection: RECORD_SELECTION,
  })
  .strict();

export type RecordField = { member: string; title?: string };

export type RecordSetDefinition = {
  title: string;
  description: string;
  rowKey: string;
  entityKey: string;
  fields: RecordField[];
  entityOrder: { member: string; direction: "asc" | "desc" }[];
};

export type RecordProjectionTarget = {
  member: string;
  mode: "rows" | "entities";
  evaluation: MetricTimeEvaluation;
  title: string;
  recordSet: string;
  records: RecordSetDefinition;
};

const qualify = (view: string, member: string) =>
  member.includes(".") ? member : `${view}.${member}`;

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function allMembers(view: CubeView): CubeMember[] {
  return [
    ...view.measures,
    ...(view.internalMeasures ?? []),
    ...view.dimensions,
    ...(view.internalDimensions ?? []),
  ];
}

/** 技术明细面可投影的记录集；模型错误在目录装配时即失败，不延迟到用户点击。 */
export function recordSetsOf(view: CubeView): ReadonlyMap<string, RecordSetDefinition> {
  const raw = view.meta?.record_sets;
  if (raw === undefined) return new Map();
  const parsed = RECORD_SETS_META.safeParse(raw);
  if (!parsed.success) throw new Error(`数据域「${view.title}」的底层记录集配置无效`);

  const declared = new Set(allMembers(view).map((member) => member.name));
  const result = new Map<string, RecordSetDefinition>();
  for (const [name, recordSet] of Object.entries(parsed.data)) {
    const { title, description, record_key, entity_key, fields, entity_order } = recordSet;
    const fieldMembers = fields.map((field) => field.member);
    const referenced = [
      record_key,
      entity_key,
      ...fieldMembers,
      ...entity_order.map((order) => order.member),
    ].map((member) => qualify(view.name, member));
    const orderMembers = entity_order.map((order) => order.member);
    if (
      !unique(fieldMembers) ||
      !unique(orderMembers) ||
      !fieldMembers.includes(entity_key) ||
      entity_order.some(
        (order) => order.member !== record_key && !fieldMembers.includes(order.member),
      ) ||
      entity_order.at(-1)?.member !== record_key ||
      referenced.some((member) => !declared.has(member))
    ) {
      throw new Error(`数据域「${view.title}」的底层记录集配置无效`);
    }
    result.set(name, {
      title,
      description,
      rowKey: record_key,
      entityKey: entity_key,
      fields: fields.map((field) => ({ ...field })),
      entityOrder: entity_order.map((order) => ({ ...order })),
    });
  }
  return result;
}

function memberContract(member: CubeMember, title: string) {
  const raw = member.meta?.underlying_records;
  if (raw === undefined) return null;
  const parsed = MEMBER_UNDERLYING_RECORDS_META.safeParse(raw);
  if (!parsed.success) throw new Error(`指标「${title}」的底层记录契约无效`);
  return parsed.data;
}

function referencedRecordMembers(view: CubeView, records: RecordSetDefinition): string[] {
  return [
    records.rowKey,
    records.entityKey,
    ...records.fields.map((field) => field.member),
    ...records.entityOrder.map((order) => order.member),
  ].map((member) => qualify(view.name, member));
}

/** 按成员权限保留字段完整的记录集，并移除指向不可用记录集的指标契约。 */
export function projectRecordMetadata(
  view: CubeView,
  visibleMembers: ReadonlySet<string>,
): CubeView {
  const definitions = recordSetsOf(view);
  if (!definitions.size) return view;
  const targets = recordProjectionTargetsOf(view);

  const available = new Set(
    [...definitions].flatMap(([name, records]) =>
      referencedRecordMembers(view, records).every((member) => visibleMembers.has(member))
        ? [name]
        : [],
    ),
  );
  const rawSets = view.meta?.record_sets as Record<string, unknown>;
  const meta = { ...view.meta };
  if (available.size) {
    meta.record_sets = Object.fromEntries(
      Object.entries(rawSets).filter(([name]) => available.has(name)),
    );
  } else {
    delete meta.record_sets;
  }

  const projectMember = (member: CubeMember): CubeMember => {
    const contract = memberContract(member, member.title);
    const target = targets.get(member.name);
    if (
      !contract ||
      (available.has(contract.record_set) && (!target || visibleMembers.has(target.member)))
    ) {
      return member;
    }
    const memberMeta = { ...member.meta };
    delete memberMeta.underlying_records;
    return { ...member, meta: memberMeta };
  };

  return {
    ...view,
    meta,
    measures: view.measures.map(projectMember),
    internalMeasures: view.internalMeasures?.map(projectMember),
  };
}

/**
 * 指标能否投影构成记录只认模型成员自己的 underlying_records 契约；聚合类型、率组件和技术
 * View 的成员存在性均不隐式授予能力。记录选择最终必须落到同时间口径的计数度量。
 */
export function recordProjectionTargetsOf(
  view: CubeView,
): ReadonlyMap<string, RecordProjectionTarget> {
  const recordSets = recordSetsOf(view);
  if (!recordSets.size) return new Map();
  const measures = [...view.measures, ...(view.internalMeasures ?? [])];
  const byName = new Map(measures.map((member) => [member.name, member]));

  const resolve = (
    name: string,
    rootTitle: string,
    rootEvaluation: RecordProjectionTarget["evaluation"],
    recordSet: string,
    resolving: Set<string>,
  ): Omit<RecordProjectionTarget, "title" | "recordSet" | "records"> => {
    const member = byName.get(name);
    if (!member) throw new Error(`指标「${rootTitle}」的底层记录目标不存在`);
    if (resolving.has(name)) throw new Error(`指标「${rootTitle}」的底层记录关系存在循环`);
    const evaluation = resolveMetricTime(member, byName).evaluation;
    if (evaluation !== rootEvaluation) {
      throw new Error(`指标「${rootTitle}」与其底层记录目标的时间口径不一致`);
    }

    const contract = memberContract(member, rootTitle);
    if (!contract) {
      if (member.aggType !== "count" && member.aggType !== "countDistinct") {
        throw new Error(`指标「${rootTitle}」的底层记录目标不是可枚举计数`);
      }
      return {
        member: name,
        mode: member.aggType === "count" ? "rows" : "entities",
        evaluation: rootEvaluation,
      };
    }
    if (contract.record_set !== recordSet) {
      throw new Error(`指标「${rootTitle}」的底层记录关系跨越了不同记录集`);
    }

    const selection = contract.selection;
    if (selection.kind === "self") {
      if (member.aggType !== "count" && member.aggType !== "countDistinct") {
        throw new Error(`指标「${rootTitle}」的底层记录目标不是可枚举计数`);
      }
      return {
        member: name,
        mode: member.aggType === "count" ? "rows" : "entities",
        evaluation: rootEvaluation,
      };
    }

    const components = member.meta?.components as { numerator?: unknown } | undefined;
    const next =
      selection.kind === "measure"
        ? selection.member
        : typeof components?.numerator === "string"
          ? components.numerator
          : null;
    if (!next) throw new Error(`指标「${rootTitle}」的底层记录分子不存在`);

    resolving.add(name);
    try {
      return resolve(qualify(view.name, next), rootTitle, rootEvaluation, recordSet, resolving);
    } finally {
      resolving.delete(name);
    }
  };

  const targets = new Map<string, RecordProjectionTarget>();
  for (const root of view.measures) {
    const contract = memberContract(root, root.title);
    if (!contract) continue;
    const evaluation = resolveMetricTime(root, byName).evaluation;
    const records = recordSets.get(contract.record_set);
    if (!records) throw new Error(`指标「${root.title}」引用了不存在的底层记录集`);
    const target = resolve(root.name, root.title, evaluation, contract.record_set, new Set());
    targets.set(root.name, {
      ...target,
      title: root.title,
      recordSet: contract.record_set,
      records,
    });
  }
  return targets;
}

export function resolveRecordProjectionTarget(
  view: CubeView,
  memberName: string,
): RecordProjectionTarget | null {
  return recordProjectionTargetsOf(view).get(memberName) ?? null;
}
