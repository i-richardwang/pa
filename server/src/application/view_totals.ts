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
import type { MetricTimeResolution } from "../semantic_core/metric_time_contract.js";
import type { TotalPeriodValue } from "../semantic_core/query_payload.js";
import { totalPeriodOf, type TimeInput, type TotalPeriod } from "../semantic_core/time_contract.js";

/** 一个指标在全部时间坐标上的合计；periods 与 businessTime.coordinates 等长同序。 */
export type MetricTotals = { member: string; periods: TotalPeriodValue[] };

/**
 * 腿的物理形态由求值基准决定：时点与年初累计都在截止月份上求值，期间指标才发整段范围。
 * 降级的按月指标同样只在终点当月成立。
 */
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
  const timeOf = (name: string): MetricTimeResolution => {
    const member = members.get(name);
    if (!member) throw new Error(`合计求值缺少指标 ${name} 的时间合同`);
    return resolveMetricTime(member, members);
  };

  // 每个（坐标 × 指标）格先各自定下求值期间与物理腿；后面的分腿、取值、交付都读同一份格子。
  const cells = businessTime.coordinates.map((coordinate) =>
    measures.map((member) => {
      const time = timeOf(member);
      const period = totalPeriodOf(time, { from: coordinate.from, to: coordinate.to });
      return { member, period, leg: legTime(time, period), value: null as number | null };
    }),
  );

  /** 求值期间与物理形态都相同的指标合成一条腿。 */
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

  // 基准不随合计位交付：它在结果里由指标列声明一次，这里只交出它展开出的期间与值。
  return measures.map((member, index) => ({
    member,
    periods: cells.map((row) => ({ ...row[index].period, value: row[index].value })),
  }));
}
