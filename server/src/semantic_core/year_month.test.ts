import { expect, test } from "bun:test";
import {
  formatYearMonth,
  isYearMonth,
  parseYearMonth,
  shiftYearMonth,
  yearMonthFromOrdinal,
  yearMonthOrdinal,
} from "./year_month.js";

test("年月解析、序号与格式化共用同一套边界", () => {
  expect(parseYearMonth("2026-09")).toEqual({ year: 2026, month: 9 });
  expect(parseYearMonth("2026-9")).toBeNull();
  expect(isYearMonth("2026-12")).toBe(true);
  expect(isYearMonth("2026-13")).toBe(false);
  expect(yearMonthFromOrdinal(yearMonthOrdinal({ year: 2026, month: 1 }))).toEqual({
    year: 2026,
    month: 1,
  });
  expect(formatYearMonth({ year: 2026, month: 9 })).toBe("2026-09");
});

test("年月平移跨年且无效输入不猜测", () => {
  expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftYearMonth("2026-12", 2)).toBe("2027-02");
  expect(shiftYearMonth("2026/12", 1)).toBeNull();
});
