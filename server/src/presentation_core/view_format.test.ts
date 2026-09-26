import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import {
  cellLabel,
  columnDecimals,
  compareCells,
  formatCell,
  formatSignedDelta,
  isBlankCell,
  formatSeriesValue,
  formatTick,
  isRateColumn,
  toNumber,
} from "./view_format.js";

describe("百分比格式", () => {
  test("显式 percent 把 0–1 原始比率展示为百分数，默认一位小数", () => {
    expect(formatCell(0.0428, "metric", "percent")).toBe("4.3%");
    expect(formatSeriesValue(0.0428, "percent")).toBe("4.3%");
    expect(formatTick(0.0428, "percent")).toBe("4.3%");
    expect(formatTick(0.04, "percent")).toBe("4%");
  });

  test("列声明的小数位覆盖默认值，调研结果显示为整数百分比", () => {
    expect(formatCell(0.2349, "survey_score", "percent", 0)).toBe("23%");
    expect(formatCell(-0.046, "survey_score", "percent", 0)).toBe("-5%");
    expect(formatSeriesValue(0.2349, "percent", 0)).toBe("23%");
    expect(formatTick(0.225, "percent", 0)).toBe("23%");
    expect(formatSignedDelta(0.031, "percentage_point", 0)).toBe("+3 pp");
    expect(columnDecimals("survey_score", { survey_score: 0 })).toBe(0);
    expect(columnDecimals("headcount", { survey_score: 0 })).toBe(1);
  });

  test("显式 percentage_point 把 0–1 原始差值展示为百分点", () => {
    expect(formatCell(0.02, "同比变化（百分点）", "percentage_point")).toBe("2.0 pp");
    expect(formatSeriesValue(0.02, "percentage_point")).toBe("2.0 pp");
    expect(formatTick(0.02, "percentage_point")).toBe("2 pp");
    expect(
      isRateColumn("同比变化（百分点）", {
        "同比变化（百分点）": "percentage_point",
      }),
    ).toBe(true);
  });

  test("未声明格式的列按普通数值展示，不按列名推断", () => {
    expect(isRateColumn("ytd_primary_event_rate")).toBe(false);
    expect(formatCell(4.28, "exchange_rate")).toBe("4.3");
    expect(formatCell(4.28, "exchange_rate", "number", 2)).toBe("4.28");
    expect(formatCell(0.0428, "active_employee_share", "percent")).toBe("4.3%");
  });
});

test("结果呈现代码的空值占位符都通过 cellLabel 生成", async () => {
  const dirs = ["./", "../../result_view/src/components/"];
  const files = (
    await Promise.all(
      dirs.map(async (dir) =>
        (
          await readdir(new URL(dir, import.meta.url), { recursive: true })
        )
          .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test."))
          .map((name) => new URL(`${dir}${name}`, import.meta.url)),
      ),
    )
  ).flat();
  expect(files.length, "没有扫描到任何文件，请检查扫描路径").toBeGreaterThan(5);

  const HAND_ROLLED = /(?:\?\?|\|\|)\s*["']—["']/g;
  expect('String(cell ?? "—")'.match(HAND_ROLLED), "匹配规则应能识别手写的空值占位").not.toBeNull();
  expect("cellLabel(cell)".match(HAND_ROLLED), "匹配规则不应命中 cellLabel 调用").toBeNull();

  const offenders: string[] = [];
  for (const file of files) {
    if (file.pathname.endsWith("view_format.ts")) continue;
    if ((await readFile(file, "utf8")).match(HAND_ROLLED)) offenders.push(file.pathname);
  }
  expect(offenders, "请改用 cellLabel，空值占位符和分组键要用同一实现").toEqual([]);
});

describe("单元格与排序", () => {
  test("数值字符串转成数字，空值显示占位符", () => {
    expect(toNumber("834")).toBe(834);
    expect(toNumber("")).toBeNull();
    expect(formatCell(null, "active_employee_count")).toBe("—");
    expect(formatCell(12345, "active_employee_count")).toBe("12,345");
  });

  test("维度取值为空、空串或纯空白时显示同一个占位符", () => {
    expect(cellLabel(null)).toBe("—");
    expect(cellLabel("")).toBe("—");
    expect(cellLabel("   ")).toBe("—");
    expect(cellLabel(0)).toBe("0");
    expect(cellLabel("研发")).toBe("研发");
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell("\t")).toBe(true);
  });

  test("时间列原样展示不做数字格式化", () => {
    expect(formatCell(2026, "year")).toBe("2026");
    expect(formatCell("2026", "test_people_metrics.year")).toBe("2026");
  });

  test("排序时数值按大小、字符串按 locale，null 排在最后", () => {
    expect(compareCells("12", "9")).toBeGreaterThan(0);
    expect(compareCells(null, 1)).toBeGreaterThan(0);
    expect(compareCells("阿", null)).toBeLessThan(0);
  });
});
