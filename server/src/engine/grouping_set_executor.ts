/**
 * 一个语义查询视图的 grouping-set Executor。
 *
 * 业务时间由基础分组集解析一次；其他分组集只改变分组与筛选血缘。构成占比与总体
 * 通过同一套粗粒度结果广播完成，不借用派生视图 join。
 */
import type { CubeCell } from "../ports/cube_gateway.js";
import type { ResolvedMetricLoad } from "./metric_calculator.js";
import { metricKeyMembers } from "./metric_planner.js";
import type { ResolvedGroupingSetPlan } from "./grouping_set_planner.js";

export type AppliedGroupingSets = {
  load: ResolvedMetricLoad;
  summary?: ResolvedMetricLoad;
  structure_shares: { measure: string; numerator: string }[];
};

const cell = (value: CubeCell): CubeCell => value ?? null;
const rowKey = (row: Record<string, CubeCell>, members: string[]): string =>
  JSON.stringify(members.map((member) => cell(row[member])));

function uniqueRows(
  rows: Record<string, CubeCell>[],
  keys: string[],
  label: string,
): Map<string, Record<string, CubeCell>> {
  const indexed = new Map<string, Record<string, CubeCell>>();
  for (const row of rows) {
    const missing = keys.find((key) => !Object.hasOwn(row, key));
    if (missing) throw new Error(`${label}缺少规范结果键 ${missing}`);
    const key = rowKey(row, keys);
    if (indexed.has(key)) throw new Error(`${label}在规范结果键上出现重复行`);
    indexed.set(key, row);
  }
  return indexed;
}

function requiredCell(row: Record<string, CubeCell>, member: string, label: string): CubeCell {
  if (!Object.hasOwn(row, member)) throw new Error(`${label}缺少指标列 ${member}`);
  return row[member];
}

function numeric(value: CubeCell, label: string): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}返回了非数值结果`);
  return parsed;
}

export function applyGroupingSets(
  plan: ResolvedGroupingSetPlan,
  base: ResolvedMetricLoad,
  resolvedLegs: ReadonlyMap<string, ResolvedMetricLoad>,
): AppliedGroupingSets {
  for (const leg of plan.legs) {
    if (
      JSON.stringify(leg.signature.business_time) !==
      JSON.stringify(plan.base_signature.business_time)
    ) {
      throw new Error(`分组腿 ${leg.id} 的执行时间签名与基础分组集不一致`);
    }
    const baseDimensions = new Set(plan.base_signature.grouping_set);
    if (
      leg.signature.grouping_set.length > plan.base_signature.grouping_set.length ||
      leg.signature.grouping_set.some((dimension) => !baseDimensions.has(dimension))
    ) {
      throw new Error(`分组腿 ${leg.id} 的执行分组集不是基础分组集的语义子集`);
    }
    const baseGrouping = new Set(plan.base_grouping_members);
    if (leg.plan.dimensions.some((dimension) => !baseGrouping.has(dimension))) {
      throw new Error(`分组腿 ${leg.id} 的执行物理分组不是基础物理分组的子集`);
    }
  }
  uniqueRows(base.data, plan.base_keys, "基础分组集");
  const data = base.data.map((row) => ({ ...row }));
  const structureShares: AppliedGroupingSets["structure_shares"] = [];

  for (const calculation of plan.calculations) {
    const leg = plan.legs.find((candidate) => candidate.id === calculation.denominator_leg);
    const load = resolvedLegs.get(calculation.denominator_leg);
    if (!leg || !load) throw new Error(`计算「${calculation.title}」的粗分组腿未完整执行`);
    if (
      leg.plan.dimensions.length >= plan.base_grouping_members.length ||
      leg.plan.dimensions.includes(calculation.category_member)
    ) {
      throw new Error(`计算「${calculation.title}」的执行物理分组没有形成真子集`);
    }
    const keys = metricKeyMembers(leg.plan);
    const denominators = uniqueRows(load.data, keys, `计算「${calculation.title}」的粗分组集`);
    for (const row of data) {
      const denominatorRow = denominators.get(rowKey(row, keys));
      if (!denominatorRow) {
        throw new Error(`计算「${calculation.title}」缺少对应的粗分组结果行`);
      }
      const numerator = numeric(
        requiredCell(row, calculation.measure, `计算「${calculation.title}」的分子`),
        `计算「${calculation.title}」的分子`,
      );
      const denominator = numeric(
        requiredCell(denominatorRow, calculation.measure, `计算「${calculation.title}」的分母`),
        `计算「${calculation.title}」的分母`,
      );
      row[calculation.column] =
        numerator === null || denominator === null || denominator === 0
          ? null
          : numerator / denominator;
    }
    structureShares.push({ measure: calculation.column, numerator: calculation.measure });
  }

  const measures = { ...base.annotation.measures };
  for (const calculation of plan.calculations) {
    measures[calculation.column] = {
      title: calculation.title,
      description: `正式指标在基础分组集中的值除以移除分类维度后的同口径合计。`,
    };
  }
  const summaryLoad = plan.summary_leg ? resolvedLegs.get(plan.summary_leg) : undefined;
  if (plan.summary_leg && !summaryLoad) throw new Error("总体分组腿未完整执行");
  if (plan.summary_leg) {
    const summaryLeg = plan.legs.find((leg) => leg.id === plan.summary_leg);
    if (!summaryLeg) throw new Error("总体分组腿不存在");
    if (summaryLeg.plan.dimensions.length) {
      throw new Error("总体分组腿的执行物理分组必须为空");
    }
  }
  const summary = summaryLoad
    ? {
        ...summaryLoad,
        data: summaryLoad.data.map((source) => {
          const row = { ...source };
          for (const calculation of plan.calculations) {
            const total = numeric(
              requiredCell(row, calculation.measure, `总体行的计算「${calculation.title}」`),
              `总体行的计算「${calculation.title}」`,
            );
            row[calculation.column] = total === null || total === 0 ? null : 1;
          }
          return row;
        }),
      }
    : undefined;
  return {
    load: { ...base, data, annotation: { ...base.annotation, measures } },
    ...(summary ? { summary } : {}),
    structure_shares: structureShares,
  };
}
