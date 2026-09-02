/**
 * 整窗合计的唯一供给点：值恒由 grain=total 的无分组腿独立求得，不对已返回序列加总或取末；
 * 不能整窗合并的指标按 totalPeriodOf 退到期间终点。
 */
import type {
  CubeGateway,
  CubeMember,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import { executeMetricQuery } from "../engine/metric_executor.js";
import { planMetricQuery } from "../engine/metric_planner.js";
import { resolveMetricTime } from "../engine/metric_time.js";
import type { BusinessTimeResolution } from "../engine/time_plan.js";
import type { TotalPeriodValue } from "../semantic_core/query_payload.js";
import {
  metricTimeCapabilities,
  totalPeriodOf,
  type TimeInput,
  type TotalCoverage,
} from "../semantic_core/time_contract.js";

/** 一个指标在全部时间坐标上的合计；periods 与 businessTime.coordinates 等长同序。 */
export type MetricTotals = { member: string; periods: TotalPeriodValue[] };

const COVERAGES = ["window", "endpoint"] as const satisfies readonly TotalCoverage[];

function measureIndex(views: CubeView[]): ReadonlyMap<string, CubeMember> {
  return new Map(
    views
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .map((member) => [member.name, member] as const),
  );
}

function totalValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function computeMetricTotals(input: {
  cube: Pick<CubeGateway, "load" | "loadMulti">;
  /** 已完成层级补全的查询；合计只取其筛选条件与指标，分组与排序一律不带。 */
  query: CubeQuery;
  context: TimeContext;
  views: CubeView[];
  securityContext: CubeSecurityContext;
  timeView?: string;
  businessTime: BusinessTimeResolution;
}): Promise<MetricTotals[]> {
  const { cube, query, context, views, securityContext, timeView, businessTime } = input;
  const measures = query.measures ?? [];
  if (!measures.length) return [];
  const members = measureIndex(views);
  const capabilitiesOf = (name: string) => {
    const member = members.get(name);
    if (!member) throw new Error(`合计求值缺少指标 ${name} 的时间合同`);
    return metricTimeCapabilities(resolveMetricTime(member, members).contract);
  };
  const periods = businessTime.coordinates.map((coordinate) =>
    measures.map((name) =>
      totalPeriodOf(capabilitiesOf(name), { from: coordinate.from, to: coordinate.to }),
    ),
  );

  const legs = businessTime.coordinates.flatMap((coordinate, coordinateIndex) =>
    COVERAGES.flatMap((coverage) => {
      const legMeasures = measures.filter(
        (_, index) => periods[coordinateIndex][index].coverage === coverage,
      );
      if (!legMeasures.length) return [];
      const time: TimeInput =
        coverage === "window"
          ? { range: { from: coordinate.from, to: coordinate.to }, grain: "total" }
          : { cutoff: coordinate.to, grain: "total" };
      return [{ coordinateIndex, measures: legMeasures, time }];
    }),
  );
  const loaded = await Promise.all(
    legs.map(async (leg) => {
      const plan = planMetricQuery(
        {
          ...query,
          measures: leg.measures,
          dimensions: undefined,
          order: undefined,
          limit: undefined,
          offset: undefined,
        },
        leg.time,
        context,
        views,
        timeView ? { timeView } : {},
      );
      const load = await executeMetricQuery(cube, plan, securityContext, views);
      return { leg, row: load.data[0] };
    }),
  );

  const valueKey = (coordinateIndex: number, member: string) => `${coordinateIndex}\u0000${member}`;
  const values = new Map<string, number | null>();
  for (const { leg, row } of loaded) {
    for (const member of leg.measures) {
      values.set(valueKey(leg.coordinateIndex, member), totalValue(row?.[member]));
    }
  }
  return measures.map((member, index) => ({
    member,
    periods: businessTime.coordinates.map((_, coordinateIndex) => ({
      ...periods[coordinateIndex][index],
      value: values.get(valueKey(coordinateIndex, member)) ?? null,
    })),
  }));
}
