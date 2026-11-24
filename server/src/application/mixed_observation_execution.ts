import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import {
  calculationColumnName,
  type QueryViewSpec,
  type TopNSelectionSpec,
} from "../semantic_core/analysis_spec.js";
import { memberShortName, memberViewName } from "../semantic_core/member_name.js";
import { expandTimeCompare, expandTimeWindow } from "../semantic_core/time_contract.js";
import type { TimeSourceRegistry } from "../semantic_core/time_source.js";
import { AGGREGATE_CARD_ROWS, ResultLimitExceededError } from "../engine/result_limit.js";
import { bindSelectedGroups, orderResultRows, orderSelectedGroups } from "./group_selection.js";
import type { BoundGroupSelection, ExecutedViewResult } from "./query_pipeline.js";

type Cell = ExecutedViewResult["block"]["rows"][number][number];

export async function executeCalendarAndObservation(
  spec: QueryViewSpec,
  views: CubeView[],
  sources: TimeSourceRegistry,
  context: TimeContext,
  execute: (
    spec: QueryViewSpec,
    selection?: BoundGroupSelection,
    ranking?: boolean,
  ) => Promise<ExecutedViewResult>,
): Promise<ExecutedViewResult> {
  const groups = new Map<string, { view: string; measures: string[] }>();
  const selectedSources = new Set<string>();
  for (const member of spec.measures ?? []) {
    const view = memberViewName(member);
    const source = views.find(({ name }) => name === view)?.meta?.time_source;
    if (!view || typeof source !== "string") continue;
    selectedSources.add(source);
    const key = sources.by_id.get(source)?.observation ? source : "";
    const existing = groups.get(key);
    if (existing) existing.measures.push(member);
    else groups.set(key, { view, measures: [member] });
  }
  if (groups.size < 2) {
    const only = [...groups.values()][0];
    if (!only || only.view === spec.time_view || groups.has("")) return execute(spec);
    return execute(rebind(spec, only.view, only.measures));
  }
  const latest = [...selectedSources]
    .map((source) => context.sources[source].actualThrough)
    .sort()[0];
  const time = expandTimeCompare(expandTimeWindow(spec.time, latest), latest);
  const resolvedTime =
    "range" in time || "last" in time ? time : { ...time, cutoff: time.cutoff ?? latest };
  const legs = [...groups.values()].map(({ view, measures }) =>
    rebind({ ...spec, time: resolvedTime }, view, measures),
  );
  const selection = spec.selection ? await rankMixed(spec.selection, legs, execute) : undefined;
  const results = await Promise.all(
    legs.map((leg) =>
      execute(
        { ...leg, selection: undefined },
        selection && leg.selection
          ? bindSelectedGroups(leg.selection, selection.groups, selection.outcome.hasMoreGroups)
          : undefined,
      ),
    ),
  );
  return mergeResults(spec, results, selection);
}

function rebind(spec: QueryViewSpec, view: string, measures: string[]): QueryViewSpec {
  const dimension = (member: string) => `${view}.${memberShortName(member)}`;
  return {
    ...spec,
    measures,
    time_view: view,
    dimensions: spec.dimensions?.map(dimension),
    ...(spec.selection ? { selection: rebindSelection(spec.selection, view) } : {}),
    filters: spec.filters?.map((filter) => ({ ...filter, member: dimension(filter.member) })),
    order: spec.order
      ?.filter(({ member }) => measures.includes(member) || spec.dimensions?.includes(member))
      .map((order) => ({
        ...order,
        member: measures.includes(order.member) ? order.member : dimension(order.member),
      })),
    ...(spec.grouping_sets
      ? {
          grouping_sets: {
            ...spec.grouping_sets,
            calculations: spec.grouping_sets.calculations?.filter((calculation) =>
              measures.includes(calculation.measure),
            ),
            base: spec.grouping_sets.base.map((entry) => ({
              ...entry,
              member: dimension(entry.member),
            })),
          },
        }
      : {}),
  };
}

function rebindSelection(selection: TopNSelectionSpec, view: string): TopNSelectionSpec {
  const dimension = (member: string) => `${view}.${memberShortName(member)}`;
  return {
    ...selection,
    dimensions: selection.dimensions.map(dimension),
    by: selection.dimensions.includes(selection.by) ? dimension(selection.by) : selection.by,
  };
}

async function rankMixed(
  selection: TopNSelectionSpec,
  legs: QueryViewSpec[],
  execute: (
    spec: QueryViewSpec,
    selection?: BoundGroupSelection,
    ranking?: boolean,
  ) => Promise<ExecutedViewResult>,
): Promise<BoundGroupSelection> {
  const byName = selection.dimensions.includes(selection.by);
  const rankingLegs = byName ? legs : legs.filter((leg) => leg.measures?.includes(selection.by));
  const rankings = await Promise.all(
    rankingLegs.map(async (leg) => {
      const spec = leg.selection!;
      const result = await execute(
        {
          ...leg,
          measures: byName ? leg.measures : [selection.by],
          dimensions: spec.dimensions,
          grouping_sets: undefined,
          order: undefined,
        },
        undefined,
        true,
      );
      if (!result.groupSelection) throw new Error("混合指标未能解析 Top-N 分组");
      return result.groupSelection;
    }),
  );
  if (!rankings.length) throw new Error("混合指标缺少 Top-N 排名来源");
  if (!byName && rankings.length === 1) {
    return bindSelectedGroups(selection, rankings[0].groups, rankings[0].outcome.hasMoreGroups);
  }
  const all = [
    ...new Map(
      rankings.flatMap(({ groups }) =>
        groups.map((group) => [JSON.stringify(group), group] as const),
      ),
    ).values(),
  ];
  const by = selection.dimensions.indexOf(selection.by);
  const sign = selection.direction === "asc" ? 1 : -1;
  all.sort(
    (left, right) =>
      sign * String(left[by]).localeCompare(String(right[by])) ||
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return bindSelectedGroups(
    selection,
    all.slice(0, selection.count),
    all.length > selection.count || rankings.some(({ outcome }) => outcome.hasMoreGroups),
  );
}

function mergeResults(
  spec: QueryViewSpec,
  results: ExecutedViewResult[],
  selection?: BoundGroupSelection,
): ExecutedViewResult {
  const [first] = results;
  const keys = first.block.columns
    .filter((column) => first.block.column_roles[column] !== "measure")
    .map(memberShortName);
  const measures = (spec.measures ?? []).map(memberShortName);
  const calculations = (spec.grouping_sets?.calculations ?? []).map(({ id }) =>
    calculationColumnName(id),
  );
  const columns = [...keys, ...measures, ...calculations];
  const records = new Map<string, Record<string, Cell>>();
  const totals = new Map<string, Record<string, Cell>>();
  const formats: NonNullable<typeof first.block.column_formats> = {};
  const decimals: NonNullable<typeof first.block.column_decimals> = {};
  const basis: NonNullable<typeof first.block.column_time_basis> = {};
  const roles: typeof first.block.column_roles = {};
  const columnTime = [];
  const shares = [];
  for (const { block } of results) {
    if (block.has_more) throw limit();
    const normalized = block.columns.map(memberShortName);
    const sourceKeys = normalized.filter(
      (_, index) => block.column_roles[block.columns[index]] !== "measure",
    );
    if (sourceKeys.length !== keys.length || keys.some((key) => !sourceKeys.includes(key))) {
      throw new Error("混合指标结果的时间或分组不一致");
    }
    const addRows = (target: typeof records, rows: Cell[][], keyColumns: string[]) => {
      const seen = new Set<string>();
      for (const row of rows) {
        const record = Object.fromEntries(normalized.map((column, index) => [column, row[index]]));
        const id = JSON.stringify(
          keyColumns.map((key) =>
            key === "year" || key === "month" ? Number(record[key]) : record[key],
          ),
        );
        if (seen.has(id)) throw new Error("混合指标来源存在重复结果键");
        seen.add(id);
        target.set(id, { ...target.get(id), ...record });
      }
    };
    addRows(records, block.rows, keys);
    addRows(
      totals,
      block.summary?.rows ?? [],
      keys.filter((key) => key === "year" || key === "month"),
    );
    for (const column of block.columns) {
      const short = memberShortName(column);
      const format = block.column_formats?.[column];
      const decimal = block.column_decimals?.[column];
      const timeBasis = block.column_time_basis?.[column];
      if (format) formats[short] = format;
      if (decimal !== undefined) decimals[short] = decimal;
      if (timeBasis) basis[short] = timeBasis;
      roles[short] = block.column_roles[column];
    }
    columnTime.push(
      ...(block.totals?.metrics ?? []).map((metric) => ({
        ...metric,
        column: memberShortName(metric.column),
      })),
    );
    shares.push(
      ...(block.structure_shares ?? []).map((share) => ({
        measure: memberShortName(share.measure),
        numerator: memberShortName(share.numerator),
      })),
    );
  }
  if (records.size > AGGREGATE_CARD_ROWS) throw limit();
  const toRows = (items: typeof records) =>
    [...items.values()].map((record) => columns.map((column) => record[column] ?? null));
  const summary = results.find(({ block }) => block.summary)?.block.summary;
  const { summary: _summary, totals: _totals, structure_shares: _shares, ...block } = first.block;
  const observed = results.flatMap(({ block }) => {
    const columns = block.columns
      .filter((key) => block.column_roles[key] === "measure")
      .map(memberShortName);
    return (block.observations ?? []).map((period) => ({ ...period, columns }));
  });
  const sourceSemantics = first.sourceSemantics
    ? {
        time: first.sourceSemantics.time,
        columns: new Map(
          results.flatMap((result) =>
            [...(result.sourceSemantics?.columns ?? [])].map(
              ([name, semantics]) => [memberShortName(name), semantics] as const,
            ),
          ),
        ),
      }
    : undefined;
  const output: ExecutedViewResult["block"] = {
    ...block,
    ...(observed.length ? { observations: observed } : {}),
    columns,
    column_roles: roles,
    column_formats: formats,
    column_decimals: decimals,
    column_time_basis: basis,
    query_notes: results.flatMap(({ block }) => block.query_notes),
    display_notes: results.flatMap(({ block }) => block.display_notes ?? []),
    ...(columnTime.length
      ? {
          totals: {
            metrics: columnTime.sort(
              (left, right) => measures.indexOf(left.column) - measures.indexOf(right.column),
            ),
          },
        }
      : {}),
    ...(shares.length ? { structure_shares: shares } : {}),
    ...(summary ? { summary: { ...summary, rows: toRows(totals) } } : {}),
    rows: toRows(records),
    row_count: records.size,
  };
  return {
    block: selection ? orderSelectedGroups(output, selection) : orderResultRows(output, spec.order),
    sampleForModel: true,
    resolvedDeliveryColumns: first.resolvedDeliveryColumns,
    ...(selection ? { groupSelection: selection } : {}),
    ...(sourceSemantics ? { sourceSemantics } : {}),
  };
}

function limit() {
  return new ResultLimitExceededError("混合指标结果超过交付上限", { limit: AGGREGATE_CARD_ROWS });
}
