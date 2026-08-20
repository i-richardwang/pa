/** 时间源是语义包声明的数据时钟，不携带任何业务域身份。 */
export type TimeSourceRole = "actual" | "plan";
export type TimeComparisonPolicy = "calendar" | "explicit_only";

export type TimeSourceDefinition = {
  id: string;
  title: string;
  role: TimeSourceRole;
  primary: boolean;
  /** 计划时钟引用其实际基准；实际时钟规范化为引用自身。 */
  reference_source: string;
  comparison_policy: TimeComparisonPolicy;
};

export type TimeSourceRegistry = {
  definitions: readonly TimeSourceDefinition[];
  by_id: ReadonlyMap<string, TimeSourceDefinition>;
  primary: TimeSourceDefinition;
};

export type TimeSourceInput = Omit<TimeSourceDefinition, "reference_source"> & {
  reference_source?: string;
};

const TIME_SOURCE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * 把语义包声明装配为 fail-closed 注册表，验证唯一身份、唯一主时钟和计划到实际的基准关系。
 */
export function buildTimeSourceRegistry(inputs: readonly TimeSourceInput[]): TimeSourceRegistry {
  if (!inputs.length) throw new Error("语义包至少需要一个时间来源");
  const definitions = inputs.map((input) => {
    if (!TIME_SOURCE_ID_PATTERN.test(input.id)) {
      throw new Error(`时间来源 ${input.id} 的 id 无效`);
    }
    return {
      ...input,
      reference_source: input.reference_source ?? input.id,
    } satisfies TimeSourceDefinition;
  });
  const byId = new Map<string, TimeSourceDefinition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) throw new Error(`时间来源 ${definition.id} 重复登记`);
    byId.set(definition.id, definition);
  }
  const primaries = definitions.filter((definition) => definition.primary);
  if (primaries.length !== 1) throw new Error("语义包必须且只能声明一个主时间来源");
  if (primaries[0].role !== "actual") throw new Error("主时间来源必须是 actual");

  for (const definition of definitions) {
    const reference = byId.get(definition.reference_source);
    if (!reference) {
      throw new Error(
        `时间来源 ${definition.id} 引用了未登记的基准 ${definition.reference_source}`,
      );
    }
    if (definition.role === "actual" && definition.reference_source !== definition.id) {
      throw new Error(`实际时间来源 ${definition.id} 必须引用自身`);
    }
    if (definition.role === "plan" && reference.role !== "actual") {
      throw new Error(`计划时间来源 ${definition.id} 必须引用 actual 基准`);
    }
  }
  return { definitions, by_id: byId, primary: primaries[0] };
}

export function parseKnownTimeSourceId(
  value: unknown,
  owner: string,
  registry: TimeSourceRegistry,
): string {
  if (typeof value !== "string" || !registry.by_id.has(value)) {
    throw new Error(`${owner} 声明了未登记的时间来源`);
  }
  return value;
}

export function timeSourceDefinition(
  registry: TimeSourceRegistry,
  id: string,
): TimeSourceDefinition {
  const definition = registry.by_id.get(id);
  if (!definition) throw new Error("模型声明了未登记的时间来源；请联系服务维护者");
  return definition;
}

/** 内部时间源 id → 语义包业务标题；未知 id fail-closed，绝不回显执行标识。 */
export function timeSourceLabel(registry: TimeSourceRegistry, id: string): string {
  return timeSourceDefinition(registry, id).title;
}
