/**
 * 舞台几何归属：
 *
 * 1. 右栏抬到壳层后，宽度常量仍由本件导出——壳读同一数字下发；只断言常量可防漂移，
 *    真正 DOM 归属见 shell 的 `chart-stage-aside`。
 * 2. 结果区恒在，且不画自己的框——框只圈绘图区，由图自己画（见 ui_spec「图表画布」节）。
 * 3. 本件是主列骨架：不出题条、不渲染右栏。
 *
 * headless 直渲（renderToStaticMarkup），不需 DOM/testing-library。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CHART_STAGE_ASIDE_WIDTH, ChartStage } from "./chart_stage";

test("配置栏宽度常量是右栏几何的唯一出处", () => {
  expect(CHART_STAGE_ASIDE_WIDTH).toBe(320);
});

test("stage renders a result slot with no border of its own", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).toContain('data-slot="chart-stage-result"');
  // 结果区不自带外框：边框一旦回到这里，图自己那圈就成了第二层
  const slot = html.match(/class="([^"]*)"[^>]*data-slot="chart-stage-result"/)?.[1] ?? "";
  expect(slot, "结果区那一层没找到，断言失去着力点").not.toBe("");
  expect(slot).not.toContain("border");
  expect(html).not.toContain("chart-stage-aside");
  expect(html).not.toContain("--pa-stage-aside");
});

/** 定位与页级动作住壳 titlebar；本断言确认舞台不自带题条。 */
test("stage carries no titlebar of its own — the shell one holds crumb and actions", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).not.toContain("--pa-titlebar");
  expect(html).not.toContain('data-slot="titlebar"');
});
