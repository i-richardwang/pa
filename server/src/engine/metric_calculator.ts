/**
 * 正式指标 Calculator：对齐各单事实聚合结果并计算声明式指标节点。
 * 本模块不规划查询、不访问 Cube，也不接受用户公式。
 */
import type { TopNSelectionSpec } from "../semantic_core/analysis_spec.js";
import type {
  CubeFilter,
  CubeFilterCondition,
  CubeView,
  LoadResponse,
} from "../ports/cube_gateway.js";
import type { MetricComponent } from "./metric_model.js";
import {
  metricKeyMembers,
  metricTimeMembers,
  type ExecutableMetricNode,
  type MetricQueryLeg,
  type MetricQueryPlan,
} from "./metric_planner.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { sortRowsByOrder, type ResolvedLoad } from "./time_executor.js";

export type MetricSelectionOutcome = {
  dimensions: string[];
  by: string;
  window: "anchor" | "all";
  direction: "asc" | "desc";
  requestedCount: number;
  selectedCount: number;
  hasMoreGroups: boolean;
};

/** 一个输出指标被最小样本量保护置空的结果格统计，用于结果注记披露。 */
export type MaskedMeasureSummary = {
  member: string;
  threshold: number;
  groups: number;
};

export type ResolvedMetricLoad = ResolvedLoad & {
  selection?: MetricSelectionOutcome;
  /** 选中分组的规范维度过滤，仅供总体与完整展示查询复用。 */
  selectionFilter?: CubeFilter;
  /** 最小样本量保护实际生效的指标；空缺表示本次结果没有格被置空。 */
  masked?: MaskedMeasureSummary[];
};

const cell = (value: unknown): string | number | boolean | null => {
  if (value == null) return null;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : String(value);
};

function canonicalRow(
  plan: MetricQueryPlan,
  leg: MetricQueryLeg,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [physical, canonical] of Object.entries(leg.dimensions)) {
    row[canonical] = source[physical] ?? null;
  }
  for (const canonical of metricTimeMembers(plan)) {
    const short = memberShortName(canonical);
    row[canonical] = source[`${leg.source_view}.${short}`] ?? null;
  }
  for (const [physical, metricId] of Object.entries(leg.measures)) {
    row[`__metric:${metricId}`] = source[physical] ?? null;
  }
  return row;
}

function metricValue(
  metricId: string,
  row: Record<string, unknown>,
  nodes: Readonly<Record<string, ExecutableMetricNode>>,
  memo: Map<string, number | null>,
): number | null {
  if (memo.has(metricId)) return memo.get(metricId)!;
  const node = nodes[metricId];
  if (!node) throw new Error(`正式指标 ${metricId} 缺少可执行节点`);
  if (node.kind === "aggregate") {
    const raw = row[`__metric:${metricId}`];
    const value = raw == null ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`叶子指标 ${metricId} 返回了非数值结果`);
    }
    memo.set(metricId, value);
    return value;
  }
  const component = (input: MetricComponent): number | null => {
    const value = metricValue(input.metric_id, row, nodes, memo);
    return value === null && input.missing === "zero" ? 0 : value;
  };
  if (node.kind === "availability_guard") {
    const availability = component(node.availability);
    const value = availability === null ? null : component(node.value);
    memo.set(metricId, value);
    return value;
  }
  const numerator = component(node.numerator);
  const denominator = component(node.denominator);
  const value =
    numerator === null || denominator === null || denominator === 0
      ? null
      : numerator / denominator;
  memo.set(metricId, value);
  return value;
}

function annotation(plan: MetricQueryPlan, views: CubeView[]): LoadResponse["annotation"] {
  const measures = Object.fromEntries(
    plan.measures.map((name) => {
      const member = views
        .flatMap((view) => view.measures)
        .find((candidate) => candidate.name === name);
      if (!member) throw new Error(`输出指标 ${name} 不在模型中`);
      return [
        name,
        {
          title: member.title,
          ...(member.description ? { description: member.description } : {}),
        },
      ];
    }),
  );
  const dimensions = Object.fromEntries(
    plan.dimensions.map((name) => {
      const member = views
        .flatMap((view) => view.dimensions)
        .find((candidate) => candidate.name === name);
      if (!member) throw new Error(`输出维度 ${name} 不在模型中`);
      return [
        name,
        {
          title: member.title,
          ...(member.description ? { description: member.description } : {}),
        },
      ];
    }),
  );
  for (const timeMember of metricTimeMembers(plan)) {
    const short = memberShortName(timeMember);
    dimensions[timeMember] =
      short === "year"
        ? { title: "年", description: "结果对应的年份。" }
        : { title: "月", description: "结果对应的月份。" };
  }
  return { measures, dimensions };
}

const selectionCell = (value: unknown): string | null => (value == null ? null : String(value));
const selectionKey = (dimensions: string[], row: Record<string, unknown>) =>
  JSON.stringify(dimensions.map((dimension) => selectionCell(row[dimension])));

function applySelection(
  plan: MetricQueryPlan,
  rows: Record<string, unknown>[],
  selection: TopNSelectionSpec,
): {
  rows: Record<string, unknown>[];
  outcome: MetricSelectionOutcome;
  filter: CubeFilter;
} {
  const byName = selection.dimensions.includes(selection.by);
  const candidates = byName
    ? [
        ...new Map(
          rows
            .filter((row) => row[selection.by] != null)
            .map((row) => [selectionKey(selection.dimensions, row), row]),
        ).values(),
      ]
    : (() => {
        const bucket = plan.business_time.coordinates[0]?.buckets.at(-1);
        if (!bucket) throw new Error("Top-N 主范围没有可用业务时间桶");
        const yearMember = `${plan.time_view}.year`;
        const monthMember = `${plan.time_view}.month`;
        return rows.filter((row) => {
          if (plan.business_time.outputGrain === "total") return true;
          if (String(row[yearMember]) !== bucket.to.slice(0, 4)) return false;
          return (
            plan.business_time.outputGrain !== "month" ||
            String(row[monthMember]) === String(Number(bucket.to.slice(5, 7)))
          );
        });
      })();
  const ranked = candidates
    .filter((row) => row[selection.by] != null)
    .sort((left, right) => {
      const compared = byName
        ? String(left[selection.by]).localeCompare(String(right[selection.by]))
        : (() => {
            const l = Number(left[selection.by]);
            const r = Number(right[selection.by]);
            return (Number.isFinite(l) ? l : 0) - (Number.isFinite(r) ? r : 0);
          })();
      if (compared) return selection.direction === "desc" ? -compared : compared;
      return selectionKey(selection.dimensions, left).localeCompare(
        selectionKey(selection.dimensions, right),
      );
    });
  const selectedKeys = ranked
    .slice(0, selection.count)
    .map((row) => selectionKey(selection.dimensions, row));
  if (new Set(selectedKeys).size !== selectedKeys.length) {
    throw new Error("Top-N 选择结果的业务分组键不唯一");
  }
  const rank = new Map(selectedKeys.map((key, index) => [key, index]));
  const selectedRows = rows.filter((row) => rank.has(selectionKey(selection.dimensions, row)));
  // selectedRows 已按 rank.has 过滤，两侧名次必然存在。
  selectedRows.sort(
    (left, right) =>
      rank.get(selectionKey(selection.dimensions, left))! -
      rank.get(selectionKey(selection.dimensions, right))!,
  );
  const tupleFilter = (row: Record<string, unknown>): CubeFilter => {
    const conditions: CubeFilterCondition[] = selection.dimensions.map((member) => {
      const value = selectionCell(row[member]);
      return value === null
        ? { member, operator: "notSet" }
        : { member, operator: "equals", values: [value] };
    });
    return conditions.length === 1 ? conditions[0]! : { and: conditions };
  };
  const selectedCandidates = ranked.slice(0, selection.count);
  const firstDimension = selection.dimensions[0]!;
  const filter: CubeFilter = selectedCandidates.length
    ? selectedCandidates.length === 1
      ? tupleFilter(selectedCandidates[0]!)
      : { or: selectedCandidates.map(tupleFilter) }
    : {
        and: [
          { member: firstDimension, operator: "set" },
          { member: firstDimension, operator: "notSet" },
        ],
      };
  return {
    rows: selectedRows,
    filter,
    outcome: {
      dimensions: selection.dimensions,
      by: selection.by,
      window: byName ? "all" : "anchor",
      direction: selection.direction,
      requestedCount: selection.count,
      selectedCount: selectedKeys.length,
      hasMoreGroups: ranked.length > selection.count,
    },
  };
}

export function alignMetricLoads(
  plan: MetricQueryPlan,
  loads: ResolvedLoad[],
  views: CubeView[],
): ResolvedMetricLoad {
  if (loads.length !== plan.legs.length) throw new Error("正式指标查询腿执行结果不完整");
  const keys = metricKeyMembers(plan);
  const aligned = new Map<string, Record<string, unknown>>();
  loads.forEach((load, index) => {
    const leg = plan.legs[index];
    const seen = new Set<string>();
    for (const source of load.data) {
      const normalized = canonicalRow(plan, leg, source);
      const key = JSON.stringify(keys.map((member) => cell(normalized[member])));
      if (seen.has(key)) {
        throw new Error(`正式指标查询腿 ${index + 1} 返回重复业务键，无法安全对齐`);
      }
      seen.add(key);
      const target =
        aligned.get(key) ??
        Object.fromEntries(keys.map((member) => [member, normalized[member] ?? null]));
      for (const [name, value] of Object.entries(normalized)) {
        if (!keys.includes(name)) target[name] = value;
      }
      aligned.set(key, target);
    }
  });
  const outputMembers = [...keys, ...plan.measures];
  const maskedGroups = new Map<string, number>();
  const data = [...aligned.values()].map((internal) => {
    const memo = new Map<string, number | null>();
    const output: Record<string, unknown> = Object.fromEntries(
      keys.map((key) => [key, internal[key] ?? null]),
    );
    for (const member of plan.measures) {
      output[member] = metricValue(plan.output_metric_ids[member], internal, plan.nodes, memo);
    }
    for (const rule of plan.min_sample ?? []) {
      if (output[rule.measure] == null) continue;
      const sample = metricValue(rule.denominator, internal, plan.nodes, memo);
      if (sample === null || sample < rule.threshold) {
        output[rule.measure] = null;
        maskedGroups.set(rule.measure, (maskedGroups.get(rule.measure) ?? 0) + 1);
      }
    }
    return Object.fromEntries(outputMembers.map((member) => [member, output[member] ?? null]));
  });
  const masked = (plan.min_sample ?? [])
    .filter((rule) => maskedGroups.has(rule.measure))
    .map((rule) => ({
      member: rule.measure,
      threshold: rule.threshold,
      groups: maskedGroups.get(rule.measure)!,
    }));
  sortRowsByOrder(data, [
    ...(plan.order ?? []),
    ...metricTimeMembers(plan).map((member): [string, "asc"] => [member, "asc"]),
  ]);
  if (!plan.selection) {
    return {
      data,
      annotation: annotation(plan, views),
      ...(masked.length ? { masked } : {}),
    };
  }
  const selection = applySelection(plan, data, plan.selection);
  return {
    data: selection.rows,
    annotation: annotation(plan, views),
    selection: selection.outcome,
    selectionFilter: selection.filter,
    ...(masked.length ? { masked } : {}),
  };
}
