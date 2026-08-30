/**
 * 图表通道容量：每个形态有哪些通道、各吃什么。这是形态可不可表达的唯一结构判据——
 * 图型可选性、点击后的默认绑定、面板可配项都读这一处，不许各自再判一遍。
 * 只管装得下装不下；能不能读（线数、切片数、并排柱数、画布高度）由编译期按数据裁决。
 */
import type { PresentationType } from "../semantic_core/presentation_type.js";

/** 走通道装箱的形态；表格不在其中——它的行列轴是结果余数，归另一份契约。 */
export type ChannelForm = Exclude<PresentationType, "table">;

type ChannelSpec = {
  /** 主轴吃什么：none 与 time 都不占维度，dimension 必须吃掉一个维度。 */
  axis: "none" | "time" | "dimension";
  /** 拆分通道能吃几个维度。 */
  split: 0 | 1;
  /** 值通道有几把尺子：2 即可开副轴，每侧只容一种量纲。 */
  scales: 1 | 2;
  /** 值通道是否只容一个度量。 */
  singleValue?: true;
};

const CHART_CHANNELS: Record<ChannelForm, ChannelSpec> = {
  kpi: { axis: "none", split: 0, scales: 1 },
  line: { axis: "time", split: 1, scales: 2 },
  bar: { axis: "dimension", split: 1, scales: 2 },
  pie: { axis: "dimension", split: 0, scales: 1, singleValue: true },
};

/** 形态的通道容量；校验面按它判某个通道该不该出现，不另立一套。 */
export function chartChannels(type: ChannelForm): Readonly<ChannelSpec> {
  return CHART_CHANNELS[type];
}

/**
 * 装箱输入。名字用调用方自己的词表（结果列短名或语义成员 id），分配原样用同一套名字回来。
 * `scales` 是各度量的量纲键（显示格式即量纲）；缺席视为同一量纲。
 */
export type ChannelPool = {
  dimensions: string[];
  measures: string[];
  scales?: Record<string, string>;
};

type ChannelAssignment = { x?: string; y: string[]; y2?: string[]; groupBy?: string };

/** 调用方已有的绑定，装得下就沿用；装不下按容量重排。 */
export type ChannelPreferences = { x?: string; y?: string[]; y2?: string[]; groupBy?: string };

/** 把量纲键按首次出现的顺序去重。 */
const scalesOf = (series: string[], scaleOf: (measure: string) => string): string[] => [
  ...new Set(series.map(scaleOf)),
];

/**
 * 把系列分到两把尺子上：每侧只容一种量纲，三种量纲无解。
 * 声明的副轴装得下就沿用；缺席或装不下时按量纲分侧——量在左、率在右，只有一种量纲时全在左。
 */
export function splitScales(
  series: string[],
  scaleOf: (measure: string) => string,
  preferredY2?: string[],
): { y: string[]; y2?: string[] } | null {
  const scales = scalesOf(series, scaleOf);
  if (scales.length > 2) return null;
  if (preferredY2?.length) {
    const y2 = series.filter((measure) => preferredY2.includes(measure));
    const y = series.filter((measure) => !y2.includes(measure));
    if (y.length && scalesOf(y, scaleOf).length <= 1 && scalesOf(y2, scaleOf).length <= 1) {
      return y2.length ? { y, y2 } : { y };
    }
  }
  if (scales.length < 2) return { y: series };
  const left = scales.includes("number") ? "number" : scales[0];
  return {
    y: series.filter((measure) => scaleOf(measure) === left),
    y2: series.filter((measure) => scaleOf(measure) !== left),
  };
}

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

  const chosenY = (preferences.y ?? []).filter((member) => pool.measures.includes(member));
  const chosenY2 = (preferences.y2 ?? []).filter(
    (member) => pool.measures.includes(member) && !chosenY.includes(member),
  );
  const series = chosenY.length ? [...chosenY, ...chosenY2] : pool.measures;
  const sides =
    split !== undefined || spec.singleValue
      ? { y: series.slice(0, 1) }
      : spec.scales === 2
        ? splitScales(series, (measure) => pool.scales?.[measure] ?? "", preferences.y2)
        : { y: series };
  if (!sides) return null;
  return {
    ...(x !== undefined ? { x } : {}),
    ...sides,
    ...(split !== undefined ? { groupBy: split } : {}),
  };
}

/** 拆分通道的候选维度：装得下才算候选。候选唯一即无可选之事，调用方据此决定出不出选择器。 */
export function splitCandidates(type: ChannelForm, pool: ChannelPool): string[] {
  return pool.dimensions.filter(
    (dimension) => assignChannels(type, pool, { groupBy: dimension })?.groupBy === dimension,
  );
}
