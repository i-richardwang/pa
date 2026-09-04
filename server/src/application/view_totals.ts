/**
 * 整窗合计的唯一供给点：值恒由 grain=total 的无分组腿独立求得，不对已返回序列加总或取末。
 *
 * 求值期间先由指标的业务求值基准解出，再按期间分腿——执行用的期间与结果声明的期间因此
 * 是同一个对象，不会出现「数值取终点、声明写整窗」。
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
import { physicalForm, resolveMetricTime } from "../engine/metric_time.js";
import type { BusinessTimeResolution } from "../engine/time_plan.js";
import type { TotalPeriodValue } from "../semantic_core/query_payload.js";
import {
  metricTimeCapabilities,
  totalPeriodOf,
  type TimeInput,
  type TotalPeriod,
} from "../semantic_core/time_contract.js";

/** 一个指标在全部时间坐标上的合计；periods 与 businessTime.coordinates 等长同序。 */
export type MetricTotals = { member: string; periods: TotalPeriodValue[] };

/**
 * 腿的物理形态由求值基准决定：时点与年初累计都在截止月份上求值，期间指标才发整段范围。
 * 降级的按月指标同样只在终点当月成立。
 */
function legTime(period: TotalPeriod): TimeInput {
  return period.degraded || physicalForm(period.basis) === "endpoint"
    ? { cutoff: period.to, grain: "total" }
    : { range: { from: period.from, to: period.to }, grain: "total" };
}

/** 求值期间相同、物理形态也相同的指标合成一条腿。 */
function legKey(period: TotalPeriod): string {
  return JSON.stringify(legTime(period));
}

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
  const periodOf = (name: string, coordinate: { from: string; to: string }) => {
    const member = members.get(name);
    if (!member) throw new Error(`合计求值缺少指标 ${name} 的时间合同`);
    const resolved = resolveMetricTime(member, members);
    return totalPeriodOf(resolved.basis, metricTimeCapabilities(resolved.contract), coordinate);
  };
  const periods = businessTime.coordinates.map((coordinate) =>
    measures.map((name) => periodOf(name, { from: coordinate.from, to: coordinate.to })),
  );

  const legs = businessTime.coordinates.flatMap((_coordinate, coordinateIndex) => {
    const grouped = new Map<string, { period: TotalPeriod; measures: string[] }>();
    measures.forEach((name, index) => {
      const period = periods[coordinateIndex][index];
      const key = legKey(period);
      const leg = grouped.get(key) ?? { period, measures: [] };
      leg.measures.push(name);
      grouped.set(key, leg);
    });
    return [...grouped.values()].map((leg) => ({
      coordinateIndex,
      measures: leg.measures,
      time: legTime(leg.period),
    }));
  });
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
