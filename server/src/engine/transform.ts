/**
 * 派生视图：对同一次调用已查得的完整聚合行做 join、逐行标量算式、排序与限行；
 * 不引入新的时间或人群口径，不做跨行聚合或透视。
 *
 * - 两侧 join 键必须各自唯一。left 保留左侧行；inner 只保留两侧都命中的行；
 *   full 保留两侧全部行，并用已有一侧的值补上缺失一侧的 join 键列。未命中的度量为 null，不填 0。
 * - join 键中的 null 作为普通值参与对齐：整组键都相同才合并。
 *   算式任一操作数为 null、除数为 0 或结果不是有限数时，结果为 null。
 * - 任一输入 has_more=true 即拒绝；调用方需传入未截断的完整行。
 * - 派生列不能与目录中标准指标的标题同名；正式指标只在模型层定义。
 * - join 键只能是同源维度、同名维度或同类时间列；算式只能引用度量。
 * - 不同业务时间的度量只有属于同一标准度量且时间可比时才能参与算术；求值基准不同时拒绝。
 * - 输出列顺序和列名由 columns 决定；直接引用的列可用 as 改名，格式和说明沿用来源列。
 * - 任一派生规格或计算失败，整次查询报错。
 */
import type { ViewBlock, QueryNote } from "../semantic_core/query_payload.js";
import {
  derivedColumnName,
  type ColumnOperand,
  type DerivedViewSpec,
  type ExprNode,
  type LiteralOperand,
} from "../semantic_core/analysis_spec.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { compareCells } from "../presentation_core/view_format.js";
import type { BusinessTimeResolution } from "./time_plan.js";
import { basisLabel, type MetricValueBasis } from "../semantic_core/metric_value_basis.js";
import { physicalForm } from "./metric_time.js";

type Cell = string | number | null;
type ExpressionColumn = Extract<DerivedViewSpec["columns"][number], { expr: ExprNode }>;
type Row = Cell[];
type RowContext = Map<string, Row | null>;

/** 执行器内部结果：derived.formula 需先与来源的 provenance 合并，不能直接返回给调用方。 */
export type EngineViewBlock = Omit<ViewBlock, "provenance"> & {
  derived?: { formula: string };
};

export type SourceColumnSemantics = {
  member: string;
  alias: string;
  kind: "measure" | "dimension" | "time";
  valueType: string;
  semanticId?: string;
  timeBasis?: MetricValueBasis;
};

export type DerivedSourceSemantics = {
  columns: ReadonlyMap<string, SourceColumnSemantics>;
  time: BusinessTimeResolution;
};

const OP_LABEL: Record<ExprNode["op"], string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

function sourceLabel(view: EngineViewBlock): string {
  const title = view.view_title?.trim();
  if (!title) throw new Error("派生结果的来源查询缺少业务标题");
  return title;
}

function noteForColumn(notes: QueryNote[] | undefined, column: string): QueryNote | undefined {
  return notes?.find((note) => note.member === column || memberShortName(note.member) === column);
}

function columnTitle(
  source: string,
  column: string,
  sources: ReadonlyMap<string, EngineViewBlock>,
): string {
  const view = sources.get(source);
  if (!view) return column;
  return noteForColumn(view.query_notes, column)?.title ?? column;
}

function assertSource(
  source: string,
  sources: ReadonlyMap<string, EngineViewBlock>,
  derivedTitle: string,
): EngineViewBlock {
  const view = sources.get(source);
  if (!view) {
    throw new Error(`派生视图「${derivedTitle}」引用的查询视图 ${source} 没有可用结果`);
  }
  return view;
}

function columnIndex(
  source: string,
  column: string,
  sources: ReadonlyMap<string, EngineViewBlock>,
  derivedTitle: string,
): number {
  const view = assertSource(source, sources, derivedTitle);
  const index = view.columns.indexOf(column);
  if (index < 0) {
    throw new Error(
      `派生视图「${derivedTitle}」引用了来源「${sourceLabel(view)}」中不存在的列` +
        `「${column}」；请使用该输入视图实际返回的 columns`,
    );
  }
  return index;
}

function cellOf(
  operand: ColumnOperand,
  row: RowContext,
  sources: ReadonlyMap<string, EngineViewBlock>,
  derivedTitle: string,
): Cell {
  const index = columnIndex(operand.source, operand.col, sources, derivedTitle);
  return row.get(operand.source)?.[index] ?? null;
}

function numeric(value: Cell, label: string): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else if (value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`派生算式的操作数「${label}」不是数值；请改用数值度量列`);
}

function evaluate(
  node: ExprNode | ColumnOperand | LiteralOperand,
  row: RowContext,
  sources: ReadonlyMap<string, EngineViewBlock>,
  derivedTitle: string,
): number | null {
  if ("lit" in node) return node.lit;
  if ("col" in node) {
    return numeric(
      cellOf(node, row, sources, derivedTitle),
      `${columnTitle(node.source, node.col, sources)}(${sourceLabel(assertSource(node.source, sources, derivedTitle))})`,
    );
  }
  const left = evaluate(node.left, row, sources, derivedTitle);
  const right = evaluate(node.right, row, sources, derivedTitle);
  if (left === null || right === null || (node.op === "/" && right === 0)) return null;
  const value =
    node.op === "+"
      ? left + right
      : node.op === "-"
        ? left - right
        : node.op === "*"
          ? left * right
          : left / right;
  return Number.isFinite(value) ? value : null;
}

function expressionColumns(node: ExprNode | ColumnOperand | LiteralOperand): ColumnOperand[] {
  if ("lit" in node) return [];
  if ("col" in node) return [node];
  return [...expressionColumns(node.left), ...expressionColumns(node.right)];
}

function assertSourceSemantics(
  source: string,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
  derivedTitle: string,
): DerivedSourceSemantics {
  const resolved = semantics.get(source);
  if (!resolved) {
    throw new Error(`派生视图「${derivedTitle}」缺少输入视图 ${source} 的列语义解析结果`);
  }
  return resolved;
}

function resolvedColumn(
  source: string,
  column: string,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
  derivedTitle: string,
): SourceColumnSemantics {
  const resolved = assertSourceSemantics(source, semantics, derivedTitle).columns.get(column);
  if (!resolved) {
    throw new Error(`派生视图「${derivedTitle}」无法解析输入视图 ${source} 的列「${column}」`);
  }
  return resolved;
}

function assertJoinSemantics(
  spec: DerivedViewSpec,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
): void {
  if (spec.from.length !== 2 || !spec.join) return;
  const [leftSource, rightSource] = spec.from;
  for (const binding of spec.join.on) {
    const left = resolvedColumn(leftSource, binding.left, semantics, spec.view_title);
    const right = resolvedColumn(rightSource, binding.right, semantics, spec.view_title);
    if (left.kind === "time" && right.kind === "time" && left.alias === right.alias) continue;
    if (
      left.kind === "dimension" &&
      right.kind === "dimension" &&
      left.valueType === right.valueType &&
      (left.alias === right.alias ||
        (left.semanticId !== undefined && left.semanticId === right.semanticId))
    ) {
      continue;
    }
    throw new Error(
      `派生视图「${spec.view_title}」的 join 列「${binding.left} / ${binding.right}」在两侧不是同一个一致性维度；` +
        "跨视图 join 只允许底层同源维度、规范同名维度或系统生成的同类时间列",
    );
  }
}

const monthNumber = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month;
};
const rangeMonths = (from: string, to: string) => monthNumber(to) - monthNumber(from) + 1;

/** 期末值和年初至今指标都在时间桶的末月求值。 */
function bucketEndpoints(time: BusinessTimeResolution): string[] {
  return time.coordinates.flatMap((coordinate) => coordinate.buckets.map((bucket) => bucket.to));
}

/** 区间指标按整段期间求值；截止月份坐标的 from 与 to 都是该月。 */
function intervalRanges(time: BusinessTimeResolution): { from: string; to: string }[] {
  return time.coordinates.map(({ from, to }) => ({ from, to }));
}

function exactMetricTime(
  left: DerivedSourceSemantics,
  right: DerivedSourceSemantics,
  basis: MetricValueBasis,
): boolean {
  if (left.time.outputGrain !== right.time.outputGrain) return false;
  if (physicalForm(basis) === "interval") {
    return JSON.stringify(intervalRanges(left.time)) === JSON.stringify(intervalRanges(right.time));
  }
  return JSON.stringify(bucketEndpoints(left.time)) === JSON.stringify(bucketEndpoints(right.time));
}

function comparableMetricTime(
  left: DerivedSourceSemantics,
  right: DerivedSourceSemantics,
  basis: MetricValueBasis,
): boolean {
  if (left.time.outputGrain !== right.time.outputGrain) return false;
  switch (basis) {
    case "bucket_end": {
      const a = bucketEndpoints(left.time);
      const b = bucketEndpoints(right.time);
      if (a.length !== b.length || a.length === 0) return false;
      if (left.time.outputGrain === "total") return a.length === 1;
      const shifts = a.map((value, index) => monthNumber(value) - monthNumber(b[index]));
      return shifts.every((shift) => shift === shifts[0]);
    }
    case "whole_bucket": {
      const leftRanges = intervalRanges(left.time);
      const rightRanges = intervalRanges(right.time);
      return (
        leftRanges.length === rightRanges.length &&
        leftRanges.every(
          (range, index) =>
            rangeMonths(range.from, range.to) ===
            rangeMonths(rightRanges[index].from, rightRanges[index].to),
        )
      );
    }
    case "year_start_to_bucket_end": {
      const leftCutoffs = bucketEndpoints(left.time);
      const rightCutoffs = bucketEndpoints(right.time);
      if (leftCutoffs.length !== rightCutoffs.length || !leftCutoffs.length) return false;
      return leftCutoffs.every((leftCutoff, index) => {
        const [leftYear, leftMonth] = leftCutoff.split("-").map(Number);
        const [rightYear, rightMonth] = rightCutoffs[index].split("-").map(Number);
        return (
          (leftYear === rightYear && leftMonth !== rightMonth) ||
          (leftYear !== rightYear && leftMonth === rightMonth)
        );
      });
    }
  }
}

function zhMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return `${year}年${month}月`;
}

function businessTimeLabel(time: BusinessTimeResolution, basis: MetricValueBasis): string {
  switch (basis) {
    case "bucket_end": {
      const points = bucketEndpoints(time);
      if (points.length === 1) return `${zhMonth(points[0])}月末时点`;
      if (time.outputGrain === "year") {
        return points.map((point) => `${zhMonth(point)}月末时点`).join("、");
      }
      return `${zhMonth(points[0])}至${zhMonth(points[points.length - 1])}逐月月末时点`;
    }
    case "whole_bucket":
      return intervalRanges(time)
        .map(({ from, to }) =>
          from === to ? `${zhMonth(from)}当月` : `${zhMonth(from)}至${zhMonth(to)}期间`,
        )
        .join("、");
    case "year_start_to_bucket_end":
      return bucketEndpoints(time)
        .map((cutoff) => {
          const [year, month] = cutoff.split("-").map(Number);
          return `${year}年1月至${month}月（YTD）`;
        })
        .join("、");
  }
}

function assertExpressionSemantics(
  expr: ExprNode,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
  derivedTitle: string,
): string[] {
  const operands = expressionColumns(expr).map((operand) => {
    const column = resolvedColumn(operand.source, operand.col, semantics, derivedTitle);
    if (column.kind !== "measure" || !column.timeBasis) {
      throw new Error(
        `派生视图「${derivedTitle}」的算式操作数「${operand.col}」不是标准度量；` +
          "算式只能引用 measure 或数值 literal，数值维度不能参与指标算术",
      );
    }
    return {
      operand,
      column,
      basis: column.timeBasis,
      source: assertSourceSemantics(operand.source, semantics, derivedTitle),
    };
  });
  const comparisons: string[] = [];
  for (let i = 0; i < operands.length; i++) {
    for (let j = i + 1; j < operands.length; j++) {
      const left = operands[i];
      const right = operands[j];
      if (left.basis !== right.basis) {
        throw new Error(
          `派生视图「${derivedTitle}」的算式混用了${basisLabel(left.basis)}与${basisLabel(right.basis)}；` +
            "不同求值基准之间的新计算应在模型层定义",
        );
      }
      const basis = left.basis;
      if (exactMetricTime(left.source, right.source, basis)) continue;
      if (left.column.alias !== right.column.alias) {
        throw new Error(
          `派生视图「${derivedTitle}」的跨期算式混用了不同标准度量 ${left.column.alias} 与 ${right.column.alias}；` +
            "跨期算术只允许同一标准度量，不同指标之间的新计算应在模型层定义",
        );
      }
      if (comparableMetricTime(left.source, right.source, basis)) {
        comparisons.push(
          `${businessTimeLabel(left.source.time, basis)} 对比 ${businessTimeLabel(right.source.time, basis)}`,
        );
        continue;
      }
      throw new Error(
        `派生视图「${derivedTitle}」的算式操作数时间不可比；` +
          "跨期算术只允许同一标准度量的时点差、同长期间流量或同截止月/同年跨截止月累计值，其他计算应在模型层定义",
      );
    }
  }
  return [...new Set(comparisons)];
}

function renderOperand(
  node: ExprNode | ColumnOperand | LiteralOperand,
  sources: ReadonlyMap<string, EngineViewBlock>,
  parent: boolean,
): string {
  if ("lit" in node) return String(node.lit);
  if ("col" in node) {
    const view = sources.get(node.source);
    const label = view ? sourceLabel(view) : "未知来源";
    return `${columnTitle(node.source, node.col, sources)}(${label})`;
  }
  const rendered = `${renderOperand(node.left, sources, true)} ${OP_LABEL[node.op]} ${renderOperand(node.right, sources, true)}`;
  return parent ? `(${rendered})` : rendered;
}

function renderExpressionFormula(
  expr: ExprNode,
  sources: ReadonlyMap<string, EngineViewBlock>,
): string {
  return renderOperand(expr, sources, false);
}

function joinKey(row: Row, indices: number[]): string {
  return JSON.stringify(
    indices.map((index) => {
      const value = row[index] ?? null;
      return [value === null ? "null" : typeof value, value];
    }),
  );
}

function uniqueRowsByKey(
  source: string,
  view: EngineViewBlock,
  on: string[],
  derivedTitle: string,
): Map<string, Row> {
  const indices = on.map((column) =>
    columnIndex(source, column, new Map([[source, view]]), derivedTitle),
  );
  const rows = new Map<string, Row>();
  for (const row of view.rows) {
    const key = joinKey(row, indices);
    if (rows.has(key)) {
      throw new Error(
        `派生视图「${derivedTitle}」的输入来源「${sourceLabel(view)}」在 join 键 ` +
          `${on.join(" + ")} 上出现重复值；请让查询按这些维度唯一分组后再做变换`,
      );
    }
    rows.set(key, row);
  }
  return rows;
}

function rowContexts(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
): RowContext[] {
  const firstSource = spec.from[0];
  const first = assertSource(firstSource, sources, spec.view_title);
  if (spec.from.length === 1) {
    return first.rows.map((row) => new Map([[firstSource, row]]));
  }
  const secondSource = spec.from[1];
  const second = assertSource(secondSource, sources, spec.view_title);
  const join = spec.join;
  if (!join) throw new Error(`派生视图「${spec.view_title}」缺少 join 声明`);
  const firstByKey = uniqueRowsByKey(
    firstSource,
    first,
    join.on.map((binding) => binding.left),
    spec.view_title,
  );
  const secondByKey = uniqueRowsByKey(
    secondSource,
    second,
    join.on.map((binding) => binding.right),
    spec.view_title,
  );
  const firstJoinIndices = join.on.map((binding) =>
    columnIndex(firstSource, binding.left, sources, spec.view_title),
  );
  const secondJoinIndices = join.on.map((binding) =>
    columnIndex(secondSource, binding.right, sources, spec.view_title),
  );
  const missingRow = (
    target: EngineViewBlock,
    targetIndices: number[],
    present: Row,
    presentIndices: number[],
  ): Row => {
    const row: Row = Array.from({ length: target.columns.length }, () => null);
    targetIndices.forEach((targetIndex, index) => {
      row[targetIndex] = present[presentIndices[index]] ?? null;
    });
    return row;
  };
  const contexts: RowContext[] = [];
  for (const [key, left] of firstByKey) {
    const right = secondByKey.get(key) ?? null;
    if (!right && join.how === "inner") continue;
    contexts.push(
      new Map([
        [firstSource, left],
        [
          secondSource,
          right ??
            (join.how === "full"
              ? missingRow(second, secondJoinIndices, left, firstJoinIndices)
              : null),
        ],
      ]),
    );
  }
  if (join.how === "full") {
    for (const [key, right] of secondByKey) {
      if (firstByKey.has(key)) continue;
      contexts.push(
        new Map([
          [firstSource, missingRow(first, firstJoinIndices, right, secondJoinIndices)],
          [secondSource, right],
        ]),
      );
    }
  }
  return contexts;
}

function hasNullJoinKey(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
): boolean {
  if (spec.from.length !== 2 || !spec.join) return false;
  return spec.from.some((source, sourceIndex) => {
    const view = assertSource(source, sources, spec.view_title);
    const columns = spec.join!.on.map((binding) =>
      sourceIndex === 0 ? binding.left : binding.right,
    );
    const indices = columns.map((column) => columnIndex(source, column, sources, spec.view_title));
    return view.rows.some((row) => indices.some((index) => row[index] == null));
  });
}

function nullJoinNote(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
): QueryNote | undefined {
  if (!hasNullJoinKey(spec, sources)) return undefined;
  return {
    member: "join_key_nulls",
    title: "组合维度空值",
    text: "组合维度中的空值按空值参与对齐；只有其余组合维度也一致时才合并。",
  };
}

function carriedNote(
  source: string,
  column: string,
  output: string,
  sources: ReadonlyMap<string, EngineViewBlock>,
  kind: "query_notes" | "display_notes",
): QueryNote | undefined {
  const note = noteForColumn(sources.get(source)?.[kind], column);
  if (!note) return undefined;
  return output === column
    ? { ...note, member: column }
    : { ...note, member: output, title: output };
}

function appendColumnNote(
  note: QueryNote | undefined,
  member: string,
  title: string,
  extra: string | undefined,
): QueryNote | undefined {
  if (!extra) return note;
  return {
    member,
    title: note?.title ?? title,
    text: note?.text ? `${note.text}（${extra}）` : extra,
  };
}

function carriedTimeNote(
  spec: DerivedViewSpec,
  source: string,
  column: string,
  sources: ReadonlyMap<string, EngineViewBlock>,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
): string | undefined {
  if (spec.from.length !== 2) return undefined;
  const resolved = resolvedColumn(source, column, semantics, spec.view_title);
  if (resolved.kind !== "measure" || !resolved.timeBasis) return undefined;
  const current = assertSourceSemantics(source, semantics, spec.view_title);
  const otherId = spec.from.find((candidate) => candidate !== source)!;
  const other = assertSourceSemantics(otherId, semantics, spec.view_title);
  if (JSON.stringify(current.time) === JSON.stringify(other.time)) return undefined;
  const label = sourceLabel(assertSource(source, sources, spec.view_title));
  return `来源 ${label}；业务期间 ${businessTimeLabel(current.time, resolved.timeBasis)}`;
}

function uniqueNotes(notes: (QueryNote | undefined)[]): QueryNote[] {
  const seen = new Set<string>();
  return notes.flatMap((note) => {
    if (!note) return [];
    const key = `${note.member}|${note.text}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [note];
  });
}

const INHERITED_POLICY_NOTES = new Set(["access_scope", "sensitivity"]);

function inheritedPolicyNotes(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
  kind: "query_notes" | "display_notes",
): QueryNote[] {
  return spec.from.flatMap(
    (source) =>
      sources.get(source)?.[kind]?.filter((note) => INHERITED_POLICY_NOTES.has(note.member)) ?? [],
  );
}

function formulaSummary(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
): string {
  const expressions = spec.columns.flatMap((column) =>
    "expr" in column ? [`${column.as} = ${renderExpressionFormula(column.expr, sources)}`] : [],
  );
  if (expressions.length) return expressions.join("；");
  if (spec.from.length === 2 && spec.join) {
    const left = sourceLabel(assertSource(spec.from[0], sources, spec.view_title));
    const right = sourceLabel(assertSource(spec.from[1], sources, spec.view_title));
    const keys = spec.join.on
      .map((binding) =>
        binding.left === binding.right ? binding.left : `${binding.left} = ${binding.right}`,
      )
      .join(" + ");
    return `${left} ${spec.join.how} join ${right}（${keys}）`;
  }
  return `投影 ${sourceLabel(assertSource(spec.from[0], sources, spec.view_title))}`;
}

export function transformDerivedView(
  spec: DerivedViewSpec,
  sources: ReadonlyMap<string, EngineViewBlock>,
  standardMeasureTitles: ReadonlySet<string>,
  semantics: ReadonlyMap<string, DerivedSourceSemantics>,
): EngineViewBlock {
  for (const source of spec.from) {
    const view = assertSource(source, sources, spec.view_title);
    sourceLabel(view);
    assertSourceSemantics(source, semantics, spec.view_title);
    if (view.has_more) {
      throw new Error(
        `派生视图「${spec.view_title}」的输入结果不完整，请收窄查询后再做变换` +
          `（来源「${sourceLabel(view)}」仍有更多行）`,
      );
    }
  }
  assertJoinSemantics(spec, semantics);
  const expressionComparisons = new Map<string, string[]>();
  for (const column of spec.columns) {
    const alias = column.as;
    if (alias && standardMeasureTitles.has(alias)) {
      throw new Error(
        `派生输出列「${alias}」与 catalog 标准指标同名；请改用带时间窗或差值/比值含义的明确名称`,
      );
    }
    const operands = "col" in column ? [column] : expressionColumns(column.expr);
    for (const operand of operands) {
      columnIndex(operand.source, operand.col, sources, spec.view_title);
      resolvedColumn(operand.source, operand.col, semantics, spec.view_title);
    }
    if ("expr" in column) {
      expressionComparisons.set(
        column.as,
        assertExpressionSemantics(column.expr, semantics, spec.view_title),
      );
    }
  }

  const columns = spec.columns.map(derivedColumnName);
  const formats = Object.fromEntries(
    spec.columns.flatMap((column) => {
      if ("expr" in column) return column.format ? [[column.as, column.format]] : [];
      const format = sources.get(column.source)?.column_formats?.[column.col];
      return format ? [[derivedColumnName(column), format]] : [];
    }),
  );
  const decimals = Object.fromEntries(
    spec.columns.flatMap((column) => {
      if ("expr" in column) return [];
      const value = sources.get(column.source)?.column_decimals?.[column.col];
      return value === undefined ? [] : [[derivedColumnName(column), value]];
    }),
  );
  let rows = rowContexts(spec, sources).map((context) =>
    spec.columns.map((column) =>
      "col" in column
        ? cellOf(column, context, sources, spec.view_title)
        : evaluate(column.expr, context, sources, spec.view_title),
    ),
  );
  if (spec.order?.length) {
    const indexed = rows.map((row, index) => ({ row, index }));
    indexed.sort((a, b) => {
      for (const order of spec.order ?? []) {
        const column = columns.indexOf(order.by);
        if (a.row[column] === null || b.row[column] === null) {
          const nullCompared = compareCells(a.row[column], b.row[column]);
          if (nullCompared) return nullCompared;
          continue;
        }
        const compared = compareCells(a.row[column], b.row[column]);
        if (compared) return order.direction === "asc" ? compared : -compared;
      }
      return a.index - b.index;
    });
    rows = indexed.map(({ row }) => row);
  }
  const hasMore = spec.limit !== undefined && rows.length > spec.limit;
  if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);

  const notesOf = (
    kind: "query_notes" | "display_notes",
    expressionNote: (column: ExpressionColumn, comparisons: string[]) => QueryNote | undefined,
  ) =>
    uniqueNotes([
      ...spec.columns.map((column) => {
        if ("col" in column) {
          const output = derivedColumnName(column);
          return appendColumnNote(
            carriedNote(column.source, column.col, output, sources, kind),
            output,
            output,
            carriedTimeNote(spec, column.source, column.col, sources, semantics),
          );
        }
        return expressionNote(column, expressionComparisons.get(column.as) ?? []);
      }),
      nullJoinNote(spec, sources),
      ...inheritedPolicyNotes(spec, sources, kind),
    ]);
  const queryNotes = notesOf("query_notes", (column, comparisons) => ({
    member: column.as,
    title: column.as,
    text:
      renderExpressionFormula(column.expr, sources) +
      (comparisons.length ? `（跨期比较：${comparisons.join("；")}）` : ""),
  }));
  const displayNotes = notesOf("display_notes", (column, comparisons) =>
    comparisons.length
      ? { member: column.as, title: column.as, text: `跨期比较：${comparisons.join("；")}。` }
      : undefined,
  );
  const columnRoles = Object.fromEntries(
    spec.columns.map((column) => [
      derivedColumnName(column),
      "col" in column
        ? resolvedColumn(column.source, column.col, semantics, spec.view_title).kind
        : ("measure" as const),
    ]),
  );

  // 算式列不带时间基准，它的期间由 provenance 表达。
  const columnTimeBasis = Object.fromEntries(
    spec.columns.flatMap((column) => {
      if (!("col" in column)) return [];
      const resolved = resolvedColumn(column.source, column.col, semantics, spec.view_title);
      return resolved.timeBasis ? [[derivedColumnName(column), resolved.timeBasis] as const] : [];
    }),
  );
  const block: EngineViewBlock = {
    id: spec.id,
    view_title: spec.view_title,
    derived: { formula: formulaSummary(spec, sources) },
    columns,
    ...(Object.keys(formats).length ? { column_formats: formats } : {}),
    ...(Object.keys(decimals).length ? { column_decimals: decimals } : {}),
    column_roles: columnRoles,
    ...(Object.keys(columnTimeBasis).length ? { column_time_basis: columnTimeBasis } : {}),
    rows,
    row_count: rows.length,
    has_more: hasMore,
    query_notes: queryNotes,
    ...(displayNotes.length ? { display_notes: displayNotes } : {}),
  };
  if (!spec.summary) return block;
  // 结果为空时不生成总体行。
  if (!rows.length) return block;

  const summarySources = new Map<string, EngineViewBlock>();
  for (const source of spec.from) {
    const sourceBlock = assertSource(source, sources, spec.view_title);
    if (!sourceBlock.summary) {
      throw new Error(`派生视图「${spec.view_title}」需要总体，但来源视图 ${source} 未交付总体行`);
    }
    const { summary: _summary, ...rest } = sourceBlock;
    summarySources.set(source, {
      ...rest,
      rows: sourceBlock.summary.rows,
      row_count: sourceBlock.summary.rows.length,
      has_more: false,
    });
  }
  const summaryBlock = transformDerivedView(
    { ...spec, order: undefined, limit: undefined, summary: undefined },
    summarySources,
    standardMeasureTitles,
    semantics,
  );
  if (!summaryBlock.rows.length) {
    throw new Error(`派生视图「${spec.view_title}」的总体行经派生公式后为空`);
  }
  const selected = [...summarySources.values()].some(
    (source) => source.selection_scope?.type === "top_n",
  );
  return {
    ...block,
    summary: {
      kind: "grand_total",
      label: selected ? "所选分组总体" : "总体",
      scope: selected ? "selected_groups" : "filtered_set",
      rows: summaryBlock.rows,
    },
  };
}
