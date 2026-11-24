/** 时间源是语义包声明的数据时钟，与业务指标域无关。 */
export type TimeSourceRole = "actual" | "plan";
export type TimeComparisonPolicy = "calendar" | "explicit_only";

export type ObservationSource = {
  id_member: string;
  date_member: string;
  title_member?: string;
};

export type TimeSourceDefinition = {
  id: string;
  title: string;
  role: TimeSourceRole;
  primary: boolean;
  /** 计划时钟指向对应的实际时钟；实际时钟指向自身。 */
  reference_source: string;
  comparison_policy: TimeComparisonPolicy;
  observation?: ObservationSource;
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
    if (
      definition.observation &&
      (definition.role !== "actual" || definition.comparison_policy !== "explicit_only")
    ) {
      throw new Error(`观测时间来源 ${definition.id} 的期次成员或时间合同无效`);
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

/** 返回时间源的业务标题；未知 id 直接报错，不回显内部 id。 */
export function timeSourceLabel(registry: TimeSourceRegistry, id: string): string {
  return timeSourceDefinition(registry, id).title;
}
