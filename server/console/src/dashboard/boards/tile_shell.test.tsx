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

test("题名高于正文一档、字重更轻——它是瓦片的名字不是格内标注", () => {
  const head = markup().match(/<span class="[^"]*truncate[^"]*"/)?.[0] ?? "";
  expect(head).toContain("text-base");
  expect(head).toContain("font-medium");
  expect(head).not.toContain("font-semibold");
});

/** Tailwind 间距刻度：1 = 4px。 */
const px = (cls: string, prefix: string) =>
  Number(new RegExp(`\\b${prefix}-(\\d+)\\b`).exec(cls)?.[1] ?? Number.NaN) * 4;

test("题头与正文共用同一圈衬垫，缝不窄于内衬", () => {
  const html = markup();
  const header = html.match(/<header class="([^"]*)"/)?.[1] ?? "";
  const body = html.match(/<div class="([^"]*flex-1 flex-col[^"]*)"/)?.[1] ?? "";
  // 一圈衬垫，两处引用：题名与正文落在同一条竖线上
  expect(px(header, "px"), "题头衬垫没量到").toBeGreaterThan(0);
  expect(px(body, "px")).toBe(px(header, "px"));
  expect(GRID_MARGIN[0]).toBeGreaterThanOrEqual(px(body, "px"));
  expect(GRID_MARGIN[1]).toBeGreaterThanOrEqual(px(body, "pb"));
  expect(MOBILE_GRID_MARGIN[1]).toBeGreaterThanOrEqual(px(body, "pb"));
});

test("题行高度钉死：槽里装什么都不改题名的基线", () => {
  const header = (actions?: boolean) => markup(actions).match(/<header class="([^"]*)"/)?.[1] ?? "";
  expect(header(), "题头没找到，下面几条落空").not.toBe("");
  // 有槽无槽同一串类：高度是常量，不由内容撑
  expect(header(true)).toBe(header());
  expect(header()).toContain("h-12");
  expect(header()).not.toMatch(/\b(?:py|pt|pb)-/);
});

test("动作槽恒占位但不撑高题行——查看态 hover 才显形", () => {
  const html = markup(true);
  expect(html).toContain("group-hover:opacity-100");
  expect(markup()).not.toContain("group-hover:opacity-100");
});
