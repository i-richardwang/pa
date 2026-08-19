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
  test("刻度按指标键各立一把：同键的多列合并取极值，非指标键不立", () => {
    const shading = compileTableShading({ palette: BLUE }, columns, rows, measureKeys);
    expect(shading.scales).toEqual({
      headcount: { min: 20, mid: 60, max: 100 },
      rate: { min: 0.1, mid: 0.3, max: 0.5 },
    });
    expect(shading.values).toBe(true);
    expect(shading.flipped).toBe(false);
  });

  test("声明阈值逐项覆盖，中点缺省取覆盖后两端的中点", () => {
    const shading = compileTableShading(
      { palette: "red_blue", thresholds: { max: 200 } },
      columns,
      rows,
      measureKeys,
    );
    expect(shading.scales.headcount).toEqual({ min: 20, mid: 110, max: 200 });
  });

  test("单个阈值落在数据域外时，自动端点仍包住声明停点", () => {
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

  test("没有任何数值的键不立刻度", () => {
    const shading = compileTableShading(
      { palette: BLUE },
      [{ formatKey: "empty" }],
      [[null], ["—"]],
      new Set(["empty"]),
    );
    expect(shading.scales).toEqual({});
  });

  test("缺省刻度读法取各键刻度的并集，一格数值都没有时为 null", () => {
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

describe("值→色", () => {
  const mono = compileTableShading({ palette: BLUE }, columns, rows, measureKeys);

  test("单色：值越大越浓，极小 0.05、极大 1；字色随底色对比翻转", () => {
    const low = shadeCell(20, "headcount", mono, false)!;
    const high = shadeCell(100, "headcount", mono, false)!;
    expect(low.background).toMatch(/rgba\(59, 111, 219, 0\.050\)/);
    expect(low.foreground).toBe("ink");
    expect(high.background).toMatch(/rgba\(59, 111, 219, 1\.000\)/);
    expect(high.foreground).toBe("inverse");
  });

  test("单色翻转：极大反而最淡", () => {
    const flipped = { ...mono, flipped: true };
    expect(shadeCell(100, "headcount", flipped, false)!.background).toContain("0.050");
  });

  test("单色暗色主题换到该系列色的暗色档", () => {
    const dark = shadeCell(100, "headcount", mono, true)!;
    expect(dark.background).toContain("91, 141, 239");
  });

  test("双向：下限、中点、上限各落在三停上，中间线性插值", () => {
    const diverging = compileTableShading({ palette: "red_blue" }, columns, rows, measureKeys);
    expect(shadeCell(20, "headcount", diverging, false)!.background).toBe("rgb(242, 84, 148)");
    expect(shadeCell(60, "headcount", diverging, false)!.background).toBe("rgb(247, 229, 255)");
    expect(shadeCell(100, "headcount", diverging, false)!.background).toBe("rgb(145, 161, 255)");
    expect(shadeCell(80, "headcount", diverging, false)!.background).toBe("rgb(196, 195, 255)");
  });

  test("刻度外的值贴边不出界；非数、无刻度的键不着色", () => {
    expect(shadeCell(1000, "headcount", mono, false)!.background).toContain("1.000");
    expect(shadeCell("研发", "org", mono, false)).toBeUndefined();
    expect(shadeCell(3, "org", mono, false)).toBeUndefined();
    expect(shadeCell(null, "headcount", mono, false)).toBeUndefined();
  });
});

describe("随表格模型下发", () => {
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

  test("设置面的缺省读法：指标列的数据极值，总体带不参与，格式一致时沿用", () => {
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

  test("只有 table 声明才带刻度；刻度只算指标列、总体带不参与", () => {
    const shaded = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      shading: { palette: BLUE },
    });
    expect(shaded.table.shading?.scales).toEqual({
      "hr.headcount": { min: 20, mid: 70, max: 120 },
    });
    const plain = compileTableWithStatus(view, titleOf, { type: "table", y: [] });
    expect(plain.table.shading).toBeUndefined();
  });

  test("交叉表的值列沿用度量键，同一指标横跨多列共用一把刻度", () => {
    const crosstab = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableLayout: {
        rows: [{ kind: "field", column: "org" }],
        columns: [{ kind: "metrics" }, { kind: "time", level: "year" }],
      },
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
