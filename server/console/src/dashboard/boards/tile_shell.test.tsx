import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TileShell } from "./tile_shell";
import { GRID_MARGIN, MOBILE_GRID_MARGIN } from "./tile_sizing";

const markup = (actions?: boolean) =>
  renderToStaticMarkup(
    <TileShell
      actions={actions ? <button type="button">⋯</button> : undefined}
      title="月度人员基础指标"
    >
      <div>正文</div>
    </TileShell>,
  );

test("瓦片标题字号大于正文，使用中等字重", () => {
  const head = markup().match(/<span class="[^"]*truncate[^"]*"/)?.[0] ?? "";
  expect(head).toContain("text-base");
  expect(head).toContain("font-medium");
  expect(head).not.toContain("font-semibold");
});

/** Tailwind 间距刻度：1 = 4px。 */
const px = (cls: string, prefix: string) =>
  Number(new RegExp(`\\b${prefix}-(\\d+)\\b`).exec(cls)?.[1] ?? Number.NaN) * 4;

test("标题栏与正文水平内边距相同，瓦片间距不小于内边距", () => {
  const html = markup();
  const header = html.match(/<header class="([^"]*)"/)?.[1] ?? "";
  const body = html.match(/<div class="([^"]*flex-1 flex-col[^"]*)"/)?.[1] ?? "";
  expect(px(header, "px"), "没有测到标题栏的水平内边距").toBeGreaterThan(0);
  expect(px(body, "px")).toBe(px(header, "px"));
  expect(GRID_MARGIN[0]).toBeGreaterThanOrEqual(px(body, "px"));
  expect(GRID_MARGIN[1]).toBeGreaterThanOrEqual(px(body, "pb"));
  expect(MOBILE_GRID_MARGIN[1]).toBeGreaterThanOrEqual(px(body, "pb"));
});

test("标题栏高度固定，不受有无操作按钮影响", () => {
  const header = (actions?: boolean) => markup(actions).match(/<header class="([^"]*)"/)?.[1] ?? "";
  expect(header(), "没有找到标题栏").not.toBe("");
  expect(header(true)).toBe(header());
  expect(header()).toContain("h-12");
  expect(header()).not.toMatch(/\b(?:py|pt|pb)-/);
});

test("查看时操作按钮在悬停后显示", () => {
  const html = markup(true);
  expect(html).toContain("group-hover:opacity-100");
  expect(markup()).not.toContain("group-hover:opacity-100");
});
