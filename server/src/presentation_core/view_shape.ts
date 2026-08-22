/**
 * 结果结构分析与声明式呈现编译：时间表格按时间协议重排，业务交叉表与图表只编译显式声明。
 * 本层可以回答“数据是否支持这份声明”，不能替调用方决定采用什么图型。
 */
import {
  cellLabel,
  columnDecimals,
  columnFormat,
  isBlankCell,
  isRateColumn,
  isRateFormat,
  isTimeColumn,
  toNumber,
  monthRangeLabel,
} from "./view_format.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { PresentationType } from "../semantic_core/presentation_type.js";
import type { ColumnFormat, ViewBlock } from "../semantic_core/query_payload.js";
import {
  compileTableShading,
  type ShadingScale,
  shadingDataScale,
  type TableShading,
} from "./table_shading.js";
import type { RenderShape } from "./render_shape.js";
import type { ChartDecl, ChartRenderDecl, TableAxis, TableLayoutDecl } from "./chart_decl.js";

/** 感知极限：折线超出此系列数缠绕不可读，声明的折线编译失败并退回表格 */
export const MAX_LINE_SERIES = 5;

/** 感知极限：堆叠段超出此数不可辨，退回交叉表呈现 */
export const MAX_STACK_SERIES = 5;

/** 感知极限：柱线组合图中并排柱的系列数上限——时间点密集时分组柱超两组即糊，超出退长表 */
export const MAX_COMBO_BAR_SERIES = 2;

/** 阅读预算：固定高度分类柱线组合图的横轴分类上限，超出后标签与折线点过密，退回表格 */
export const MAX_CATEGORY_COMBO_CATEGORIES = 30;

/** 总览预算：条形图自然高度上限（px）——单指标排行 ~30 分类在限内，多指标并列 ~12 分类在限内 */
export const MAX_BAR_CHART_HEIGHT = 1000;

/** 感知极限：饼图切片超出此数不可辨（长尾切片沦为碎屑），退回表格呈现 */
export const MAX_PIE_SLICES = 12;

/** 浏览器渲染资源上限：属于防失控护栏，不是阅读偏好；超过时明确返回布局不可用。 */
export const MAX_TABLE_LEAF_COLUMNS = 240;

export function barChartHeight(categories: number, seriesCount: number): number {
  const rowHeight = seriesCount > 1 ? seriesCount * 20 + 16 : 32;
  return categories * rowHeight + (seriesCount > 1 ? 72 : 40);
}

type Cell = string | number | null;

export type SeriesDef = {
  key: string;
  name: string;
  /**
   * 度量来源列（载荷列短名）；分类值派生的系列（分组折线、堆叠段）无此字段。
   * 需要按字段绑定的消费方只认本字段，name 只作展示，避免展示名变化破坏报告呈现编译。
   */
  column?: string;
  format: ColumnFormat;
  /** 模型为该列声明的小数位；未声明则缺席，呈现层按格式取默认位数。 */
  decimals?: number;
  isRate: boolean;
  /** 趋势图专用：混量纲时绝对量系列画柱（量纲定标记），缺省画线；条形图不读此字段 */
  mark?: "bar";
  /** 条形图专用：本系列对应的结构占比值在 ChartRow 中的键。 */
  shareKey?: string;
  /**
   * 本系列所对照的那条系列的 `key`：同期叠加把各对照期都对到主期上。有它才谈得上差值，
   * 「谁减谁」是编排期就定下的事实，读数卡不去猜哪条是主期。
   */
  baselineKey?: string;
};
export type ChartRow = Record<string, Cell>;
export type ChartSourceRow = {
  row?: number;
  series?: Record<string, number>;
};

export type TrendSpec = {
  kind: "line";
  /** { t: 时间标签, s0: 值, … } 按时间升序 */
  rows: ChartRow[];
  sourceRows: ChartSourceRow[];
  series: SeriesDef[];
  /** 量与率并存 → 双 y 轴，量系列带 mark="bar"（柱线组合） */
  mixedAxes: boolean;
  /** 全为率指标 → 主轴按百分数标注 */
  allRate: boolean;
  /** 率轴的确切显示单位；百分比与百分点不能共用同一坐标轴。 */
  rateFormat: ColumnFormat;
};

export type BarSpec = {
  kind: "bar";
  /** { label: 分类值, s0: 值, …[, share: 该分类占比] } 保持查询返回顺序（排行由查询 order 决定） */
  rows: ChartRow[];
  sourceRows: ChartSourceRow[];
  series: SeriesDef[];
  /** 全系列共用的确切显示单位。 */
  format: ColumnFormat;
  /** 全系列同量纲，百分比或百分点时为 true。 */
  isRate: boolean;
  /** 双分类构成呈现：系列堆叠在同一条上（仅计数度量） */
  stacked: boolean;
  /** rows 带结构占比值时读数卡随附占比 */
  hasShare: boolean;
};

export type CategoryComboSpec = {
  kind: "category_combo";
  /** { label: 分类值, s0: 值, … } 保持查询返回顺序。 */
  rows: ChartRow[];
  sourceRows: ChartSourceRow[];
  series: SeriesDef[];
  countFormat: ColumnFormat;
  rateFormat: ColumnFormat;
};

/** 饼图（仅声明路径产出）：部分-整体构成，只接受可加计数度量（率不构成整体） */
export type PieSpec = {
  kind: "pie";
  /** { label: 切片分类值, value: 度量值 } 保持查询返回顺序 */
  rows: { label: string; value: number | null }[];
  sourceRows: ChartSourceRow[];
  /** 度量来源列（载荷列短名）；字段绑定消费方（报告呈现编译）只认本字段 */
  column: string;
  /** 切片分类来源列（载荷列短名） */
  categoryColumn: string;
  /** 度量展示名（读数条与读数卡的系列名） */
  seriesName: string;
  format: ColumnFormat;
  decimals?: number;
};

export type TableHeaderPart = {
  /** 稳定结构键；标题相同的不同成员不得因此被合并。 */
  key: string;
  label: string;
};

export type TableColumn = {
  label: string;
  /** 单元格格式化所依据的原始成员列名（交叉表值列共用度量列的语义） */
  formatKey: string;
  /** 显式呈现格式；percent 与 percentage_point 的底层值均为 0–1。 */
  format?: ColumnFormat;
  /** 模型声明的小数位；缺席按格式取默认。 */
  decimals?: number;
  numeric: boolean;
  /** 从外到内的完整表头路径；渲染层只从这里推导任意层级分带。 */
  headerPath: TableHeaderPart[];
};
export type TableModel = {
  columns: TableColumn[];
  rows: Cell[][];
  /** 与明细彻底分离的模型重算总体；不参与排序、截断与记录投影。 */
  summaryRows?: Cell[][];
  /**
   * 每格回指原始结果行下标（null=该格无来源行，如轴标签列与缺席格）。
   * 缺省即「模型行 = 原始行」的恒等映射（长表）；交叉表重排了行列，必须携带本映射，
   * 记录投影据此取回该格的业务坐标（时间与维度值），与图表规格的 sourceRows 同一语义。
   */
  sourceRows?: (number | null)[][];
  /** 热力着色（只随 table 声明下发）：刻度按指标列键各立一把，见 `table_shading.ts`。 */
  shading?: TableShading;
};

export type TableLayoutStatus =
  | {
      state: "applied";
      leafColumns: number;
    }
  | {
      state: "unavailable";
      leafColumns: number;
      reason: "duplicate_coordinate" | "resource_limit" | "missing_axis";
      message: string;
    };

export type TableCompilation = {
  table: TableModel;
  layout: TableLayoutStatus;
};

export type ChartSpec = TrendSpec | BarSpec | CategoryComboSpec | PieSpec;

export type Roles = {
  /** year/month 列（无论取值是否变化） */
  timeIdx: number[];
  /** 数值度量列 */
  measureIdx: number[];
  /** 取值 ≥2 的分类列 */
  catIdx: number[];
  /** 每行的时间键与标签；时间点 <2 时视为无时间轴 */
  timeOfRow: { key: number; label: string }[];
  timePoints: { key: number; label: string }[];
  /** 分类列取值（首现序） */
  valuesOf: Map<number, string[]>;
};

/** 声明为 time 的年 / 月列下标；无该列为 -1。时间列只按 column_roles 与标准短名认，不看取值。 */
function timeColumnIndex(view: ViewBlock, level: "year" | "month"): number {
  return view.columns.findIndex(
    (column) => view.column_roles[column] === "time" && memberShortName(column) === level,
  );
}

/** 成员显示名取服务端规范化后的口径注释 title；呈现层不根据列名猜测。 */
export function makeTitleOf(view: ViewBlock): (column: string) => string {
  const byKey = new Map(view.query_notes.map((n) => [memberShortName(n.member), n.title]));
  return (column) => byKey.get(memberShortName(column)) ?? memberShortName(column);
}

function timeLabel(year: Cell, month: Cell): { label: string; key: number } {
  const y = toNumber(year);
  const m = toNumber(month);
  if (y !== null && m !== null)
    return { label: `${y}-${String(m).padStart(2, "0")}`, key: y * 100 + m };
  if (y !== null) return { label: String(y), key: y * 100 };
  return { label: `${m}月`, key: m ?? 0 };
}

/**
 * 列角色判定只消费服务端完整声明的 column_roles，数值型维度不会被误判为指标。
 * 数值列的基础身份不因指标关系而改变：
 * structure_shares 只补充指标关系，默认字段绑定是否把占比作为辅助通道由 primaryMeasureIndices
 * 决定；显式绑定始终可引用它。分类轴仍要求取值 ≥2——取值唯一的维度列是回显的过滤条件；
 * 声明为 time 但改了名的列（派生视图搬运）当作分类标签轴。
 */
export function detectRoles(view: ViewBlock): Roles {
  const timeIdx: number[] = [];
  const measureIdx: number[] = [];
  const catIdx: number[] = [];
  const valuesOf = new Map<number, string[]>();

  view.columns.forEach((c, i) => {
    const declared = view.column_roles[c];
    if (declared === "time" && isTimeColumn(c)) {
      timeIdx.push(i);
      return;
    }
    if (declared === "measure") {
      measureIdx.push(i);
      return;
    }
    const values = [...new Set(view.rows.map((r) => cellLabel(r[i])))];
    if (values.length >= 2) {
      catIdx.push(i);
      valuesOf.set(i, values);
    }
  });

  const yearIdx = timeColumnIndex(view, "year");
  const monthIdx = timeColumnIndex(view, "month");
  const timeOfRow = timeIdx.length
    ? view.rows.map((r) =>
        timeLabel(yearIdx >= 0 ? r[yearIdx] : null, monthIdx >= 0 ? r[monthIdx] : null),
      )
    : [];
  const byKey = new Map(timeOfRow.map((t) => [t.key, t]));
  const timePoints = [...byKey.values()].sort((a, b) => a.key - b.key);

  return { timeIdx, measureIdx, catIdx, timeOfRow, timePoints, valuesOf };
}

/** 长表：查询结果原样铺开（度量天然成列，单分类 × 多度量本身就是二维表） */
function flatTable(view: ViewBlock, titleOf: (c: string) => string): TableModel {
  const columns = view.columns.map((c) => ({
    label: titleOf(c),
    formatKey: c,
    ...(view.column_formats?.[c] ? { format: view.column_formats[c] } : {}),
    ...(view.column_decimals?.[c] !== undefined ? { decimals: view.column_decimals[c] } : {}),
    numeric: view.column_roles[c] === "measure",
    headerPath: [{ key: `field:${c}`, label: titleOf(c) }],
  }));
  // 标签占用首个业务分组列；没有分组列可占时照样交付数字，绝不因为放不下标签而丢掉总体。
  const labelIdx = view.columns.findIndex((column) => view.column_roles[column] === "dimension");
  const summaryRows = view.summary?.rows.map((row) =>
    labelIdx >= 0
      ? row.map((cell, index) => (index === labelIdx ? view.summary!.label : cell))
      : row,
  );
  return {
    columns,
    rows: view.rows,
    ...(summaryRows?.length ? { summaryRows } : {}),
  };
}

/** 纯时间序列折线：度量各成一系列；同一时点出现多行说明数据不成序列，返回 null */
function timeSeriesLine(
  view: ViewBlock,
  roles: Roles,
  titleOf: (c: string) => string,
  measureIdx: number[] = roles.measureIdx,
): TrendSpec | null {
  if (measureIdx.length > MAX_LINE_SERIES) return null;
  if (new Set(roles.timeOfRow.map((t) => t.key)).size !== view.rows.length) return null;
  const series = measureIdx.map((colIdx, si) => ({
    key: `s${si}`,
    name: titleOf(view.columns[colIdx]),
    column: view.columns[colIdx],
    format: columnFormat(view.columns[colIdx], view.column_formats),
    ...declaredDecimals(view, colIdx),
    isRate: isRateColumn(view.columns[colIdx], view.column_formats),
  }));
  const byKey = new Map(
    view.rows.map((r, ri) => [
      roles.timeOfRow[ri].key,
      {
        values: Object.fromEntries(measureIdx.map((colIdx, si) => [`s${si}`, toNumber(r[colIdx])])),
        source: ri,
      },
    ]),
  );
  const rows = roles.timePoints.map((t) => {
    const source = byKey.get(t.key);
    return { t: t.label, ...source?.values };
  });
  const sourceRows = roles.timePoints.map((t) => ({ row: byKey.get(t.key)?.source }));
  return withAxes(rows, sourceRows, series);
}

type ResultTime = NonNullable<ViewBlock["time"]>;
type CoordinatePeriod = ResultTime["coordinates"][number] & { buckets: ResultTime["buckets"] };

/** 桶在结果行上的时间键；与 timeLabel 同一编码，故可直接与 roles.timeOfRow 对照。 */
const bucketKey = (bucket: ResultTime["buckets"][number]): number | null =>
  bucket.key ? bucket.key.year * 100 + (bucket.key.month ?? 0) : null;

function coordinatePeriods(time: ResultTime | undefined): CoordinatePeriod[] | null {
  if (!time) return null;
  const periods: CoordinatePeriod[] = time.coordinates.map((coordinate) => ({
    ...coordinate,
    buckets: [],
  }));
  for (const bucket of time.buckets) {
    const owners = periods.filter((period) => period.from <= bucket.from && bucket.to <= period.to);
    if (owners.length !== 1) return null;
    owners[0].buckets.push(bucket);
  }
  return periods;
}

/**
 * 期间叠加是否成立：多个期间、每段桶数相同且不止一个，且各对照段相对主段整体回移**整年**
 * （起止的月份部分相同、年份不同）。相邻周期对照不满足整年回移——它在连续时间轴上本来
 * 就画得对，不叠加；异长窗口（往年全年对今年至今）同样落在此判定之外。
 */
function overlayPeriods(time: ResultTime | undefined): CoordinatePeriod[] | null {
  const periods = coordinatePeriods(time);
  if (!periods || periods.length < 2) return null;
  const [primary, ...comparisons] = periods;
  if (primary.buckets.length < 2) return null;
  const alignedYearsApart = (period: CoordinatePeriod) =>
    period.buckets.length === primary.buckets.length &&
    period.from.slice(5) === primary.from.slice(5) &&
    period.to.slice(5) === primary.to.slice(5) &&
    period.from.slice(0, 4) !== primary.from.slice(0, 4);
  return comparisons.every(alignedYearsApart) ? periods : null;
}

/** 期间图例名：整年落在同一日历年时用年份，跨年窗口用完整起止。 */
function periodLabel(period: { from: string; to: string }): string {
  const year = (month: string) => Number(month.slice(0, 4));
  return year(period.from) === year(period.to)
    ? `${year(period.from)}年`
    : monthRangeLabel(period.from, period.to);
}

/**
 * 合计覆盖期间的写实读法。图例名可以粗（同年即写年份），这里不行：不能整窗合并的指标
 * 在终点求值，副标要如实说出它到底盖住了哪几个月，读者才不会把「年初至今」读成「全年」。
 */
function coverageLabel(period: { from: string; to: string }): string {
  const year = (month: string) => Number(month.slice(0, 4));
  const month = (value: string) => Number(value.slice(5, 7));
  if (period.from === period.to) return `${year(period.to)}年${month(period.to)}月`;
  if (year(period.from) !== year(period.to)) return periodLabel(period);
  return month(period.from) === 1 && month(period.to) === 12
    ? `${year(period.to)}年`
    : `${year(period.to)}年${month(period.from)}—${month(period.to)}月`;
}

function comparisonLine(
  view: ViewBlock,
  roles: Roles,
  valIdx: number,
  periods: CoordinatePeriod[],
): TrendSpec | null {
  if (periods.length > MAX_LINE_SERIES) return null;
  const format = columnFormat(view.columns[valIdx], view.column_formats);
  // periods[0] 是主期（桶序也由它铺开），其余各期都对照它读差值
  const series = periods.map((period, index) => ({
    key: `s${index}`,
    name: periodLabel(period),
    column: view.columns[valIdx],
    format,
    ...declaredDecimals(view, valIdx),
    isRate: isRateColumn(view.columns[valIdx], view.column_formats),
    ...(index === 0 ? {} : { baselineKey: "s0" }),
  }));
  const at = new Map<number, { seriesKey: string; position: number }>();
  periods.forEach((period, index) => {
    period.buckets.forEach((bucket, position) => {
      const key = bucketKey(bucket);
      if (key !== null) at.set(key, { seriesKey: `s${index}`, position });
    });
  });
  const cells = new Map<string, { value: number | null; source: number }>();
  for (let r = 0; r < view.rows.length; r += 1) {
    const slot = at.get(roles.timeOfRow[r]?.key);
    if (!slot) return null;
    const cellId = `${slot.position}|${slot.seriesKey}`;
    // 同一期间位置出现多行说明结果不是纯时间序列（如仍带分组维度），不叠加。
    if (cells.has(cellId)) return null;
    cells.set(cellId, { value: toNumber(view.rows[r][valIdx]), source: r });
  }
  const sourceRows: ChartSourceRow[] = [];
  const rows = periods[0].buckets.map((bucket, position) => {
    const row: ChartRow = {
      t: timeLabel(bucket.key?.year ?? null, bucket.key?.month ?? null).label,
    };
    const sources: Record<string, number> = {};
    for (const item of series) {
      const cell = cells.get(`${position}|${item.key}`);
      row[item.key] = cell?.value ?? null;
      if (cell) sources[item.key] = cell.source;
    }
    sourceRows.push(Object.keys(sources).length ? { series: sources } : {});
    return row;
  });
  return withAxes(rows, sourceRows, series);
}

/** 分组趋势折线：单分类 × 单度量，分类值各成一系列 */
function groupedLine(
  view: ViewBlock,
  roles: Roles,
  catIdx: number = roles.catIdx[0],
  valIdx: number = roles.measureIdx[0],
): TrendSpec | null {
  const names = roles.valuesOf.get(catIdx) as string[] | undefined;
  if (!names) return null;
  if (names.length > MAX_LINE_SERIES) return null;
  const format = columnFormat(view.columns[valIdx], view.column_formats);
  const isRate = format !== "number";
  const series = names.map((name, i) => ({
    key: `s${i}`,
    name,
    column: view.columns[valIdx],
    format,
    ...declaredDecimals(view, valIdx),
    isRate,
  }));
  const keyByName = new Map(names.map((n, i) => [n, `s${i}`]));
  const valueAt = new Map<string, number | null>();
  const rowAt = new Map<string, number>();
  for (let r = 0; r < view.rows.length; r += 1) {
    const sk = keyByName.get(cellLabel(view.rows[r][catIdx]));
    if (sk) {
      const key = `${roles.timeOfRow[r].key}|${sk}`;
      valueAt.set(key, toNumber(view.rows[r][valIdx]));
      rowAt.set(key, r);
    }
  }
  const sourceRows: ChartSourceRow[] = [];
  const rows = roles.timePoints.map((t) => {
    const row: ChartRow = { t: t.label };
    const sources: Record<string, number> = {};
    for (const s of series) {
      const key = `${t.key}|${s.key}`;
      row[s.key] = valueAt.get(key) ?? null;
      const source = rowAt.get(key);
      if (source !== undefined) sources[s.key] = source;
    }
    sourceRows.push(Object.keys(sources).length ? { series: sources } : {});
    return row;
  });
  return withAxes(rows, sourceRows, series);
}

function withAxes(
  rows: ChartRow[],
  sourceRows: ChartSourceRow[],
  series: SeriesDef[],
): TrendSpec | null {
  const hasRate = series.some((s) => s.isRate);
  const hasCount = series.some((s) => !s.isRate);
  const rateFormats = [...new Set(series.filter((s) => s.isRate).map((s) => s.format))];
  if (rateFormats.length > 1) return null;
  const mixed = hasRate && hasCount;
  if (mixed) {
    if (series.filter((s) => !s.isRate).length > MAX_COMBO_BAR_SERIES) return null;
    series = series.map((s) => (s.isRate ? s : { ...s, mark: "bar" as const }));
  }
  return {
    kind: "line",
    rows,
    sourceRows,
    series,
    mixedAxes: mixed,
    allRate: hasRate && !hasCount,
    rateFormat: rateFormats[0] ?? "number",
  };
}

type SharePair = { measureIdx: number; numeratorIdx: number };

/** 结构占比与分子的配对关系只认载荷声明（structure_shares），不按命名猜测。 */
function sharePairs(view: ViewBlock): SharePair[] {
  if (!view.structure_shares) return [];
  return view.structure_shares.flatMap((pair) => {
    const measureIdx = view.columns.indexOf(pair.measure);
    const numeratorIdx = view.columns.indexOf(pair.numerator);
    return measureIdx >= 0 && numeratorIdx >= 0 ? [{ measureIdx, numeratorIdx }] : [];
  });
}

function shareIdxForNumerator(view: ViewBlock, numeratorIdx: number): number {
  return sharePairs(view).find((pair) => pair.numeratorIdx === numeratorIdx)?.measureIdx ?? -1;
}

/** 模型声明的小数位（载荷 column_decimals）：只在声明过时才落到呈现件上。 */
function declaredDecimals(view: ViewBlock, colIdx: number): { decimals?: number } {
  const decimals = view.column_decimals?.[view.columns[colIdx]];
  return decimals === undefined ? {} : { decimals };
}

function declaredShareIdx(
  view: ViewBlock,
  numeratorIdx: number,
  annotations?: Set<number>,
): number {
  const shareIdx = shareIdxForNumerator(view, numeratorIdx);
  return annotations === undefined || annotations.has(shareIdx) ? shareIdx : -1;
}

/** 关系推断优先画分子、把同查结构占比作为标签或读数卡上的注释；只查占比时它仍是一等度量。 */
export function primaryMeasureIndices(view: ViewBlock, measureIdx: number[]): number[] {
  const selected = new Set(measureIdx);
  const auxiliary = new Set(
    sharePairs(view).flatMap((pair) => (selected.has(pair.numeratorIdx) ? [pair.measureIdx] : [])),
  );
  return measureIdx.filter((index) => !auxiliary.has(index));
}

/**
 * 结构式标题 = 度量 · 按分类维度 · 趋势粒度，如「收入 · 按区域 · 月度趋势」。
 * 列角色取自 detectRoles，与图型判定同源：图上画了什么，标题就说什么。
 * 占比派生列与取值唯一的分类列（过滤条件回显）循同规不进标题；度量超过三个以「等」收束。
 * 时间列有 ≥2 个时点才算趋势（单时点是过滤回显），带 month 列即月度、否则年度。
 * 没有度量时只列分类；分类也没有时返回 null。
 */
export function structureTitle(view: ViewBlock, titleOf: (c: string) => string): string | null {
  const roles = detectRoles(view);
  const measures = primaryMeasureIndices(view, roles.measureIdx).map((i) =>
    titleOf(view.columns[i]),
  );
  const cats = roles.catIdx.map((i) => titleOf(view.columns[i]));
  if (!measures.length) return cats.length ? cats.join("、") : null;
  const parts = [measures.slice(0, 3).join("、") + (measures.length > 3 ? " 等" : "")];
  if (cats.length) parts.push(`按${cats.join(" × ")}`);
  if (roles.timePoints.length >= 2) {
    parts.push(timeColumnIndex(view, "month") >= 0 ? "月度趋势" : "年度趋势");
  }
  return parts.join(" · ");
}

/** 分类对比图：同量纲画条形；量+率混合时量画柱、率画线并使用双轴。 */
function categoryBar(
  view: ViewBlock,
  roles: Roles,
  titleOf: (c: string) => string,
  catIdx: number = roles.catIdx[0],
  measureIdx: number[] = roles.measureIdx,
  annotations?: Set<number>,
): BarSpec | CategoryComboSpec | null {
  const names = roles.valuesOf.get(catIdx) as string[] | undefined;
  if (!names) return null;
  if (names.length !== view.rows.length) return null;
  const formats = measureIdx.map((i) => columnFormat(view.columns[i], view.column_formats));
  const series = measureIdx.map((colIdx, si) => {
    const shareCol = declaredShareIdx(view, colIdx, annotations);
    return {
      key: `s${si}`,
      name: titleOf(view.columns[colIdx]),
      column: view.columns[colIdx],
      format: formats[si],
      ...declaredDecimals(view, colIdx),
      isRate: formats[si] !== "number",
      ...(shareCol >= 0 ? { shareKey: `p${si}` } : {}),
    };
  });
  const rows = view.rows.map((r) => {
    const row: ChartRow = { label: cellLabel(r[catIdx]) };
    measureIdx.forEach((colIdx, si) => {
      row[`s${si}`] = toNumber(r[colIdx]);
      const shareCol = declaredShareIdx(view, colIdx, annotations);
      if (shareCol >= 0) row[`p${si}`] = toNumber(r[shareCol]);
    });
    return row;
  });
  const rateFormats = [...new Set(series.filter((item) => item.isRate).map((item) => item.format))];
  const hasRate = series.some((item) => item.isRate);
  const hasCount = series.some((item) => !item.isRate);
  if (rateFormats.length > 1) return null;
  if (hasRate && hasCount) {
    if (names.length > MAX_CATEGORY_COMBO_CATEGORIES) return null;
    if (series.filter((item) => !item.isRate).length > MAX_COMBO_BAR_SERIES) return null;
    return {
      kind: "category_combo",
      rows,
      sourceRows: view.rows.map((_, row) => ({ row })),
      series,
      countFormat: series.find((item) => !item.isRate)?.format ?? "number",
      rateFormat: rateFormats[0],
    };
  }
  if (new Set(formats).size > 1) return null;
  if (barChartHeight(names.length, measureIdx.length) > MAX_BAR_CHART_HEIGHT) return null;
  return {
    kind: "bar",
    rows,
    sourceRows: view.rows.map((_, row) => ({ row })),
    series,
    format: formats[0],
    isRate: formats[0] !== "number",
    stacked: false,
    hasShare: series.some((item) => item.shareKey !== undefined),
  };
}

/**
 * 分类拆系列条形图核心：双分类 × 单度量——一侧做分类轴，另一侧派生系列（堆叠段或并列组）。
 * 堆叠仅限计数度量（率的分段相加无意义）；分类值对重复时数据不成矩阵退空。
 * 缺席的 (分类, 系列) 对：计数补 0（构成语义上缺席即为零），率留空（0 是实值不可混）。
 * 服务端派生占比列存在时，分类占比 = 该分类各段占比之和，随读数卡交付。
 */
function categorySeriesBar(
  view: ViewBlock,
  roles: Roles,
  axisIdx: number,
  seriesIdx: number,
  valIdx: number,
  stacked: boolean,
  annotations?: Set<number>,
): BarSpec | null {
  const format = columnFormat(view.columns[valIdx], view.column_formats);
  const isRate = format !== "number";
  if (stacked && isRate) return null;
  const labels = roles.valuesOf.get(axisIdx) as string[] | undefined;
  const seriesNames = roles.valuesOf.get(seriesIdx) as string[] | undefined;
  if (!labels || !seriesNames) return null;
  if (barChartHeight(labels.length, stacked ? 1 : seriesNames.length) > MAX_BAR_CHART_HEIGHT) {
    return null;
  }
  if (seriesNames.length > MAX_STACK_SERIES) return null;

  const series = seriesNames.map((name, i) => ({
    key: `s${i}`,
    name,
    column: view.columns[valIdx],
    format,
    ...declaredDecimals(view, valIdx),
    isRate,
  }));
  const keyByName = new Map(seriesNames.map((n, i) => [n, `s${i}`]));
  const shareCol = declaredShareIdx(view, valIdx, annotations);
  const byLabel = new Map<string, ChartRow>(
    labels.map((l) => [
      l,
      Object.fromEntries([
        ["label", l],
        ...series.map((s) => [s.key, isRate ? null : 0]),
        ...(shareCol >= 0 ? [["share", null]] : []),
      ]) as ChartRow,
    ]),
  );
  const sourcesByLabel = new Map<string, Record<string, number>>(
    labels.map((label) => [label, {}]),
  );
  const seen = new Set<string>();
  for (let rowIndex = 0; rowIndex < view.rows.length; rowIndex += 1) {
    const r = view.rows[rowIndex];
    const label = cellLabel(r[axisIdx]);
    const sk = keyByName.get(cellLabel(r[seriesIdx]));
    const row = byLabel.get(label);
    if (!sk || !row) return null;
    const pair = `${label}|${sk}`;
    if (seen.has(pair)) return null; // 同一格多行：结构不成矩阵
    seen.add(pair);
    row[sk] = toNumber(r[valIdx]) ?? (isRate ? null : 0);
    const sources = sourcesByLabel.get(label);
    if (sources) sources[sk] = rowIndex;
    if (shareCol >= 0) {
      const s = toNumber(r[shareCol]);
      if (s !== null) row.share = ((row.share as number | null) ?? 0) + s;
    }
  }
  return {
    kind: "bar",
    rows: labels.map((l) => byLabel.get(l) as ChartRow),
    sourceRows: labels.map((label) => ({ series: sourcesByLabel.get(label) ?? {} })),
    series,
    format,
    isRate,
    stacked,
    hasShare: shareCol >= 0,
  };
}

/**
 * 饼图（仅声明路径）：单分类 × 单计数度量的部分-整体构成。率不做切片（不构成整体）、
 * 切片数超感知极限或分类值重复（不成矩阵）时退空，表仍忠实呈现。
 */
function pieChart(
  view: ViewBlock,
  roles: Roles,
  titleOf: (c: string) => string,
  catIdx: number,
  valIdx: number,
): PieSpec | null {
  const format = columnFormat(view.columns[valIdx], view.column_formats);
  if (format !== "number") return null;
  const names = roles.valuesOf.get(catIdx) as string[] | undefined;
  if (!names) return null;
  if (names.length > MAX_PIE_SLICES) return null;
  if (names.length !== view.rows.length) return null; // 每分类恰一行才成构成
  return {
    kind: "pie",
    rows: view.rows.map((r) => ({
      label: cellLabel(r[catIdx]),
      value: toNumber(r[valIdx]),
    })),
    sourceRows: view.rows.map((_, row) => ({ row })),
    column: view.columns[valIdx],
    categoryColumn: view.columns[catIdx],
    seriesName: titleOf(view.columns[valIdx]),
    format,
    ...declaredDecimals(view, valIdx),
  };
}

/** 声明列（载荷列短名）→ 结果列下标；引擎折叠或全空列匹配不上时返回 undefined */
function declaredIdx(view: ViewBlock, pool: number[], name: string): number | undefined {
  const idx = pool.find((i) => memberShortName(view.columns[i]) === name);
  return idx;
}

type AxisValue = {
  key: string;
  label: string;
  cell: Cell;
  metricIdx?: number;
};

type ResolvedTableAxis = {
  axis: TableAxis;
  title: string;
  formatKey: string;
  values: AxisValue[];
  valueOf: (row: Cell[], metricIdx: number, rowIndex?: number) => AxisValue | null;
};

// 类型进键，免得数字 1 与字符串 "1" 认成同一个坐标；空值先归一，否则空与空串会排出两列
// 同名的「—」，而它们在数据里的差别构不成两个坐标。
const cellKey = (value: Cell) =>
  isBlankCell(value) ? '"blank"' : JSON.stringify([typeof value, value]);

/**
 * 时间轴取值的键：年月是标量坐标，同一坐标可能以数字（业务桶键）或字符串（结果行）
 * 两种载体到达同一张表——键因此按字面量归一，不带类型。带类型会让「桶造的列」与
 * 「行造的单元格」永不相等，整表落空。
 */
const timeAxisKey = (value: Cell) => (value === null || value === undefined ? "" : String(value));

function uniqueAxisValues(values: AxisValue[]): AxisValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.key)) return false;
    seen.add(value.key);
    return true;
  });
}

function cartesian<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>(
    (rows, values) => rows.flatMap((row) => values.map((value) => [...row, value])),
    [[]],
  );
}

function tableValueIndices(roles: Roles): number[] {
  return roles.measureIdx;
}

/** 桶投影成只含时间列的合成行；轴取值与对照归属共用同一投影，不各自造键。 */
function bucketRow(
  view: ViewBlock,
  bucket: ResultTime["buckets"][number],
  yearIdx: number,
  monthIdx: number,
): Cell[] {
  const row = Array.from<Cell>({ length: view.columns.length }).fill(null);
  row[yearIdx] = bucket.key?.year ?? null;
  if (monthIdx >= 0) row[monthIdx] = bucket.key?.month ?? null;
  return row;
}

function resolveTableAxis(
  view: ViewBlock,
  titleOf: (c: string) => string,
  valueIdx: number[],
  axis: TableAxis,
): ResolvedTableAxis | null {
  if (axis.kind === "metrics") {
    const values = valueIdx.map(
      (metricIdx): AxisValue => ({
        key: `metric:${view.columns[metricIdx]}`,
        label: titleOf(view.columns[metricIdx]),
        cell: titleOf(view.columns[metricIdx]),
        metricIdx,
      }),
    );
    return {
      axis,
      title: "指标",
      formatKey: "metrics",
      values,
      valueOf: (_row, metricIdx) => values.find((value) => value.metricIdx === metricIdx) ?? null,
    };
  }

  if (axis.kind === "field") {
    const index = view.columns.findIndex(
      (column) => memberShortName(column) === memberShortName(axis.column),
    );
    if (index < 0) return null;
    const values = uniqueAxisValues(
      view.rows.map((row): AxisValue => {
        const cell = row[index] ?? null;
        return {
          key: `field:${view.columns[index]}:${cellKey(cell)}`,
          label: cellLabel(cell),
          cell,
        };
      }),
    );
    return {
      axis,
      title: titleOf(view.columns[index]),
      formatKey: view.columns[index],
      values,
      valueOf: (row) => {
        const cell = row[index] ?? null;
        return {
          key: `field:${view.columns[index]}:${cellKey(cell)}`,
          label: cellLabel(cell),
          cell,
        };
      },
    };
  }

  const yearIdx = timeColumnIndex(view, "year");
  const monthIdx = timeColumnIndex(view, "month");
  if (yearIdx < 0 || (axis.level === "month" && monthIdx < 0)) return null;

  const fromRow = (row: Cell[]): AxisValue => {
    const year = row[yearIdx] ?? null;
    const month = monthIdx >= 0 ? (row[monthIdx] ?? null) : null;
    if (axis.level === "year") {
      return { key: `time:year:${timeAxisKey(year)}`, label: cellLabel(year), cell: year };
    }
    if (axis.level === "month") {
      return {
        key: `time:month:${timeAxisKey(month)}`,
        label: `${cellLabel(month)}月`,
        cell: month,
      };
    }
    const point = timeLabel(year, month);
    return { key: `time:bucket:${point.key}`, label: point.label, cell: point.label };
  };
  const bucketRows: Cell[][] =
    view.time?.buckets.map((bucket) => bucketRow(view, bucket, yearIdx, monthIdx)) ?? view.rows;
  const values = uniqueAxisValues(bucketRows.map(fromRow)).sort((left, right) =>
    String(left.key).localeCompare(String(right.key), undefined, { numeric: true }),
  );
  const formatKey =
    axis.level === "month" && monthIdx >= 0 ? view.columns[monthIdx] : view.columns[yearIdx];
  return {
    axis,
    title: axis.level === "bucket" ? "时间" : titleOf(formatKey),
    formatKey,
    values,
    valueOf: fromRow,
  };
}

/**
 * 差值列：来源列位与呈现身份；值由服务端算，消费方不做算术。
 * `after` 是该列在值列序列中的插入锚——恒为本组最后一列，读法因而是「各期…再看差值」。
 */
type DeltaColumn = { after: number; primary: number; comparison: number; column: TableColumn };

/**
 * 时间列轴取值 → 所属期间序号。归属由桶经该轴自身的取值函数投影得到，故与列键同源；
 * 月份层级不承载期间身份（同一月号在各期间都出现），不参与差值。
 * 期间与列值必须**一一对应**：一个列值属于多个期间（跨年窗口的年列），或一个期间摊出
 * 多个列值（bucket 级列轴逐桶成列），「主期 − 对照期」都没有唯一配对——宁可不加列，也不猜。
 */
function periodOfTimeValue(
  view: ViewBlock,
  axis: ResolvedTableAxis,
  periods: CoordinatePeriod[],
): Map<string, number> | null {
  if (axis.axis.kind !== "time" || axis.axis.level === "month") return null;
  const yearIdx = timeColumnIndex(view, "year");
  const monthIdx = timeColumnIndex(view, "month");
  if (yearIdx < 0) return null;
  const owner = new Map<string, number>();
  for (const [index, period] of periods.entries()) {
    let periodValue: string | undefined;
    for (const bucket of period.buckets) {
      const value = axis.valueOf(bucketRow(view, bucket, yearIdx, monthIdx), -1);
      if (!value) return null;
      if (periodValue !== undefined && periodValue !== value.key) return null;
      periodValue = value.key;
      const existing = owner.get(value.key);
      if (existing !== undefined && existing !== index) return null;
      owner.set(value.key, index);
    }
  }
  return owner;
}

/**
 * 对照差值列：同一指标（及其余列轴取值）下，为每个对照期追加一列「主期 − 对照期」。
 * 算术属服务端——消费方（含 MCP 壳）不得对指标做算术，只印服务端给出的值。
 * 率的差是百分点，量的差是相对变化率（分母为零时无定义，留空）。
 * 差值列没有单一来源行，故不参与下钻（sourceRows 记 null）。
 */
function comparisonDeltas(
  view: ViewBlock,
  columnsResolved: ResolvedTableAxis[],
  columnCombos: AxisValue[][],
  valueColumns: TableColumn[],
): DeltaColumn[] {
  const periods = coordinatePeriods(view.time);
  if (!periods || periods.length < 2) return [];
  const timeAxis = columnsResolved.findIndex((axis) => axis.axis.kind === "time");
  if (timeAxis < 0) return [];
  const owner = periodOfTimeValue(view, columnsResolved[timeAxis], periods);
  if (!owner) return [];

  const groupKeyOf = (combo: AxisValue[]) =>
    JSON.stringify(combo.filter((_, index) => index !== timeAxis).map((value) => value.key));
  const groups = new Map<string, { primary?: number; comparisons: number[] }>();
  for (const [index, combo] of columnCombos.entries()) {
    const period = owner.get(combo[timeAxis].key);
    if (period === undefined) return [];
    const key = groupKeyOf(combo);
    const group = groups.get(key) ?? { comparisons: [] };
    if (period === 0) group.primary = index;
    else group.comparisons.push(index);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(({ primary, comparisons }) => {
    if (primary === undefined) return [];
    const after = Math.max(primary, ...comparisons);
    return comparisons.map((comparison): DeltaColumn => {
      const source = valueColumns[comparison];
      const label = `较${periodLabel(periods[owner.get(columnCombos[comparison][timeAxis].key) ?? 0])}`;
      return {
        after,
        primary,
        comparison,
        column: {
          label,
          formatKey: source.formatKey,
          format: isRateFormat(source.format) ? "percentage_point" : "percent",
          ...(isRateFormat(source.format) && source.decimals !== undefined
            ? { decimals: source.decimals }
            : {}),
          numeric: true,
          headerPath: [
            ...source.headerPath.slice(0, -1),
            { key: `delta:${source.headerPath.at(-1)?.key ?? comparison}`, label },
          ],
        },
      };
    });
  });
}

/** 差值：率按百分点作差，量按相对变化率；任一端缺失或分母为零即无定义。 */
function deltaValue(primary: Cell, comparison: Cell, rate: boolean): number | null {
  const a = toNumber(primary);
  const b = toNumber(comparison);
  if (a === null || b === null) return null;
  if (rate) return a - b;
  return b === 0 ? null : (a - b) / b;
}

/**
 * 整窗读数模型：每个指标一个数、一句写实的覆盖期间，以及相对各对照期的差值——差值走与
 * 表格差值列同一个 deltaValue，率得百分点、量得相对变化率。
 * 它是指标卡的唯一数据源：大数字读的是整窗合计，不是碰巧只有一行的那一行。
 */
export type TotalBandMetric = {
  column: string;
  label: string;
  value: Cell;
  format: ColumnFormat;
  decimals?: number;
  /**
   * 主期真实覆盖的期间；不能整窗合并的指标在终点求值，这里写的就是终点期。
   * from/to 是这个大数的身份坐标：构成记录下钻必须沿用同一覆盖，不得退回某一行的桶。
   */
  period?: { label: string; from: string; to: string };
  comparisons: { label: string; value: number | null; format: ColumnFormat; decimals?: number }[];
};
export type TotalBand = {
  metrics: TotalBandMetric[];
};

function isWholeWindowResult(view: ViewBlock): boolean {
  if (view.rows.length !== 1) return false;
  const { roles } = analyzeResultShape(view);
  return roles.timeIdx.length === 0 && roles.measureIdx.length === view.columns.length;
}

/**
 * 派生结果没有业务时间轴，因而没有整窗合计供给。它若已收敛为单行纯指标，那一行本身
 * 就是整窗单值——来源查询已按合计粒度求过值，这里只是换个读法，不做任何算术。
 */
function singleRowBand(view: ViewBlock, titleOf: (c: string) => string): TotalBand | null {
  if (!isWholeWindowResult(view)) return null;
  return {
    metrics: view.columns.map((column, index) => ({
      column,
      label: titleOf(column),
      value: view.rows[0][index],
      format: columnFormat(column, view.column_formats),
      ...declaredDecimals(view, index),
      comparisons: [],
    })),
  };
}

export function compileTotalBand(
  view: ViewBlock,
  titleOf: (c: string) => string,
): TotalBand | null {
  const coordinates = view.time?.coordinates;
  if (!view.totals || !coordinates) return singleRowBand(view, titleOf);
  const metrics = view.totals.metrics.map((metric): TotalBandMetric => {
    const format = columnFormat(metric.column, view.column_formats);
    const rate = isRateFormat(format);
    const decimals = view.column_decimals?.[metric.column];
    const [primary, ...comparisons] = metric.periods;
    return {
      column: metric.column,
      label: titleOf(metric.column),
      value: primary.value,
      format,
      ...(decimals !== undefined ? { decimals } : {}),
      period: { label: coverageLabel(primary), from: primary.from, to: primary.to },
      comparisons: comparisons.map((period, index) => ({
        // 对照名取坐标本身（与表格差值列同一措辞），期内降级不改变「和谁比」。
        label: `较${periodLabel(coordinates[index + 1])}`,
        value: deltaValue(primary.value, period.value, rate),
        format: rate ? ("percentage_point" as const) : ("percent" as const),
        ...(rate && decimals !== undefined ? { decimals } : {}),
      })),
    };
  });
  return metrics.length ? { metrics } : null;
}

/** 把差值列插进值列序列：每列紧随其对照列，行、总体行与来源映射同步扩展。 */
function withDeltaColumns(table: TableModel, deltas: DeltaColumn[], offset: number): TableModel {
  if (!deltas.length) return table;
  const byAnchor = new Map<number, DeltaColumn[]>();
  for (const delta of deltas) {
    byAnchor.set(delta.after, [...(byAnchor.get(delta.after) ?? []), delta]);
  }
  const expand = <T>(cells: T[], make: (delta: DeltaColumn) => T): T[] =>
    cells.flatMap((cell, index) => {
      const anchored = index >= offset ? byAnchor.get(index - offset) : undefined;
      return anchored ? [cell, ...anchored.map(make)] : [cell];
    });
  const expandRow = (row: Cell[]): Cell[] =>
    expand(row, (delta) =>
      deltaValue(
        row[offset + delta.primary] ?? null,
        row[offset + delta.comparison] ?? null,
        isRateFormat(table.columns[offset + delta.comparison]?.format),
      ),
    );
  return {
    columns: expand(table.columns, (delta) => delta.column),
    rows: table.rows.map(expandRow),
    ...(table.sourceRows
      ? { sourceRows: table.sourceRows.map((row) => expand(row, () => null)) }
      : {}),
    ...(table.summaryRows ? { summaryRows: table.summaryRows.map(expandRow) } : {}),
  };
}

function unavailableTable(
  view: ViewBlock,
  titleOf: (c: string) => string,
  reason: Extract<TableLayoutStatus, { state: "unavailable" }>["reason"],
  message: string,
  leafColumns = 0,
): TableCompilation {
  return {
    table: flatTable(view, titleOf),
    layout: { state: "unavailable", leafColumns, reason, message },
  };
}

/**
 * 通用表格布局编译器：完整布局中的每个轴只负责坐标，指标值始终来自模型结果原值。
 * 稀疏矩阵留空；重复坐标无法忠实表达时显式返回 unavailable，不做聚合或静默换形。
 */
function compileTableLayout(
  view: ViewBlock,
  roles: Roles,
  titleOf: (c: string) => string,
  layout: TableLayoutDecl,
): TableCompilation {
  const valueIdx = tableValueIndices(roles);
  if (!valueIdx.length || !layout.columns.length) {
    return {
      table: flatTable(view, titleOf),
      layout: { state: "applied", leafColumns: valueIdx.length },
    };
  }
  const rowAxes = layout.rows.map((axis) => resolveTableAxis(view, titleOf, valueIdx, axis));
  const columnAxes = layout.columns.map((axis) => resolveTableAxis(view, titleOf, valueIdx, axis));
  if (rowAxes.some((axis) => !axis) || columnAxes.some((axis) => !axis)) {
    return unavailableTable(
      view,
      titleOf,
      "missing_axis",
      "表格布局引用了当前结果中不存在的时间层级、指标轴或分组维度。",
    );
  }
  const rowsResolved = rowAxes as ResolvedTableAxis[];
  const columnsResolved = columnAxes as ResolvedTableAxis[];
  const columnCombos = cartesian(columnsResolved.map((axis) => axis.values));
  const leafColumns = columnCombos.length;
  if (leafColumns > MAX_TABLE_LEAF_COLUMNS) {
    return unavailableTable(
      view,
      titleOf,
      "resource_limit",
      `表格布局会生成 ${leafColumns} 个值列，超过渲染资源上限 ${MAX_TABLE_LEAF_COLUMNS}。`,
      leafColumns,
    );
  }

  const rowCombos = new Map<string, AxisValue[]>();
  const cells = new Map<string, { value: Cell; source: number }>();
  let duplicate = false;
  for (let rowIndex = 0; rowIndex < view.rows.length; rowIndex += 1) {
    const row = view.rows[rowIndex];
    for (const metricIdx of valueIdx) {
      const rowValues = rowsResolved.map((axis) => axis.valueOf(row, metricIdx, rowIndex));
      const columnValues = columnsResolved.map((axis) => axis.valueOf(row, metricIdx, rowIndex));
      if (rowValues.some((value) => !value) || columnValues.some((value) => !value)) continue;
      const resolvedRows = rowValues as AxisValue[];
      const resolvedColumns = columnValues as AxisValue[];
      const rowKey = JSON.stringify(resolvedRows.map((value) => value.key));
      const columnKeyValue = JSON.stringify(resolvedColumns.map((value) => value.key));
      const coordinate = JSON.stringify([rowKey, columnKeyValue]);
      if (cells.has(coordinate)) {
        duplicate = true;
        break;
      }
      rowCombos.set(rowKey, resolvedRows);
      cells.set(coordinate, { value: row[metricIdx] ?? null, source: rowIndex });
    }
    if (duplicate) break;
  }
  if (duplicate) {
    return unavailableTable(
      view,
      titleOf,
      "duplicate_coordinate",
      "同一行轴、列轴与指标坐标对应多条结果，无法在不聚合的前提下忠实形成矩阵。",
      leafColumns,
    );
  }

  const rowHeaderColumns: TableColumn[] = rowsResolved.map((axis, index) => ({
    label: axis.title,
    formatKey: axis.formatKey,
    numeric: false,
    headerPath: [{ key: `row:${index}:${axis.formatKey}`, label: axis.title }],
  }));
  const valueColumns: TableColumn[] = columnCombos.map((combo) => {
    const metric = combo.find((value) => value.metricIdx !== undefined);
    const metricIdx = metric?.metricIdx ?? valueIdx[0];
    const formatKey = view.columns[metricIdx];
    return {
      label: combo.at(-1)?.label ?? titleOf(formatKey),
      formatKey,
      ...(view.column_formats?.[formatKey] ? { format: view.column_formats[formatKey] } : {}),
      ...(view.column_decimals?.[formatKey] !== undefined
        ? { decimals: view.column_decimals[formatKey] }
        : {}),
      numeric: true,
      headerPath: combo.map((value) => ({ key: value.key, label: value.label })),
    };
  });
  const columnKeyOf = (combo: AxisValue[]) => JSON.stringify(combo.map((value) => value.key));
  const rows = [...rowCombos.entries()].map(([rowKey, rowValues]) => [
    ...rowValues.map((value) => value.cell),
    ...columnCombos.map(
      (combo) => cells.get(JSON.stringify([rowKey, columnKeyOf(combo)]))?.value ?? null,
    ),
  ]);
  const sourceRows = [...rowCombos.entries()].map(([rowKey]) => [
    ...rowsResolved.map(() => null),
    ...columnCombos.map(
      (combo) => cells.get(JSON.stringify([rowKey, columnKeyOf(combo)]))?.source ?? null,
    ),
  ]);

  let summaryRows: Cell[][] | undefined;
  if (view.summary?.rows.length) {
    if (columnsResolved.some((axis) => axis.axis.kind === "field")) {
      return unavailableTable(
        view,
        titleOf,
        "missing_axis",
        "模型重算总体不包含业务维度列轴，当前布局无法忠实映射总体。",
        leafColumns,
      );
    }
    const summaryCells = new Map<string, Cell>();
    for (const row of view.summary.rows) {
      for (const metricIdx of valueIdx) {
        const values = columnsResolved.map((axis) => axis.valueOf(row, metricIdx));
        if (values.some((value) => !value)) continue;
        const key = columnKeyOf(values as AxisValue[]);
        if (summaryCells.has(key)) {
          return unavailableTable(
            view,
            titleOf,
            "duplicate_coordinate",
            "模型重算总体在同一列轴与指标坐标上出现多条结果。",
            leafColumns,
          );
        }
        summaryCells.set(key, row[metricIdx] ?? null);
      }
    }
    summaryRows = [
      [
        ...rowsResolved.map((_, index) => (index === 0 ? view.summary!.label : null)),
        ...columnCombos.map((combo) => summaryCells.get(columnKeyOf(combo)) ?? null),
      ],
    ];
  }

  const base: TableModel = {
    columns: [...rowHeaderColumns, ...valueColumns],
    rows,
    sourceRows,
    ...(summaryRows ? { summaryRows } : {}),
  };
  // 差值是增益不是前提：超出渲染资源上限时保留基础矩阵，不因此判整份布局不可用。
  const deltas = comparisonDeltas(view, columnsResolved, columnCombos, valueColumns);
  const withDeltas = leafColumns + deltas.length > MAX_TABLE_LEAF_COLUMNS ? [] : deltas;
  return {
    table: withDeltaColumns(base, withDeltas, rowHeaderColumns.length),
    layout: {
      state: "applied",
      leafColumns: leafColumns + withDeltas.length,
    },
  };
}

/**
 * 按呈现声明构建图型：绑定名已在 chart_spec 校验层归一并补齐默认值，这里只剩
 * 数据完整性守卫——前提不满足（时间点不足、列在本结果中不成角色、矩阵不成立）时
 * 返回 null 退表格，与缺省判定的守卫同语义。
 */
function declaredChart(
  view: ViewBlock,
  roles: Roles,
  titleOf: (c: string) => string,
  decl: ChartRenderDecl,
): ChartSpec | null {
  const measureIdx = decl.y.map((y) => declaredIdx(view, roles.measureIdx, y));
  if (measureIdx.some((i) => i === undefined)) return null;
  const measures =
    decl.annotations === undefined
      ? primaryMeasureIndices(view, measureIdx as number[])
      : (measureIdx as number[]);
  if (!measures.length) return null;
  const annotations =
    decl.annotations === undefined
      ? undefined
      : new Set(
          decl.annotations.flatMap((name) => {
            const index = declaredIdx(view, roles.measureIdx, name);
            return index === undefined ? [] : [index];
          }),
        );

  if (decl.type === "line") {
    if (roles.timePoints.length < 2) return null;
    if (decl.groupBy !== undefined) {
      const catIdx = declaredIdx(view, roles.catIdx, decl.groupBy);
      if (catIdx === undefined || measures.length !== 1) return null;
      return groupedLine(view, roles, catIdx, measures[0]);
    }
    // 同期对照优先叠加成期间系列；不成立（相邻周期、异长窗口、多指标）时退回单一时间轴。
    const periods = measures.length === 1 ? overlayPeriods(view.time) : null;
    const overlay = periods ? comparisonLine(view, roles, measures[0], periods) : null;
    return overlay ?? timeSeriesLine(view, roles, titleOf, measures);
  }

  if (decl.type === "bar") {
    const axisIdx = decl.x !== undefined ? declaredIdx(view, roles.catIdx, decl.x) : undefined;
    if (axisIdx === undefined) return null;
    if (decl.groupBy !== undefined) {
      const seriesIdx = declaredIdx(view, roles.catIdx, decl.groupBy);
      if (seriesIdx === undefined || seriesIdx === axisIdx || measures.length !== 1) return null;
      return categorySeriesBar(
        view,
        roles,
        axisIdx,
        seriesIdx,
        measures[0],
        decl.stack === true,
        annotations,
      );
    }
    return categoryBar(view, roles, titleOf, axisIdx, measures, annotations);
  }

  if (decl.type === "pie") {
    const catIdx = decl.x !== undefined ? declaredIdx(view, roles.catIdx, decl.x) : undefined;
    if (catIdx === undefined || measures.length !== 1) return null;
    return pieChart(view, roles, titleOf, catIdx, measures[0]);
  }

  return null;
}

type ResultShape = {
  roles: Roles;
  temporal: boolean;
};

/** 只识别结果结构，不输出任何呈现选择。 */
export function analyzeResultShape(view: ViewBlock): ResultShape {
  const detected = detectRoles(view);
  const roles = {
    ...detected,
    measureIdx: primaryMeasureIndices(view, detected.measureIdx),
  };
  return { roles, temporal: roles.timePoints.length >= 2 };
}

/** 表格确定性编译：只执行输入边界已归一的布局；内部裸调用按原始长表忠实交付。 */
export function compileTableWithStatus(
  view: ViewBlock,
  titleOf: (c: string) => string,
  decl?: ChartDecl,
): TableCompilation {
  const roles = detectRoles(view);
  const compiled = decl
    ? compileTableLayout(view, roles, titleOf, decl.tableLayout)
    : {
        table: flatTable(view, titleOf),
        layout: { state: "applied" as const, leafColumns: tableValueIndices(roles).length },
      };
  if (decl?.type !== "table" || !decl.shading) return compiled;
  // 只给指标列上色：交叉表的值列沿用度量列作 formatKey，长表的度量列即其本身
  const measureKeys = new Set(roles.measureIdx.map((index) => view.columns[index]));
  const shading = compileTableShading(
    decl.shading,
    compiled.table.columns,
    compiled.table.rows,
    measureKeys,
  );
  return { ...compiled, table: { ...compiled.table, shading } };
}

export function compileTable(
  view: ViewBlock,
  titleOf: (c: string) => string,
  decl?: ChartDecl,
): TableModel {
  return compileTableWithStatus(view, titleOf, decl).table;
}

/** 着色刻度的缺省读法及其量纲：指标列的数据极值，格式与小数位在各指标一致时沿用，否则按普通数值。 */
export type TableShadingDefaults = {
  scale: ShadingScale;
  format: ColumnFormat;
  decimals: number;
};

export function tableShadingDefaults(view: ViewBlock): TableShadingDefaults | null {
  const measures = detectRoles(view).measureIdx.map((index) => view.columns[index]);
  const scale = shadingDataScale(
    view.columns.map((column) => ({ formatKey: column })),
    view.rows,
    new Set(measures),
  );
  if (!scale) return null;
  const formats = new Set(measures.map((column) => columnFormat(column, view.column_formats)));
  const decimals = new Set(measures.map((column) => columnDecimals(column, view.column_decimals)));
  const format = formats.size === 1 ? [...formats][0] : "number";
  return {
    scale,
    format,
    decimals: decimals.size === 1 ? [...decimals][0] : columnDecimals(""),
  };
}

/** 图表确定性编译：只执行已声明图型；table/kpi 不经过图表编译器。 */
export function compileChart(
  view: ViewBlock,
  titleOf: (c: string) => string,
  decl: ChartRenderDecl,
): ChartSpec | null {
  if (decl.type === "table" || decl.type === "kpi" || !view.rows.length) return null;
  return declaredChart(view, detectRoles(view), titleOf, decl);
}

/**
 * KPI 运行时守卫：整窗读数可成、1–4 个指标、无业务分组。分组结果不成 KPI——把分组合起来
 * 只剩一个数，等于把用户要的那件事丢掉；时间序列则无妨，大数字读的正是它的整窗合计。
 */
export function canCompileKpi(view: ViewBlock): boolean {
  const band = compileTotalBand(view, (column) => column);
  if (!band || band.metrics.length > 4) return false;
  return !view.columns.some((column) => view.column_roles[column] === "dimension");
}

export type SensibleForm = PresentationType;

export function sensibleForms(view: ViewBlock): SensibleForm[] {
  const detected = detectRoles(view);
  const roles = {
    ...detected,
    measureIdx: primaryMeasureIndices(view, detected.measureIdx),
  };
  const measures = roles.measureIdx.map((index) => view.columns[index]);
  const categories = roles.catIdx.map((index) => view.columns[index]);
  const candidates: Array<{
    form: Exclude<SensibleForm, "table" | "kpi">;
    decl: ChartRenderDecl;
  }> = [];
  if (roles.timePoints.length >= 2 && measures.length) {
    candidates.push({
      form: "line",
      decl: {
        type: "line",
        y: categories.length ? [measures[0]] : measures,
        ...(categories.length === 1 ? { groupBy: categories[0] } : {}),
      },
    });
  }
  if (roles.timePoints.length < 2 && categories.length && measures.length) {
    candidates.push({
      form: "bar",
      decl: {
        type: "bar",
        x: categories[0],
        y: categories.length === 1 ? measures : [measures[0]],
        ...(categories.length === 2 ? { groupBy: categories[1] } : {}),
      },
    });
    if (categories.length === 1 && measures.length === 1) {
      candidates.push({
        form: "pie",
        decl: { type: "pie", x: categories[0], y: [measures[0]] },
      });
    }
  }
  const titleOf = makeTitleOf(view);
  return [
    "table",
    ...(canCompileKpi(view) ? (["kpi"] as const) : []),
    ...candidates.flatMap(({ form, decl }) => {
      return compileChart(view, titleOf, decl) ? [form] : [];
    }),
  ];
}

export function renderShapeOfView(view: ViewBlock, decl: ChartDecl): RenderShape | null {
  if (!view.rows.length) return null;
  if (decl.type === "kpi" && canCompileKpi(view)) return "kpi";
  const chart = compileChart(view, makeTitleOf(view), decl);
  if (chart) return chart.kind === "category_combo" ? "bar" : chart.kind;
  const table = compileTable(view, makeTitleOf(view), decl);
  return table.columns.some((column) => column.headerPath.length > 1) ? "crosstab" : "table";
}
