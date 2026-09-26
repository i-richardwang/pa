import { describe, expect, test } from "bun:test";
import { CHART_SERIES } from "./design_tokens.js";
import { compileTableShading, shadeCell, shadingDataScale } from "./table_shading.js";
import { compileTableWithStatus, tableShadingDefaults } from "./view_shape.js";
import type { ViewBlock } from "../semantic_core/query_payload.js";

const BLUE = CHART_SERIES[0].light;

const columns = [
  { formatKey: "org" },
  { formatKey: "headcount" },
  { formatKey: "rate" },
  { formatKey: "headcount" },
];
const rows: (string | number | null)[][] = [
  ["研发", 100, 0.1, 40],
  ["市场", 20, 0.5, null],
  ["运营", 60, 0.3, 80],
];
const measureKeys = new Set(["headcount", "rate"]);

describe("热力着色刻度", () => {
  test("每个指标键单独计算刻度，同键的多列合并取极值，非指标键没有刻度", () => {
    const shading = compileTableShading({ palette: BLUE }, columns, rows, measureKeys);
    expect(shading.scales).toEqual({
      headcount: { min: 20, mid: 60, max: 100 },
      rate: { min: 0.1, mid: 0.3, max: 0.5 },
    });
    expect(shading.values).toBe(true);
    expect(shading.flipped).toBe(false);
  });

  test("声明的阈值逐项覆盖，未声明中点时取两端的中点", () => {
    const shading = compileTableShading(
      { palette: "red_blue", thresholds: { max: 200 } },
      columns,
      rows,
      measureKeys,
    );
    expect(shading.scales.headcount).toEqual({ min: 20, mid: 110, max: 200 });
  });

  test("单个阈值落在数据范围外时，自动计算的端点仍包含该阈值", () => {
    const lower = compileTableShading(
      { palette: "red_blue", thresholds: { min: 200 } },
      columns,
      rows,
      measureKeys,
    );
    expect(lower.scales.headcount).toEqual({ min: 200, mid: 200, max: 200 });

    const middle = compileTableShading(
      { palette: "red_blue", thresholds: { mid: 200 } },
      columns,
      rows,
      measureKeys,
    );
    expect(middle.scales.headcount).toEqual({ min: 20, mid: 200, max: 200 });
  });

  test("没有任何数值的键没有刻度", () => {
    const shading = compileTableShading(
      { palette: BLUE },
      [{ formatKey: "empty" }],
      [[null], ["—"]],
      new Set(["empty"]),
    );
    expect(shading.scales).toEqual({});
  });

  test("默认刻度取各键数据范围的并集，没有数值时为 null", () => {
    expect(shadingDataScale(columns, rows, measureKeys)).toEqual({
      min: 0.1,
      mid: 50.05,
      max: 100,
    });
    expect(shadingDataScale(columns, rows, new Set(["rate"]))).toEqual({
      min: 0.1,
      mid: 0.3,
      max: 0.5,
    });
    expect(shadingDataScale(columns, [], measureKeys)).toBeNull();
  });
});

describe("数值到颜色", () => {
  const mono = compileTableShading({ palette: BLUE }, columns, rows, measureKeys);

  test("单色色阶值越大越浓，不透明度从 0.05 到 1，字色按底色对比度切换", () => {
    const low = shadeCell(20, "headcount", mono, false)!;
    const high = shadeCell(100, "headcount", mono, false)!;
    expect(low.background).toMatch(/rgba\(59, 111, 219, 0\.050\)/);
    expect(low.foreground).toBe("ink");
    expect(high.background).toMatch(/rgba\(59, 111, 219, 1\.000\)/);
    expect(high.foreground).toBe("inverse");
  });

  test("单色色阶翻转后最大值最淡", () => {
    const flipped = { ...mono, flipped: true };
    expect(shadeCell(100, "headcount", flipped, false)!.background).toContain("0.050");
  });

  test("单色色阶在暗色主题下使用该系列色的暗色值", () => {
    const dark = shadeCell(100, "headcount", mono, true)!;
    expect(dark.background).toContain("91, 141, 239");
  });

  test("双向色阶的下限、中点、上限对应三段颜色，中间线性插值", () => {
    const diverging = compileTableShading({ palette: "red_blue" }, columns, rows, measureKeys);
    expect(shadeCell(20, "headcount", diverging, false)!.background).toBe("rgb(242, 84, 148)");
    expect(shadeCell(60, "headcount", diverging, false)!.background).toBe("rgb(247, 229, 255)");
    expect(shadeCell(100, "headcount", diverging, false)!.background).toBe("rgb(145, 161, 255)");
    expect(shadeCell(80, "headcount", diverging, false)!.background).toBe("rgb(196, 195, 255)");
  });

  test("超出刻度的值按端点着色，非数值和无刻度的键不着色", () => {
    expect(shadeCell(1000, "headcount", mono, false)!.background).toContain("1.000");
    expect(shadeCell("研发", "org", mono, false)).toBeUndefined();
    expect(shadeCell(3, "org", mono, false)).toBeUndefined();
    expect(shadeCell(null, "headcount", mono, false)).toBeUndefined();
  });
});

describe("表格模型中的着色", () => {
  const view = {
    id: "result",
    columns: ["hr.org", "hr.year", "hr.headcount"],
    column_roles: { "hr.org": "dimension", "hr.year": "time", "hr.headcount": "measure" },
    rows: [
      ["研发", 2025, 100],
      ["研发", 2026, 120],
      ["市场", 2025, 20],
      ["市场", 2026, 30],
    ],
    summary: { label: "总体", rows: [["总体", 2025, 999]] },
    row_count: 4,
    query_notes: [],
  } as unknown as ViewBlock;
  const titleOf = (column: string) => column;

  test("设置面板的默认刻度取指标列的数据极值，不含总计行，格式与小数位沿用指标列", () => {
    expect(tableShadingDefaults(view)).toEqual({
      scale: { min: 20, mid: 70, max: 120 },
      format: "number",
      decimals: 1,
    });
    const rated = {
      ...view,
      column_formats: { "hr.headcount": "percent" },
      column_decimals: { "hr.headcount": 0 },
    } as unknown as ViewBlock;
    expect(tableShadingDefaults(rated)).toMatchObject({ format: "percent", decimals: 0 });
    expect(tableShadingDefaults({ ...view, rows: [] } as unknown as ViewBlock)).toBeNull();
  });

  test("声明了着色的 table 才带刻度，刻度只算指标列、不含总计行", () => {
    const shaded = compileTableWithStatus(view, titleOf, {
      type: "table",
      shading: { palette: BLUE },
    });
    expect(shaded.table.shading?.scales).toEqual({
      "hr.headcount": { min: 20, mid: 70, max: 120 },
    });
    const plain = compileTableWithStatus(view, titleOf, { type: "table" });
    expect(plain.table.shading).toBeUndefined();
  });

  test("交叉表的值列沿用度量键，同一指标的多列共用一个刻度", () => {
    const crosstab = compileTableWithStatus(view, titleOf, {
      type: "table",
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "year" }],
      shading: { palette: "red_blue" },
    });
    expect(crosstab.table.columns.map((column) => column.formatKey)).toEqual([
      "hr.org",
      "hr.headcount",
      "hr.headcount",
    ]);
    expect(crosstab.table.shading?.scales).toEqual({
      "hr.headcount": { min: 20, mid: 70, max: 120 },
    });
  });
});
