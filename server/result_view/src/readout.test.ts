/**
 * 读数模型单测：指针落在一格上，卡片该印哪几行。
 *
 * 行只出自画面上真实存在的那些点——垫层不算一条读数，占比与差值是那两个点之间的一步，
 * 不回头找明细。差值恒带符号、恒中性，与整窗读数的注脚同一套读法。
 */
import { expect, test } from "bun:test";
import { readoutModel } from "./readout.js";
import type { PaChartExtension, ViewChart } from "../../src/presentation_core/chart_config.js";

function barChart(pa: Partial<PaChartExtension>, series: Record<string, unknown>[]): ViewChart {
  return {
    form: "bar",
    height: 300,
    option: {
      xAxis: { type: "category", data: ["研发", "市场"] },
      yAxis: { type: "value" },
      series,
      pa: { series: {}, axes: {}, ...pa } as PaChartExtension,
    },
  };
}

test("抬头取类目名，逐系列成行，格式与位数随列声明", () => {
  const chart = barChart(
    {
      series: { 在职人数: "number", 完成率: "percent" },
      decimals: { 完成率: 0 },
      legend: [
        { name: "在职人数", color: "#3b6fdb" },
        { name: "完成率", color: "#e0857a" },
      ],
    },
    [
      { type: "bar", name: "在职人数", data: [1200, 45] },
      { type: "line", name: "完成率", data: [0.2349, 0.5] },
    ],
  );
  const model = readoutModel(chart, 0);
  expect(model?.header).toBe("研发");
  expect(model?.rows).toEqual([
    { series: 0, color: "#3b6fdb", name: "在职人数", value: "1,200" },
    { series: 1, color: "#e0857a", name: "完成率", value: "23%" },
  ]);
  // 第二格读的是第二格，不是恒读首格
  expect(readoutModel(chart, 1)?.header).toBe("市场");
  expect(readoutModel(chart, 1)?.rows[0].value).toBe("45");
});

test("类目名取自类目轴：横排条的类目在左轴", () => {
  const chart: ViewChart = {
    form: "bar",
    height: 300,
    option: {
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ["研发", "市场"] },
      series: [{ type: "bar", name: "在职人数", data: [1200, 45] }],
      pa: {
        series: { 在职人数: "number" },
        axes: {},
        legend: [{ name: "在职人数", color: "#3b6fdb" }],
      } satisfies PaChartExtension,
    },
  };
  expect(readoutModel(chart, 1)?.header).toBe("市场");
});

test("垫层不是第二条读数：只取图例点过名的那几条", () => {
  const chart = barChart(
    { series: { 在职人数: "number" }, legend: [{ name: "在职人数", color: "#3b6fdb" }] },
    [
      { type: "line", name: "在职人数", data: [1200, 45] },
      { type: "line", name: "在职人数", data: [1200, 45] },
    ],
  );
  expect(readoutModel(chart, 0)?.rows).toHaveLength(1);
});

test("空格读破折号，不印 0 也不省略这一行", () => {
  const chart = barChart(
    { series: { 在职人数: "number" }, legend: [{ name: "在职人数", color: "#3b6fdb" }] },
    [{ type: "bar", name: "在职人数", data: [null, 45] }],
  );
  expect(readoutModel(chart, 0)?.rows[0].value).toBe("—");
});

test("结构占比随卡附一行，只在这一格有占比时出现", () => {
  const chart = barChart(
    {
      series: { 在职人数: "number" },
      legend: [{ name: "在职人数", color: "#3b6fdb" }],
      share: { title: "占比", values: { 研发: 0.62, 市场: null } },
    },
    [{ type: "bar", name: "在职人数", data: [1200, 45] }],
  );
  expect(readoutModel(chart, 0)?.rows.at(-1)).toEqual({ name: "占比", value: "62.0%" });
  expect(readoutModel(chart, 1)?.rows).toHaveLength(1);
});

test("同期叠加按声明的对照关系读差值：量作差仍是量，率作差是百分点", () => {
  const overlay = (format: "number" | "percent", values: number[][]) =>
    barChart(
      {
        series: { "2026 年": format, "2025 年": format },
        decimals: format === "percent" ? { "2026 年": 1, "2025 年": 1 } : undefined,
        legend: [
          { name: "2026 年", color: "#3b6fdb" },
          { name: "2025 年", color: "#e0857a", baseline: 0 },
        ],
      },
      [
        { type: "line", name: "2026 年", data: values[0] },
        { type: "line", name: "2025 年", data: values[1] },
      ],
    );
  const counts = readoutModel(
    overlay("number", [
      [1200, 45],
      [1000, 60],
    ]),
    0,
  );
  // 主期没有对照，不带差值；对照期读的是「它自己 − 主期」
  expect(counts?.rows[0].delta).toBeUndefined();
  expect(counts?.rows[1].delta).toBe("-200");

  const rates = readoutModel(
    overlay("percent", [
      [0.12, 0.2],
      [0.095, 0.2],
    ]),
    0,
  );
  expect(rates?.rows[1].delta).toBe("-2.5 pp");
  // 涨也只陈述方向：显式带 +，不换颜色，模型层没有指标方向声明
  const up = readoutModel(
    overlay("number", [
      [1000, 45],
      [1200, 60],
    ]),
    0,
  );
  expect(up?.rows[1].delta).toBe("+200");
});

test("对照期缺一头就不给差值：只有一个数时减不出变化", () => {
  const chart = barChart(
    {
      series: { "2026 年": "number", "2025 年": "number" },
      legend: [
        { name: "2026 年", color: "#3b6fdb" },
        { name: "2025 年", color: "#e0857a", baseline: 0 },
      ],
    },
    [
      { type: "line", name: "2026 年", data: [null, 45] },
      { type: "line", name: "2025 年", data: [1000, 60] },
    ],
  );
  expect(readoutModel(chart, 0)?.rows[1].delta).toBeUndefined();
});

test("饼图一卡列齐全部切片，各带占比，抬头是度量名", () => {
  const chart: ViewChart = {
    form: "pie",
    height: 300,
    option: {
      series: [
        {
          type: "pie",
          name: "在职人数",
          data: [
            { name: "研发", value: 60 },
            { name: "市场", value: 40 },
          ],
        },
      ],
      pa: {
        series: { 在职人数: "number" },
        axes: {},
        legend: [
          { name: "研发", color: "#3b6fdb" },
          { name: "市场", color: "#e0857a" },
        ],
      } satisfies PaChartExtension,
    },
  };
  const model = readoutModel(chart, 1);
  expect(model?.header).toBe("在职人数");
  expect(model?.rows).toEqual([
    { series: 0, color: "#3b6fdb", name: "研发", value: "60", secondary: "60.0%" },
    { series: 1, color: "#e0857a", name: "市场", value: "40", secondary: "40.0%" },
  ]);
});

test("行带得出下钻投影：钉住后点行开的就是这一格", () => {
  const chart = barChart(
    {
      series: { 在职人数: "number" },
      legend: [{ name: "在职人数", color: "#3b6fdb" }],
      records: { points: [[{ row: 7, column: "hr.active_employee_count" }, null]] },
    },
    [{ type: "bar", name: "在职人数", data: [1200, 45] }],
  );
  expect(readoutModel(chart, 0)?.rows[0].point).toEqual({
    row: 7,
    column: "hr.active_employee_count",
  });
  // 没有投影的格不可点，卡片据此不画成可点的样子
  expect(readoutModel(chart, 1)?.rows[0].point).toBeUndefined();
});

test("没有 pa 扩展块就没有读数：图不是本产品编译出来的", () => {
  expect(readoutModel({ form: "bar", height: 300, option: { series: [] } }, 0)).toBeNull();
});
