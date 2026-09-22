import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartStage } from "./chart_stage";

test("stage renders a result slot with no border of its own", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).toContain('data-slot="chart-stage-result"');
  const slot = html.match(/class="([^"]*)"[^>]*data-slot="chart-stage-result"/)?.[1] ?? "";
  expect(slot, "结果区那一层没找到，断言失去着力点").not.toBe("");
  expect(slot).not.toContain("border");
  expect(html).not.toContain("chart-stage-aside");
  expect(html).not.toContain("--pa-stage-aside");
});

test("stage carries no titlebar of its own — the shell one holds crumb and actions", () => {
  const html = renderToStaticMarkup(<ChartStage>图</ChartStage>);

  expect(html).not.toContain("--pa-titlebar");
  expect(html).not.toContain('data-slot="titlebar"');
});
