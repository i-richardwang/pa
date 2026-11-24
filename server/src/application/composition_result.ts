import type { EngineViewBlock } from "../engine/transform.js";
import { AGGREGATE_CARD_ROWS, ResultLimitExceededError } from "../engine/result_limit.js";
import type { CompositionExecution } from "../semantic_core/execution_plan.js";
import { basisPeriod } from "../semantic_core/metric_value_basis.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { observationSummary, type CompositionPeriod } from "../semantic_core/query_payload.js";
import { windowSummary } from "../presentation_core/view_format.js";

type Cell = EngineViewBlock["rows"][number][number];

function checkLimit(rows: number, hasMore = false): void {
  if (hasMore || rows > AGGREGATE_CARD_ROWS) {
    throw new ResultLimitExceededError(`组合表超过 ${AGGREGATE_CARD_ROWS} 行；请缩小筛选范围`, {
      limit: AGGREGATE_CARD_ROWS,
      row_count: rows,
    });
  }
}

export function composeColumnResults(
  id: string,
  spec: CompositionExecution,
  results: ReadonlyMap<string, EngineViewBlock>,
): EngineViewBlock {
  const { group, baseline } = spec;
  const columnTitles = new Set<string>();
  const groupColumns = [group.id, ...(group.label ? [group.label.id] : [])];
  const columns = [...groupColumns, ...spec.columns.map((column) => column.id)];
  const cellsByColumn = new Map<string, Map<string, Cell>>();
  const labelsByEntity = new Map<string, Cell>();
  const columnPeriods: NonNullable<EngineViewBlock["column_periods"]> = {};
  const columnFormats: NonNullable<EngineViewBlock["column_formats"]> = {};
  const columnDecimals: NonNullable<EngineViewBlock["column_decimals"]> = {};
  const notes = groupColumns.map((member, index) => ({
    member,
    title: index === 0 ? group.title : (group.label?.title ?? group.title),
    text: index === 0 ? "组合表按稳定标识对齐" : "名称取行基准或最先提供此实体的来源",
  }));

  function sourceBlock(id: string): EngineViewBlock {
    const block = results.get(id);
    if (!block) throw new Error(`组合表缺少查询结果 ${id}`);
    return block;
  }

  let missingKeys = 0;
  for (const column of spec.columns) {
    const source = column.source && sourceBlock(column.source.query);
    const labels = column.source?.labels ? sourceBlock(column.source.labels) : undefined;
    const observation = source?.observations?.[0];
    const window = column.time.window;
    const fixedPeriod =
      window.kind === "range"
        ? { from: window.from, to: window.to }
        : window.kind === "current_month" && window.month
          ? { from: window.month, to: window.month }
          : undefined;
    const requested = observation?.requested ?? source?.time?.buckets[0] ?? fixedPeriod;
    const period: CompositionPeriod = {
      metric_id: column.member,
      status: source ? "available" : "unsupported_grain",
      ...(requested ? { requested: { from: requested.from, to: requested.to } } : {}),
      ...(observation ? { observation } : {}),
    };
    const entries = new Map<string, Cell>();
    cellsByColumn.set(column.id, entries);
    let text = "指标按该列声明的期间计算";
    if (source) {
      checkLimit(source.row_count, source.has_more);
      const shortKey = group.id.split(":")[1];
      const keyIndex = source.columns.findIndex((name) => memberShortName(name) === shortKey);
      const labelByKey = labels
        ? entityLabels(labels, shortKey, group.label?.id.split(":")[1])
        : undefined;
      const valueIndex = source.columns.findIndex(
        (name) => source.column_roles[name] === "measure",
      );
      if (keyIndex < 0 || valueIndex < 0) throw new Error("组合表来源缺少实体键或正式指标结果");
      const valueColumn = source.columns[valueIndex];
      const basis = source.column_time_basis?.[valueColumn];
      if (basis && period.requested && !observation)
        period.actual = basisPeriod(basis, period.requested);
      const format = source.column_formats?.[valueColumn];
      const decimals = source.column_decimals?.[valueColumn];
      if (format) columnFormats[column.id] = format;
      if (decimals !== undefined) columnDecimals[column.id] = decimals;
      for (const row of source.rows) {
        const key = row[keyIndex];
        if (key === null || String(key).trim() === "") {
          missingKeys += 1;
          continue;
        }
        const stableKey = String(key);
        if (entries.has(stableKey)) throw new Error(`组合表列「${column.title}」存在重复实体键`);
        entries.set(stableKey, row[valueIndex]);
        const name = labelByKey?.get(stableKey);
        if (name != null && (baseline === column.id || !labelsByEntity.has(stableKey))) {
          labelsByEntity.set(stableKey, name);
        }
      }
      text =
        source.query_notes.find(
          (note) => memberShortName(note.member) === memberShortName(valueColumn),
        )?.text ?? text;
    } else {
      text = "此指标不支持所选实体粒度，单元格留空";
    }
    columnPeriods[column.id] = period;
    const title = compositionTitle(column.title, period, windowSummary(column.time));
    const uniqueTitle = columnTitles.has(title) ? `${title} [${column.id}]` : title;
    columnTitles.add(title);
    notes.push({ member: column.id, title: uniqueTitle, text });
  }

  const baselineEntries = baseline ? cellsByColumn.get(baseline) : undefined;
  const keys = baselineEntries
    ? [...baselineEntries.keys()]
    : [...new Set([...cellsByColumn.values()].flatMap((entries) => [...entries.keys()]))];
  checkLimit(keys.length);
  const rows = keys.map((key) => [
    key,
    ...(group.label ? [labelsByEntity.get(key) ?? null] : []),
    ...spec.columns.map((column) => cellsByColumn.get(column.id)?.get(key) ?? null),
  ]);
  if (missingKeys)
    notes.push({
      member: "notice:missing_entity",
      title: "缺少实体标识",
      text: `${missingKeys} 条指标来源分组缺少稳定实体标识，无法对齐`,
    });
  return {
    id,
    columns,
    column_roles: Object.fromEntries(
      columns.map((column) => [column, groupColumns.includes(column) ? "dimension" : "measure"]),
    ),
    column_formats: columnFormats,
    column_decimals: columnDecimals,
    column_periods: columnPeriods,
    rows,
    row_count: rows.length,
    has_more: false,
    query_notes: notes,
  };
}

function entityLabels(block: EngineViewBlock, key: string, label?: string): Map<string, Cell> {
  checkLimit(block.row_count, block.has_more);
  const index = (member: string | undefined) =>
    block.columns.findIndex((column) => memberShortName(column) === member);
  const keyIndex = index(key);
  const labelIndex = index(label);
  if (keyIndex < 0 || labelIndex < 0) throw new Error("组合表名称来源缺少实体键或名称");
  const yearIndex = index("year");
  const monthIndex = index("month");
  const chosen = new Map<string, { month: number; label: Cell }>();
  for (const row of block.rows) {
    const key = row[keyIndex];
    const label = row[labelIndex];
    if (key == null || label == null) continue;
    const month = Number(row[yearIndex] ?? 0) * 12 + Number(row[monthIndex] ?? 0);
    const prior = chosen.get(String(key));
    if (
      !prior ||
      prior.month < month ||
      (prior.month === month && String(label).localeCompare(String(prior.label)) < 0)
    ) {
      chosen.set(String(key), { month, label });
    }
  }
  return new Map([...chosen].map(([key, { label }]) => [key, label]));
}

function compositionTitle(title: string, time: CompositionPeriod, requestedWindow: string): string {
  const period = (range: { from: string; to: string }) =>
    range.from === range.to ? range.from : `${range.from} 至 ${range.to}`;
  const requested = time.requested;
  const details = [
    time.observation
      ? observationSummary(time.observation)
      : requested
        ? period(requested)
        : requestedWindow,
    time.actual && requested && period(time.actual) !== period(requested)
      ? `求值 ${period(time.actual)}`
      : undefined,
    time.status === "unsupported_grain" ? "此粒度不可用" : undefined,
  ].filter(Boolean);
  return details.length ? `${title}（${details.join("；")}）` : title;
}
