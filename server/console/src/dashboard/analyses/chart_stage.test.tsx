import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartStage } from "./chart_stage";

test("stage renders a result slot with no border of its own", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).toContain('data-slot="chart-stage-result"');
  const slot = html.match(/class="([^"]*)"[^>]*data-slot="chart-stage-result"/)?.[1] ?? "";
  expect(slot, "没有找到结果区域元素").not.toBe("");
  expect(slot).not.toContain("border");
  expect(html).not.toContain("chart-stage-aside");
  expect(html).not.toContain("--pa-stage-aside");
});

test("stage renders no titlebar; the app titlebar holds crumb and actions", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).not.toContain("--pa-titlebar");
  expect(html).not.toContain('data-slot="titlebar"');
});
