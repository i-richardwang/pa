import type { ViewBlock } from "@payload";

type ResultTimeBucket = NonNullable<ViewBlock["time"]>["buckets"][number];

/** 行的时间键，取自结果的 year/month 列；没有时间列时为 null。 */
function rowTimeKey(view: ViewBlock, row: number): { year: number; month?: number } | null {
  const valueAt = (column: string) => {
    const index = view.columns.indexOf(column);
    return index >= 0 ? Number(view.rows[row]?.[index]) : Number.NaN;
  };
  const year = valueAt("year");
  const month = valueAt("month");
  if (!Number.isInteger(year)) return null;
  return Number.isInteger(month) ? { year, month } : { year };
}

/**
 * 按时间键匹配该行所属的时间桶（桶由服务端解析后随结果返回）；匹配不到或匹配到多个时返回 null。
 */
function bucketOfRow(view: ViewBlock, buckets: ResultTimeBucket[], row: number) {
  const key = rowTimeKey(view, row);
  const matching = buckets.filter((bucket) =>
    key === null
      ? bucket.key === null
      : bucket.key?.year === key.year && bucket.key?.month === key.month,
  );
  return matching.length === 1 ? matching[0] : null;
}

/**
 * 返回单元格的绝对时间范围，不使用“最新月”等相对表达。
 * `override` 是被点击的数值自带的期间，优先于行所在的时间桶，保证明细与该数值对应。
 */
export function recordProjectionTimeCoordinate(
  view: ViewBlock,
  row: number,
  override?: { from: string; to: string },
) {
  if (override) return override;
  const bucket = view.time ? bucketOfRow(view, view.time.buckets, row) : null;
  return bucket ? { from: bucket.from, to: bucket.to } : null;
}

export function recordProjectionCoordinates(
  view: ViewBlock,
  row: number,
  dimensions: Record<string, { dimension_id: string }>,
) {
  return Object.entries(dimensions).flatMap(([column, dimension]) => {
    const index = view.columns.indexOf(column);
    const value = index >= 0 ? view.rows[row]?.[index] : undefined;
    return value === undefined ? [] : [{ dimension_id: dimension.dimension_id, value }];
  });
}
