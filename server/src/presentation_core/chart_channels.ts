/**
 * 图表通道容量：每个形态有哪些通道、各吃什么。这是形态可不可表达的唯一结构判据——
 * 图型可选性、点击后的默认绑定、面板可配项都读这一处，不许各自再判一遍。
 * 只管装得下装不下；能不能读（线数、切片数、量纲混合、画布高度）由编译期按数据裁决。
 */
import type { PresentationType } from "../semantic_core/presentation_type.js";

/** 走通道装箱的形态；表格不在其中——它的行列轴是结果余数，归另一份契约。 */
export type ChannelForm = Exclude<PresentationType, "table">;

type ChannelSpec = {
  /** 主轴吃什么：none 与 time 都不占维度，dimension 必须吃掉一个维度。 */
  axis: "none" | "time" | "dimension";
  /** 拆分通道能吃几个维度。 */
  split: 0 | 1;
  /** 值通道是否只容一个度量。 */
  singleValue?: true;
};

const CHART_CHANNELS: Record<ChannelForm, ChannelSpec> = {
  kpi: { axis: "none", split: 0 },
  line: { axis: "time", split: 1 },
  bar: { axis: "dimension", split: 1 },
  pie: { axis: "dimension", split: 0, singleValue: true },
};

/** 形态的通道容量；校验面按它判某个通道该不该出现，不另立一套。 */
export function chartChannels(type: ChannelForm): Readonly<ChannelSpec> {
  return CHART_CHANNELS[type];
}

/** 装箱输入。名字用调用方自己的词表（结果列短名或语义成员 id），分配原样用同一套名字回来。 */
export type ChannelPool = { dimensions: string[]; measures: string[] };

type ChannelAssignment = { x?: string; y: string[]; groupBy?: string };

/** 调用方已有的绑定，装得下就沿用；装不下按容量重排。 */
export type ChannelPreferences = { x?: string; y?: string[]; groupBy?: string };

/**
 * 把维度装进形态的通道：一个都不许剩下——剩下的维度意味着同一坐标对应多行，
 * 只能靠聚合抹平，而呈现层不许改数。度量不受此约束：没上轴的度量只是没画，不产生错数。
 */
export function assignChannels(
  type: ChannelForm,
  pool: ChannelPool,
  preferences: ChannelPreferences = {},
): ChannelAssignment | null {
  const spec = CHART_CHANNELS[type];
  if (!pool.measures.length) return null;

  const free = [...pool.dimensions];
  const take = (name: string | undefined): string | undefined => {
    const index = name === undefined ? -1 : free.indexOf(name);
    return index < 0 ? undefined : free.splice(index, 1)[0];
  };
  const groupBy = spec.split ? take(preferences.groupBy) : undefined;
  const x = spec.axis === "dimension" ? (take(preferences.x) ?? take(free[0])) : undefined;
  if (spec.axis === "dimension" && x === undefined) return null;
  const split = groupBy ?? (spec.split ? take(free[0]) : undefined);
  if (free.length) return null;

  const chosen = preferences.y?.filter((member) => pool.measures.includes(member)) ?? [];
  const series = chosen.length ? chosen : pool.measures;
  const y = split !== undefined || spec.singleValue ? series.slice(0, 1) : series;
  return {
    ...(x !== undefined ? { x } : {}),
    y,
    ...(split !== undefined ? { groupBy: split } : {}),
  };
}

/** 拆分通道的候选维度：装得下才算候选。候选唯一即无可选之事，调用方据此决定出不出选择器。 */
export function splitCandidates(type: ChannelForm, pool: ChannelPool): string[] {
  return pool.dimensions.filter(
    (dimension) => assignChannels(type, pool, { groupBy: dimension })?.groupBy === dimension,
  );
}
