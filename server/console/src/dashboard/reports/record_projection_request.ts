import type { ViewBlock } from "@payload";

type ResultTimeBucket = NonNullable<ViewBlock["time"]>["buckets"][number];

/** 行在时间轴上的键：与结果的时间列一一对应，无时间列时为 null。 */
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
 * 按行键定位该行所属的业务时间桶。桶由服务端唯一编译点解析并随结果交付，此处只做匹配。
 * 一行匹配不到或匹配到多个桶时返回 null——宁可不提供记录投影，也不给一个猜出来的时间范围。
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
 * 渲染结果格携带的是已解析业务时间；Record Projection 只复用它，不接受“最新月”等相对表达。
 * 交付的桶对全部指标列相同，指标各自的时间语义由服务端在桶区间上收窄（期间取整段、
 * 时点与年初累计取桶终点），因此这里无须按 metric 区分。
 *
 * `override` 是被点击读数显式携带的覆盖期间（指标卡的整窗大数），身份优先于行桶——
 * 名单必须回答用户点的那个数，而不是碰巧排在首行的那个桶。
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
