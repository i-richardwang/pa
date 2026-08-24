/**
 * 读数卡版式：壳取令牌源、单读数与多系列两种版式、行多了横向分栏；
 * 钉住档出关闭钮且行可点，未钉住时整张不可命中。
 */
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

test("壳只取令牌源那一张玻璃面，模糊降一档，卡片不自带底色与投影", () => {
  const html = card({ header: "2026-07", rows: rows(2) });
  expect(html).toContain("pa-popup-surface pa-popup-surface-card");
  expect(html).not.toContain("bg-pa-glass");
  expect(html).not.toContain("shadow-");
});

test("单读数排成值大名小，多系列排成名左值右", () => {
  const sole = card({ header: "2026-07", rows: rows(1) });
  // 值 18px 主行 + 名次行：只有一个数时先读到的是数
  expect(sole).toContain("text-lg");
  expect(sole).toContain("text-pa-faint");
  expect(sole).not.toContain("min-content");
  // 点跟着值那一档落下来，与逐行那一档不同高
  expect(sole).toContain(chartMarkerClass("lead"));

  const many = card({ header: "2026-07", rows: rows(2) });
  expect(many).toContain("grid-cols-[12px_1fr_min-content]");
  expect(many).not.toContain("text-lg");
  expect(many).toContain("text-pa-muted");
  expect(many).toContain(chartMarkerClass("row"));
});

test("行数按 17 行一栏横向分档，至多四栏，栏宽随栏数成档", () => {
  const columnsOf = (count: number) =>
    card({ header: "2026-07", rows: rows(count) }).match(/grid-cols-(\d)\b/)?.[1] ?? "1";
  expect(columnsOf(17)).toBe("1");
  expect(columnsOf(18)).toBe("2");
  expect(columnsOf(35)).toBe("3");
  // 封顶：再多也不横着长，否则卡片宽过画布
  expect(columnsOf(200)).toBe("4");

  expect(card({ header: "", rows: rows(2) })).toContain("max-w-[300px]");
  expect(card({ header: "", rows: rows(18) })).toContain("max-w-[500px]");
});

test("抬头空着就不占那一行", () => {
  expect(card({ header: "", rows: rows(2) })).not.toContain("pt-3");
});

test("占比与差值同占值下方那一行，恒中性色", () => {
  const html = card({
    header: "2026-07",
    rows: [{ series: 0, color: "#3b6fdb", name: "2025 年", value: "1,000", delta: "-200" }],
  });
  expect(html).toContain("-200");
  // 差值染色会把流失类指标读反：卡内只有中性那一档
  expect(html).not.toContain("text-pa-success");
  expect(html).not.toContain("text-pa-danger");
});

test("钉住才出关闭钮，也才画得出可点的行", () => {
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

test("没有下钻投影的行不画成可点的样子", () => {
  const html = card(
    { header: "2026-07", rows: [{ series: 0, name: "占比", value: "62.0%" }] },
    { pinned: true, onRowClick: () => {} },
  );
  expect(html).not.toContain("cursor-pointer");
});

test("宿主说这一格开不出明细，行就不画成可点的样子", () => {
  const model: ReadoutModel = {
    header: "2026-07",
    rows: [
      { series: 0, name: "敬业度得分", value: "4.0", point: { row: 3, column: "survey.q12" } },
    ],
  };
  const props = { pinned: true, onRowClick: () => {} };
  expect(card(model, { ...props, canOpenRow: () => true })).toContain("cursor-pointer");
  // 画成可点却点不开，比不给这一下更难读
  expect(card(model, { ...props, canOpenRow: () => false })).not.toContain("cursor-pointer");
});
