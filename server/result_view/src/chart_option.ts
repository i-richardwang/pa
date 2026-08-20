/**
 * 已编译 option 的形状读取。
 *
 * `series`、`xAxis` 这些字段单个与数组两种写法都合法，读它们的地方不各写一遍归一。
 * 饼图的切片与总量也归此处：求和是呈现算术（与切片占比同级，不回头找明细），环心总计、
 * 读数条的占比列与卡内占比读的是同一份。
 */
export type MutableOption = Record<string, unknown>;

export function asArray(value: unknown): MutableOption[] {
  if (Array.isArray(value)) return value as MutableOption[];
  if (value && typeof value === "object") return [value as MutableOption];
  return [];
}

export function pieData(option: MutableOption): { name: string; value: number | null }[] {
  const data = (asArray(option.series)[0]?.data ?? []) as { name?: unknown; value?: unknown }[];
  return data.map((d) => ({
    name: String(d.name ?? ""),
    value: typeof d.value === "number" ? d.value : null,
  }));
}

export function pieTotal(option: MutableOption): number {
  return pieData(option).reduce((sum, d) => sum + (d.value ?? 0), 0);
}
