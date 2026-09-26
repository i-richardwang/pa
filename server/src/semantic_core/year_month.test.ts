import { expect, test } from "bun:test";
import {
  formatYearMonth,
  isYearMonth,
  parseYearMonth,
  shiftYearMonth,
  yearMonthFromOrdinal,
  yearMonthOrdinal,
} from "./year_month.js";

test("年月解析、序号换算与格式化只接受合法的 YYYY-MM", () => {
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

test("年月平移可跨年，无效输入返回 null", () => {
  expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftYearMonth("2026-12", 2)).toBe("2027-02");
  expect(shiftYearMonth("2026/12", 1)).toBeNull();
});
