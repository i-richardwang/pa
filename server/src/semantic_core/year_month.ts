const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type YearMonth = { year: number; month: number };

export function parseYearMonth(value: string | undefined): YearMonth | null {
  const match = value?.match(YEAR_MONTH_PATTERN);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

export function isYearMonth(value: string | undefined): value is string {
  return parseYearMonth(value) !== null;
}

export function formatYearMonth({ year, month }: YearMonth): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`无效年月：${year}-${month}`);
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function yearMonthOrdinal({ year, month }: YearMonth): number {
  return year * 12 + month - 1;
}

export function yearMonthFromOrdinal(ordinal: number): YearMonth {
  if (!Number.isInteger(ordinal)) throw new Error(`无效年月序号：${ordinal}`);
  const year = Math.floor(ordinal / 12);
  return { year, month: ordinal - year * 12 + 1 };
}

export function shiftYearMonth(value: string, delta: number): string | null {
  const parsed = parseYearMonth(value);
  return parsed ? formatYearMonth(yearMonthFromOrdinal(yearMonthOrdinal(parsed) + delta)) : null;
}

export const YEAR_MONTH_REGEX = YEAR_MONTH_PATTERN;
