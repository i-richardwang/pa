import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadoutCard } from "./readout_card.js";
import type { ReadoutModel } from "../readout.js";
import { chartMarkerClass } from "../../../src/presentation_core/chart_config.js";

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    series: i,
    color: "#3b6fdb",
    name: `系列${i}`,
    value: `${i}`,
  }));

const card = (model: ReadoutModel, props: Partial<Parameters<typeof ReadoutCard>[0]> = {}) =>
  renderToStaticMarkup(<ReadoutCard model={model} dark={false} {...props} />);

test("读数卡使用共享浮层背景和卡片档模糊，不另加底色和阴影", () => {
  const html = card({ header: "2026-07", rows: rows(2) });
  expect(html).toContain("pa-popup-surface pa-popup-surface-card");
  expect(html).not.toContain("bg-pa-glass");
  expect(html).not.toContain("shadow-");
});

test("只有一个读数时值大、名称小；多个系列时名称在左、值在右", () => {
  const sole = card({ header: "2026-07", rows: rows(1) });
  // 值用 18px 显示在第一行，名称在第二行
  expect(sole).toContain("text-lg");
  expect(sole).toContain("text-pa-faint");
  expect(sole).not.toContain("min-content");
  // 色点下移得更多，与大号数值的第一行对齐，与多系列行的色点位置不同
  expect(sole).toContain(chartMarkerClass("lead"));

  const many = card({ header: "2026-07", rows: rows(2) });
  expect(many).toContain("grid-cols-[12px_1fr_min-content]");
  expect(many).not.toContain("text-lg");
  expect(many).toContain("text-pa-muted");
  expect(many).toContain(chartMarkerClass("row"));
});

test("每栏 17 行，最多四栏，卡片宽度随栏数变化", () => {
  const columnsOf = (count: number) =>
    card({ header: "2026-07", rows: rows(count) }).match(/grid-cols-(\d)\b/)?.[1] ?? "1";
  expect(columnsOf(17)).toBe("1");
  expect(columnsOf(18)).toBe("2");
  expect(columnsOf(35)).toBe("3");
  // 最多四栏，否则卡片会比绘图区还宽
  expect(columnsOf(200)).toBe("4");

  expect(card({ header: "", rows: rows(2) })).toContain("max-w-[300px]");
  expect(card({ header: "", rows: rows(18) })).toContain("max-w-[500px]");
});

test("没有标题时不渲染标题行", () => {
  expect(card({ header: "", rows: rows(2) })).not.toContain("pt-3");
});

test("占比和差值显示在值下方，使用中性色", () => {
  const html = card({
    header: "2026-07",
    rows: [{ series: 0, color: "#3b6fdb", name: "2025 年", value: "1,000", delta: "-200" }],
  });
  expect(html).toContain("-200");
  // 按涨跌着色会让离职类指标的含义看反，所以统一用中性色
  expect(html).not.toContain("text-pa-success");
  expect(html).not.toContain("text-pa-danger");
});

test("只有钉住后才显示关闭按钮和可点击的行", () => {
  const model: ReadoutModel = {
    header: "2026-07",
    rows: [
      { series: 0, name: "在职人数", value: "1,200", point: { row: 7, column: "hr.headcount" } },
    ],
  };
  const open = () => {};
  const hovering = card(model, { onRowClick: open });
  expect(hovering).not.toContain("关闭读数卡");
  expect(hovering).not.toContain("cursor-pointer");

  const pinned = card(model, { pinned: true, onClose: open, onRowClick: open });
  expect(pinned).toContain("关闭读数卡");
  expect(pinned).toContain("cursor-pointer");
});

test("没有明细的行不显示为可点击", () => {
  const html = card(
    { header: "2026-07", rows: [{ series: 0, name: "占比", value: "62.0%" }] },
    { pinned: true, onRowClick: () => {} },
  );
  expect(html).not.toContain("cursor-pointer");
});

test("宿主判定无法查看明细时，行不显示为可点击", () => {
  const model: ReadoutModel = {
    header: "2026-07",
    rows: [
      { series: 0, name: "敬业度得分", value: "4.0", point: { row: 3, column: "survey.q12" } },
    ],
  };
  const props = { pinned: true, onRowClick: () => {} };
  expect(card(model, { ...props, canOpenRow: () => true })).toContain("cursor-pointer");
  // 看起来可点击却打不开明细，会误导用户
  expect(card(model, { ...props, canOpenRow: () => false })).not.toContain("cursor-pointer");
});
