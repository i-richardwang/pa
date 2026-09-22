import type { PresentationType } from "../semantic_core/presentation_type.js";

export type ChannelForm = Exclude<PresentationType, "table">;

type ChannelSpec = {
  axis: "none" | "time" | "dimension";
  split: 0 | 1;
  scales: 1 | 2;
  singleValue?: true;
};

const CHART_CHANNELS: Record<ChannelForm, ChannelSpec> = {
  kpi: { axis: "none", split: 0, scales: 1 },
  line: { axis: "time", split: 1, scales: 2 },
  bar: { axis: "dimension", split: 1, scales: 2 },
  pie: { axis: "dimension", split: 0, scales: 1, singleValue: true },
};

export function chartChannels(type: ChannelForm): Readonly<ChannelSpec> {
  return CHART_CHANNELS[type];
}

export type ChannelPool = {
  dimensions: string[];
  measures: string[];
  scales?: Record<string, string>;
};

type ChannelAssignment = { x?: string; y: string[]; y2?: string[]; groupBy?: string };

export type ChannelPreferences = { x?: string; y?: string[]; y2?: string[]; groupBy?: string };

const scalesOf = (series: string[], scaleOf: (measure: string) => string): string[] => [
  ...new Set(series.map(scaleOf)),
];

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

/** 所有维度必须占用通道；遗留维度会让同一坐标对应多行，而呈现层不得聚合。 */
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

export function splitCandidates(type: ChannelForm, pool: ChannelPool): string[] {
  return pool.dimensions.filter(
    (dimension) => assignChannels(type, pool, { groupBy: dimension })?.groupBy === dimension,
  );
}
