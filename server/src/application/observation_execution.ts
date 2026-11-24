import { AGGREGATE_CARD_ROWS, ResultLimitExceededError } from "../engine/result_limit.js";
import type { SourceColumnSemantics } from "../engine/transform.js";
import { basisPeriod } from "../semantic_core/metric_value_basis.js";
import {
  resultBuckets,
  resultCoordinates,
  type BusinessTimeResolution,
} from "../engine/time_plan.js";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import type { Occurrence, ObservationDirectory } from "./observation_directory.js";
import type { QueryViewSpec } from "../semantic_core/analysis_spec.js";
import type { ObservationPeriod, ResultTime } from "../semantic_core/query_payload.js";
import {
  resolveTimeSelection,
  timeAvailabilityIssue,
  timeBuckets,
  TimeSelectionError,
  type ObservationSelection,
} from "../semantic_core/time_contract.js";
import type { ObservationSource, TimeSourceRegistry } from "../semantic_core/time_source.js";
import { bindSelectedGroups, orderSelectedGroups, orderResultRows } from "./group_selection.js";
import type { BoundGroupSelection, ExecutedViewResult } from "./query_pipeline.js";

const TREND_COLUMNS = ["observation_id", "observation_date"];

type SelectedObservations = {
  periods: ObservationPeriod[];
  time?: ResultTime;
  business?: BusinessTimeResolution;
  trend?: true;
};

export function selectObservations(
  occurrences: Occurrence[],
  time: QueryViewSpec["time"],
  source: TimeContext["sources"][string],
): SelectedObservations {
  const native: ObservationSelection | undefined =
    "observation" in time ? time.observation : undefined;
  if (native?.kind === "occurrence") {
    const match = occurrences.find(({ id }) => id === native.id);
    return {
      periods: [
        match
          ? { requested_id: native.id, status: "observed", occurrence: match }
          : { requested_id: native.id, status: "not_observed" },
      ],
    };
  }
  if (native?.kind === "trend") {
    return {
      trend: true,
      periods: occurrences
        .filter((entry) => entry.date >= native.from && entry.date <= native.to)
        .map((occurrence) => ({ status: "observed", occurrence })),
    };
  }
  if (native?.kind === "as_of") {
    const cutoff = native.date;
    const match = occurrences.findLast((entry) => entry.date <= cutoff);
    return {
      periods: [
        {
          requested_date: cutoff,
          status: !match
            ? "not_observed"
            : match.date.slice(0, 7) === cutoff.slice(0, 7)
              ? "observed"
              : "no_release",
          ...(match ? { occurrence: match } : {}),
        },
      ],
    };
  }
  const resolved = resolveTimeSelection(time, source.actualThrough);
  if (resolved.status === "invalid") throw new TimeSelectionError(resolved.issue);
  const { selection } = resolved;
  const issue = timeAvailabilityIssue(selection, source.availableThrough);
  if (issue) throw new TimeSelectionError(issue);
  const outputGrain = selection.outputGrain;
  const business = {
    outputGrain,
    coordinates: selection.coordinates.map((coordinate) => ({
      kind: coordinate.kind,
      from: coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.from,
      to: coordinate.kind === "cutoff" ? coordinate.cutoff : coordinate.to,
      buckets: timeBuckets(coordinate, outputGrain),
    })),
  };
  const buckets = resultBuckets(business);
  return {
    time: { grain: outputGrain, buckets, coordinates: resultCoordinates(business) },
    business,
    periods: buckets.map(({ from, to }) => {
      const match = occurrences.findLast((entry) => entry.date.slice(0, 7) <= to);
      return {
        requested: { from, to },
        status: !match ? "not_observed" : match.date.slice(0, 7) < from ? "no_release" : "observed",
        ...(match ? { occurrence: match } : {}),
      };
    }),
  };
}

type ExecutionInput = {
  directory: ObservationDirectory;
  spec: QueryViewSpec;
  views: CubeView[];
  context: TimeContext;
  sources: TimeSourceRegistry;
  execute: (
    spec: QueryViewSpec,
    summary: boolean,
    totals: boolean,
    selection?: BoundGroupSelection,
  ) => Promise<ExecutedViewResult>;
  summary: boolean;
  totals?: boolean;
  selection?: BoundGroupSelection;
};

export function executeObservationView(
  input: ExecutionInput,
): Promise<ExecutedViewResult> | undefined {
  const { spec, views, sources } = input;
  const view = views.find(({ name }) => name === spec.time_view);
  const sourceId = view?.meta?.time_source;
  const source = typeof sourceId === "string" && sources.by_id.get(sourceId)?.observation;
  if (!view || typeof sourceId !== "string" || !source) return undefined;
  return executeSelectedObservations(input, view, sourceId, source);
}

async function executeSelectedObservations(
  input: ExecutionInput,
  view: CubeView,
  sourceId: string,
  source: ObservationSource,
): Promise<ExecutedViewResult> {
  const { spec, context } = input;
  const sourceContext = context.sources[sourceId];
  if (!sourceContext) throw new Error("观测时间来源缺少可用时间范围");
  const sequence = await input.directory.sequence(sourceId);
  const selected = selectObservations(sequence, spec.time, sourceContext);
  const idMember = `${view.name}.${source.id_member}`;
  const selection =
    input.selection ?? (await rankObservations(input, selected, idMember, sourceContext));
  const picks = new Map<string, Promise<ExecutedViewResult>>();
  function load(occurrence?: Occurrence): Promise<ExecutedViewResult> {
    const key = occurrence?.id ?? "";
    const prior = picks.get(key);
    if (prior) return prior;
    const result = input.execute(
      {
        ...spec,
        time: { cutoff: occurrence?.date.slice(0, 7) ?? sourceContext.actualThrough },
        filters: [
          ...(spec.filters ?? []),
          occurrence
            ? { member: idMember, operator: "equals", values: [occurrence.id] }
            : { member: idMember, operator: "notSet" },
        ],
      },
      input.summary,
      Boolean(input.totals && selected.time),
      selection,
    );
    picks.set(key, result);
    return result;
  }
  // Keep concurrency bounded when a month series refers to many distinct observations.
  for (const { occurrence } of selected.periods) {
    if (occurrence) await load(occurrence);
  }
  const template = await load(selected.periods.find((period) => period.occurrence)?.occurrence);
  const timeColumns =
    selected.time?.grain === "month"
      ? ["year", "month"]
      : selected.time?.grain === "year"
        ? ["year"]
        : [];
  const extra = selected.trend ? TREND_COLUMNS : timeColumns;
  const splitAt = selected.trend
    ? 0
    : template.block.columns.findIndex(
        (column) => template.block.column_roles[column] === "measure",
      );
  const insert = <T>(fields: T[], items: T[]) => {
    const index = splitAt < 0 ? fields.length : splitAt;
    return [...fields.slice(0, index), ...items, ...fields.slice(index)];
  };
  const rows: typeof template.block.rows = [];
  const summaryRows: typeof rows = [];
  let summary = template.block.summary;
  let totalsTemplate = template.block;
  for (const [index, period] of selected.periods.entries()) {
    if (!period.occurrence) continue;
    const result = await load(period.occurrence);
    summary ??= result.block.summary;
    if (!totalsTemplate.totals && result.block.totals) totalsTemplate = result.block;
    if (result.block.has_more)
      throw new ResultLimitExceededError("单期观测结果超过交付上限", {
        limit: AGGREGATE_CARD_ROWS,
      });
    const key = selected.time?.buckets[index]?.key;
    const prefix = selected.trend
      ? [period.occurrence.id, period.occurrence.date]
      : key
        ? [String(key.year), ...(key.month === undefined ? [] : [String(key.month)])]
        : [];
    rows.push(...result.block.rows.map((row) => insert(row, prefix)));
    summaryRows.push(...(result.block.summary?.rows ?? []).map((row) => insert(row, prefix)));
  }
  if (rows.length > AGGREGATE_CARD_ROWS) {
    throw new ResultLimitExceededError("调研结果超过交付上限", {
      limit: AGGREGATE_CARD_ROWS,
      row_count: rows.length,
    });
  }
  const {
    time: _actualTime,
    summary: _actualSummary,
    totals: _actualTotals,
    ...block
  } = template.block;
  const totals =
    input.totals && selected.time
      ? await requestedTotals(totalsTemplate, selected, load)
      : undefined;
  const sourceSemantics =
    selected.business && template.sourceSemantics
      ? {
          time: selected.business,
          columns: new Map<string, SourceColumnSemantics>([
            ...template.sourceSemantics.columns,
            ...timeColumns.map(
              (column) =>
                [
                  column,
                  {
                    member: column,
                    alias: `time.${column}`,
                    kind: "time",
                    valueType: "string",
                  },
                ] as const,
            ),
          ]),
        }
      : template.sourceSemantics;
  const output: ExecutedViewResult["block"] = {
    ...block,
    columns: insert(block.columns, extra),
    column_roles: {
      ...block.column_roles,
      ...Object.fromEntries(extra.map((column) => [column, selected.trend ? "dimension" : "time"])),
    },
    observations: selected.periods,
    ...(selected.trend
      ? {
          observation_axis: {
            id_column: TREND_COLUMNS[0],
            date_column: TREND_COLUMNS[1],
          },
        }
      : {}),
    ...(totals ? { totals } : {}),
    ...(selected.time ? { time: selected.time } : {}),
    ...(summary && summaryRows.length ? { summary: { ...summary, rows: summaryRows } } : {}),
    rows,
    row_count: rows.length,
    has_more: false,
    query_notes: [
      ...block.query_notes,
      ...extra.flatMap((member, index) =>
        selected.trend
          ? [{ member, title: index === 0 ? "调研期次" : "观测日期", text: "按实际观测期次排序" }]
          : [],
      ),
    ],
  };
  const groupSelection = selection ?? template.groupSelection;
  return {
    block: groupSelection
      ? orderSelectedGroups(output, groupSelection)
      : orderResultRows(output, spec.order),
    sampleForModel: true,
    resolvedDeliveryColumns: Object.fromEntries(extra.map((column) => [column, column])),
    ...(sourceSemantics ? { sourceSemantics } : {}),
    ...(groupSelection ? { groupSelection } : {}),
  };
}

async function rankObservations(
  input: ExecutionInput,
  selected: SelectedObservations,
  idMember: string,
  sourceContext: TimeContext["sources"][string],
): Promise<BoundGroupSelection | undefined> {
  const spec = input.spec;
  const selection = spec.selection;
  if (!selection || selected.periods.length < 2) return undefined;
  const byName = selection.dimensions.includes(selection.by);
  const periods = selected.periods.flatMap(({ occurrence }) => (occurrence ? [occurrence] : []));
  const primaryEnd = selected.time?.coordinates[0]?.to;
  const anchor = primaryEnd
    ? selected.periods.findLast((period) => period.requested?.to === primaryEnd)?.occurrence
    : periods.at(-1);
  const candidates = byName ? periods : anchor ? [anchor] : [];
  if (!candidates.length) return bindSelectedGroups(selection, [], false);
  const months = candidates.map(({ date }) => date.slice(0, 7)).sort();
  const ranking = await input.execute(
    {
      ...spec,
      dimensions: selection.dimensions,
      measures: byName ? undefined : [selection.by],
      grouping_sets: undefined,
      time: byName
        ? { range: { from: months[0], to: months.at(-1)! }, grain: "total" }
        : { cutoff: months[0] ?? sourceContext.actualThrough },
      filters: [
        ...(spec.filters ?? []),
        {
          member: idMember,
          operator: "equals",
          values: [...new Set(candidates.map(({ id }) => id))],
        },
      ],
    },
    false,
    false,
  );
  if (!ranking.groupSelection) throw new Error("调研查询未能解析 Top-N 分组");
  return ranking.groupSelection;
}

async function requestedTotals(
  template: ExecutedViewResult["block"],
  selected: SelectedObservations,
  load: (occurrence?: Occurrence) => Promise<ExecutedViewResult>,
): Promise<ExecutedViewResult["block"]["totals"]> {
  const coordinates = selected.time?.coordinates;
  if (!coordinates || !template.totals?.metrics.length) return undefined;
  const endpoints = await Promise.all(
    coordinates.map(async ({ to }) => {
      const occurrence = selected.periods.findLast(
        (period) => period.requested?.to === to,
      )?.occurrence;
      return occurrence ? (await load(occurrence)).block.totals : undefined;
    }),
  );
  return {
    metrics: template.totals.metrics.map(({ column }) => ({
      column,
      periods: coordinates.map((coordinate, index) => {
        const basis = template.column_time_basis?.[column] ?? "whole_bucket";
        const original = endpoints[index]?.metrics.find((metric) => metric.column === column)
          ?.periods[0];
        return { ...basisPeriod(basis, coordinate), value: original?.value ?? null };
      }),
    })),
  };
}
