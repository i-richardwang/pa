import { applyValueOrder } from "../engine/value_order.js";
import type { AppliedGroupingSets } from "../engine/grouping_set_executor.js";
import { memberSemanticId } from "../engine/model_contract.js";
import { resolveMetricTime } from "../engine/metric_time.js";
import {
  metricOutputMembers,
  metricTimeMembers,
  type MetricQueryPlan,
} from "../engine/metric_planner.js";
import { structureSharesOf } from "../engine/measure_relations.js";
import { resultBuckets, resultCoordinates } from "../engine/time_plan.js";
import type {
  DerivedSourceSemantics,
  EngineViewBlock,
  SourceColumnSemantics,
} from "../engine/transform.js";
import type { CubeQuery, CubeView } from "../ports/cube_gateway.js";
import { calculationColumnName, type QueryViewSpec } from "../semantic_core/analysis_spec.js";
import { memberShortName, memberViewName } from "../semantic_core/member_name.js";
import {
  COLUMN_DECIMALS_SCHEMA,
  COLUMN_FORMATS,
  isColumnFormat,
  type ColumnFormat,
  type QueryNote,
} from "../semantic_core/query_payload.js";
import { basisNote } from "../semantic_core/metric_value_basis.js";
import type { MetricSelectionOutcome } from "../engine/metric_calculator.js";
import { AGGREGATE_CARD_ROWS, resolveLimitOutcome } from "../engine/result_limit.js";
import type { ResolvedGroupingSetPlan } from "../engine/grouping_set_planner.js";
import type { MetricTotals } from "./view_totals.js";
import type { ExecutedViewResult } from "./query_pipeline.js";
import { appendQueryNote } from "./query_result_notes.js";

function buildSourceSemantics(
  memberKeys: string[],
  columns: string[],
  authViews: CubeView[],
  timeView: string,
  time: DerivedSourceSemantics["time"],
  calculations: NonNullable<QueryViewSpec["grouping_sets"]>["calculations"] = [],
): DerivedSourceSemantics {
  if (new Set(columns).size !== columns.length) {
    throw new Error("查询结果列名在省略 view 前缀后发生碰撞；请联系维护者调整模型成员名");
  }
  const measures = new Map(
    authViews
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .map((member) => [member.name, member]),
  );
  const dimensions = new Map(
    authViews.flatMap((view) => view.dimensions).map((member) => [member.name, member]),
  );
  const resolved = new Map<string, SourceColumnSemantics>();
  const calculationByColumn = new Map(
    calculations.map((item) => [calculationColumnName(item.id), item]),
  );
  memberKeys.forEach((memberName, index) => {
    const column = columns[index];
    const calculation = calculationByColumn.get(memberName);
    if (calculation) {
      const measure = measures.get(calculation.measure);
      if (!measure) throw new Error(`计算「${calculation.title}」的基础指标不在查询结果中`);
      resolved.set(column, {
        member: memberName,
        alias: calculation.id,
        kind: "measure",
        valueType: "number",
        timeBasis: resolveMetricTime(measure, measures).basis,
      });
      return;
    }
    const measure = measures.get(memberName);
    const dimension = dimensions.get(memberName);
    if (measure) {
      const metricTime = resolveMetricTime(measure, measures);
      resolved.set(column, {
        member: memberName,
        alias: measure.aliasMember ?? measure.name,
        kind: "measure",
        valueType: measure.type,
        timeBasis: metricTime.basis,
      });
      return;
    }
    if (dimension) {
      resolved.set(column, {
        member: memberName,
        alias: dimension.aliasMember ?? dimension.name,
        kind: "dimension",
        valueType: dimension.type,
        semanticId: memberSemanticId("dimension", memberName),
      });
      return;
    }
    const short = memberShortName(memberName);
    if (memberName === `${timeView}.${short}` && (short === "year" || short === "month")) {
      resolved.set(column, {
        member: memberName,
        alias: `time.${short}`,
        kind: "time",
        valueType: "string",
      });
      return;
    }
    throw new Error(`查询结果列 ${memberName} 无法解析到公开成员或系统生成的时间列`);
  });
  return { columns: resolved, time };
}

export function encodeQueryResult(input: {
  spec: QueryViewSpec;
  views: CubeView[];
  shapedQuery: CubeQuery;
  queryPlan: MetricQueryPlan;
  groupingPlan: ResolvedGroupingSetPlan;
  grouping: AppliedGroupingSets;
  totals: MetricTotals[];
  selection?: MetricSelectionOutcome;
  queryNotes: QueryNote[];
  displayNotes: QueryNote[];
}): ExecutedViewResult {
  const {
    spec,
    views,
    shapedQuery,
    queryPlan,
    groupingPlan,
    grouping,
    totals: metricTotals,
    selection,
    queryNotes,
    displayNotes,
  } = input;
  const finalResolved = grouping.load;
  const visibleMembers = views.flatMap((view) => [...view.measures, ...view.dimensions]);
  const calculationColumns = groupingPlan.calculations.map((calculation) => calculation.column);
  const baseMemberKeys = metricOutputMembers(queryPlan);
  const memberKeys = [...baseMemberKeys, ...calculationColumns];
  const columnsOf = (keys: string[]) => {
    const singleView = new Set(keys.map(memberViewName)).size === 1;
    return singleView ? keys.map(memberShortName) : keys;
  };
  const memberFormats = new Map<string, ColumnFormat>(
    visibleMembers.flatMap((member) => {
      if (!member.format) return [];
      if (!isColumnFormat(member.format)) {
        throw new Error(
          `模型成员 ${member.name} 使用了不支持的 format=${member.format}；` +
            `请联系维护者改为 ${COLUMN_FORMATS.join("、")} 之一`,
        );
      }
      return [[member.name, member.format]];
    }),
  );
  const columnFormatsOf = (keys: string[], columns: string[]) =>
    Object.fromEntries(
      keys.flatMap((key, index) => {
        const format = memberFormats.get(key);
        return format ? [[columns[index], format]] : [];
      }),
    );
  const memberDecimals = new Map<string, number>(
    visibleMembers.flatMap((member) => {
      const decimals = member.meta?.decimals;
      if (decimals === undefined) return [];
      const parsed = COLUMN_DECIMALS_SCHEMA.safeParse(decimals);
      if (!parsed.success) {
        throw new Error(`模型成员 ${member.name} 的 meta.decimals 必须是 0–4 的整数`);
      }
      return [[member.name, parsed.data]];
    }),
  );
  const columnDecimalsOf = (keys: string[], columns: string[]) =>
    Object.fromEntries(
      keys.flatMap((key, index) => {
        const decimals = memberDecimals.get(key);
        return decimals === undefined ? [] : [[columns[index], decimals]];
      }),
    );
  const toCells = (records: Record<string, string | number | null>[]) =>
    records.map((record) => memberKeys.map((key) => record[key] ?? null));

  const completeResult = Boolean(selection) || groupingPlan.calculations.length > 0;
  const { rowCount, hasMore, truncated } = completeResult
    ? { rowCount: finalResolved.data.length, hasMore: false, truncated: undefined }
    : resolveLimitOutcome(finalResolved.data.length, AGGREGATE_CARD_ROWS);
  const records = completeResult
    ? finalResolved.data
    : applyValueOrder(finalResolved.data.slice(0, rowCount), shapedQuery, views);
  const columns = [...columnsOf(baseMemberKeys), ...calculationColumns];
  const sourceSemantics = buildSourceSemantics(
    memberKeys,
    columns,
    views,
    queryPlan.time_view,
    queryPlan.business_time,
    spec.grouping_sets?.calculations,
  );
  const columnFormats = {
    ...columnFormatsOf(baseMemberKeys, columns.slice(0, baseMemberKeys.length)),
    ...Object.fromEntries(calculationColumns.map((column) => [column, "percent" as const])),
  };
  const columnDecimals = columnDecimalsOf(memberKeys, columns);
  const columnRoles = Object.fromEntries(
    [...sourceSemantics.columns].map(([column, semantics]) => [column, semantics.kind]),
  );
  const columnTimeBasis = Object.fromEntries(
    [...sourceSemantics.columns].flatMap(([column, semantics]) =>
      semantics.timeBasis ? [[column, semantics.timeBasis] as const] : [],
    ),
  );
  const basisByMember = new Map(
    [...sourceSemantics.columns.values()].flatMap((semantics) =>
      semantics.timeBasis ? [[semantics.member, semantics.timeBasis] as const] : [],
    ),
  );
  for (const note of queryNotes) {
    const basis = basisByMember.get(note.member);
    if (basis) appendQueryNote(note, basisNote(basis));
  }
  const modelStructureShares = structureSharesOf(baseMemberKeys, columns, visibleMembers);
  const columnOfMember = new Map(memberKeys.map((key, index) => [key, columns[index]]));
  const resolvedDeliveryColumns = Object.fromEntries(
    metricTimeMembers(queryPlan).map((member) => {
      const column = columnOfMember.get(member);
      if (!column) throw new Error(`时间成员 ${member} 不在执行结果列中`);
      return [column, memberShortName(member)];
    }),
  );
  const calculatedStructureShares = grouping.structure_shares.map((share) => {
    const measure = columnOfMember.get(share.measure);
    const numerator = columnOfMember.get(share.numerator);
    if (!measure || !numerator) throw new Error("找不到构成占比对应的结果列");
    return { measure, numerator };
  });
  const structureShares = [...modelStructureShares, ...calculatedStructureShares];
  const rows = toCells(records);
  const summaryRows = grouping.summary ? toCells(grouping.summary.data) : undefined;
  const totals = metricTotals.map(({ member, periods }) => {
    const column = columnOfMember.get(member);
    if (!column) throw new Error(`整段合计的指标 ${member} 不在结果列中`);
    return { column, periods };
  });
  const block: EngineViewBlock = {
    id: spec.id,
    ...(spec.view_title ? { view_title: spec.view_title } : {}),
    columns,
    ...(Object.keys(columnFormats).length ? { column_formats: columnFormats } : {}),
    ...(Object.keys(columnDecimals).length ? { column_decimals: columnDecimals } : {}),
    column_roles: columnRoles,
    ...(Object.keys(columnTimeBasis).length ? { column_time_basis: columnTimeBasis } : {}),
    ...(structureShares.length ? { structure_shares: structureShares } : {}),
    rows,
    ...(summaryRows?.length
      ? {
          summary: {
            kind: "grand_total" as const,
            label: selection ? "所选分组总体" : "总体",
            scope: selection ? ("selected_groups" as const) : ("filtered_set" as const),
            rows: summaryRows,
          },
        }
      : {}),
    ...(totals.length ? { totals: { metrics: totals } } : {}),
    row_count: rows.length,
    has_more: hasMore,
    ...(truncated ? { truncated } : {}),
    ...(selection
      ? {
          selection_scope: {
            type: "top_n" as const,
            grain: selection.dimensions,
            by: selection.by,
            window: selection.window,
            direction: selection.direction,
            requested_count: selection.requestedCount,
            selected_count: selection.selectedCount,
            has_more_groups: selection.hasMoreGroups,
          },
        }
      : {}),
    time: {
      grain: queryPlan.business_time.outputGrain,
      coordinates: resultCoordinates(queryPlan.business_time),
      buckets: resultBuckets(queryPlan.business_time),
    },
    query_notes: queryNotes,
    display_notes: displayNotes,
  };
  return {
    block,
    sampleForModel: true,
    sourceSemantics,
    resolvedDeliveryColumns,
    ...(truncated && !groupingPlan.calculations.length ? { exportPlan: queryPlan } : {}),
  };
}
