/** 整段合计只在这里计算：用一条不分组的 grain=total 子查询单独求值，不对已返回的序列求和或取末值。 */
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
import type { MetricTimeResolution } from "../semantic_core/metric_time_contract.js";
import type { TotalPeriodValue } from "../semantic_core/query_payload.js";
import { totalPeriodOf, type TimeInput, type TotalPeriod } from "../semantic_core/time_contract.js";

export type MetricTotals = { member: string; periods: TotalPeriodValue[] };

/** 时点与年初累计指标、降级为按月的指标按截止月份求值，期间指标按整段范围求值。 */
function legTime(time: MetricTimeResolution, period: TotalPeriod): TimeInput {
  return period.degraded || physicalForm(time.basis) === "endpoint"
    ? { cutoff: period.to, grain: "total" }
    : { range: { from: period.from, to: period.to }, grain: "total" };
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
  /** 已完成层级补全的查询；合计只使用其中的筛选条件和指标，不带分组和排序。 */
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
  const timeOf = (name: string): MetricTimeResolution => {
    const member = members.get(name);
    if (!member) throw new Error(`合计求值缺少指标 ${name} 的时间合同`);
    return resolveMetricTime(member, members);
  };

  const cells = businessTime.coordinates.map((coordinate) =>
    measures.map((member) => {
      const time = timeOf(member);
      const period = totalPeriodOf(time, { from: coordinate.from, to: coordinate.to });
      return { member, period, leg: legTime(time, period), value: null as number | null };
    }),
  );

  const legs = cells.flatMap((row) => {
    const grouped = new Map<string, typeof row>();
    for (const cell of row) {
      const key = JSON.stringify(cell.leg);
      grouped.set(key, [...(grouped.get(key) ?? []), cell]);
    }
    return [...grouped.values()].map((group) => ({ time: group[0].leg, cells: group }));
  });

  await Promise.all(
    legs.map(async (leg) => {
      const plan = planMetricQuery(
        {
          ...query,
          measures: leg.cells.map((cell) => cell.member),
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
      for (const cell of leg.cells) cell.value = totalValue(load.data[0]?.[cell.member]);
    }),
  );

  return measures.map((member, index) => ({
    member,
    periods: cells.map((row) => ({ ...row[index].period, value: row[index].value })),
  }));
}
