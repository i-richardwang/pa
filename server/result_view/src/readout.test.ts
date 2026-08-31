/**
 * 指针落格 → 读数行：行只出自图例单元，占比与差值只做一步呈现算术。
 */
import { expect, test } from "bun:test";
import { legendShares, readoutModel } from "./readout.js";
import type {
  ChartLegendItem,
  ChartModel,
  ViewChart,
} from "../../src/presentation_core/chart_config.js";

function cartesian(
  legend: ChartLegendItem[],
  extras: Partial<ChartModel> = {},
  categories = ["研发", "市场"],
): ViewChart {
  return {
    form: "bar",
    height: 300,
    option: {},
    model: { categories, legend, axes: {}, pointer: "axis", ...extras },
  };
}

const count = (name: string, values: (number | null)[], extra: Partial<ChartLegendItem> = {}) =>
  ({ name, color: "#3b6fdb", format: "number", values, axis: 0, ...extra }) as ChartLegendItem;

test("抬头取类目名，逐单元成行，格式与位数随单元声明", () => {
  const chart = cartesian([
    count("在职人数", [1200, 45]),
    {
      name: "完成率",
      color: "#e0857a",
      format: "percent",
      decimals: 0,
      values: [0.2349, 0.5],
      axis: 1,
    },
  ]);
  const model = readoutModel(chart, 0);
  expect(model.header).toBe("研发");
  expect(model.rows).toEqual([
    { series: 0, color: "#3b6fdb", name: "在职人数", value: "1,200" },
    { series: 1, color: "#e0857a", name: "完成率", value: "23%" },
  ]);
  expect(readoutModel(chart, 1).header).toBe("市场");
  expect(readoutModel(chart, 1).rows[0].value).toBe("45");
});

test("空格读破折号，不印 0 也不省略这一行", () => {
  const chart = cartesian([count("在职人数", [null, 45])]);
  expect(readoutModel(chart, 0).rows[0].value).toBe("—");
});

test("结构占比随卡附一行，只在这一格有占比时出现", () => {
  const chart = cartesian([count("在职人数", [1200, 45])], {
    share: { title: "占比", values: [0.62, null] },
  });
  expect(readoutModel(chart, 0).rows.at(-1)).toEqual({ name: "占比", value: "62.0%" });
  expect(readoutModel(chart, 1).rows).toHaveLength(1);
});

test("同期叠加只展示服务端交付的变化值：量为相对变化率，率为百分点", () => {
  const overlay = (format: "number" | "percent", values: number[][], comparisonValues: number[]) =>
    cartesian([
      { name: "2026 年", color: "#3b6fdb", format, values: values[0], axis: 0 },
      {
        name: "2025 年",
        color: "#e0857a",
        format,
        values: values[1],
        axis: 0,
        comparison: {
          values: comparisonValues,
          format: format === "percent" ? "percentage_point" : "percent",
          ...(format === "percent" ? { decimals: 1 } : {}),
        },
        ...(format === "percent" ? { decimals: 1 } : {}),
      },
    ]);
  const counts = readoutModel(
    overlay(
      "number",
      [
        [1200, 45],
        [1000, 60],
      ],
      [0.2, -0.25],
    ),
    0,
  );
  // 主期没有对照；对照期附带“主期较该期”的服务端变化值。
  expect(counts.rows[0].delta).toBeUndefined();
  expect(counts.rows[1].delta).toBe("+20.0%");

  const rates = readoutModel(
    overlay(
      "percent",
      [
        [0.12, 0.2],
        [0.095, 0.2],
      ],
      [0.025, 0],
    ),
    0,
  );
  expect(rates.rows[1].delta).toBe("+2.5 pp");
  const down = readoutModel(
    overlay(
      "number",
      [
        [1000, 45],
        [1200, 60],
      ],
      [-1 / 6, -0.25],
    ),
    0,
  );
  expect(down.rows[1].delta).toBe("-16.7%");
});

test("对照期缺一头就不给差值：只有一个数时减不出变化", () => {
  const chart = cartesian([
    count("2026 年", [null, 45]),
    count("2025 年", [1000, 60], {
      color: "#e0857a",
      comparison: { values: [null, -0.25], format: "percent" },
    }),
  ]);
  expect(readoutModel(chart, 0).rows[1].delta).toBeUndefined();
});

test("饼图一卡列齐全部切片，各带占比，抬头是度量名；指到哪一片都是同一张表", () => {
  const chart: ViewChart = {
    form: "pie",
    height: 300,
    option: {},
    model: {
      categories: ["在职人数"],
      legend: [
        count("研发", [60], { share: 0.6 }),
        count("市场", [40], { color: "#e0857a", share: 0.4 }),
      ],
      axes: {},
      total: { value: 100, format: "number" },
      pointer: "item",
    },
  };
  const rows = [
    { series: 0, color: "#3b6fdb", name: "研发", value: "60", secondary: "60.0%" },
    { series: 1, color: "#e0857a", name: "市场", value: "40", secondary: "40.0%" },
  ];
  expect(readoutModel(chart, 1)).toEqual({ header: "在职人数", rows });
  expect(readoutModel(chart, 0)).toEqual({ header: "在职人数", rows });
  // 读数条的占比列与卡内占比是同一份算术
  expect(legendShares(chart.model)).toEqual(["60.0%", "40.0%"]);
});

test("行带得出下钻投影：钉住后点行开的就是这一格", () => {
  const chart = cartesian([count("在职人数", [1200, 45])], {
    records: { points: [[{ row: 7, column: "hr.active_employee_count" }, null]] },
  });
  expect(readoutModel(chart, 0).rows[0].point).toEqual({
    row: 7,
    column: "hr.active_employee_count",
  });
  // 没有投影的格不可点，卡片据此不画成可点的样子
  expect(readoutModel(chart, 1).rows[0].point).toBeUndefined();
});
