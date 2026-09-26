import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TextTile } from "./text_tile";

const padding = (tag: string) =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .split(/\s+/)
    .filter((name) => /^p[xytblrse]?-/.test(name));

function contentTag(html: string): string {
  const tags = html.match(/<div[^>]*>/g) ?? [];
  const body = tags.findIndex((t) => t.includes("flex-1") && t.includes("px-"));
  return tags[body + 1] ?? "";
}

test("文本瓦片正文不带内边距", () => {
  const html = renderToStaticMarkup(
    <TextTile md="**说明**" editing={false} onChangeMd={() => {}} />,
  );
  const content = contentTag(html);
  expect(content, "没有找到文本瓦片的内容元素").not.toBe("");
  expect(content).toContain("overflow-auto");
  expect(padding(content), "文本瓦片带了内边距，左边缘会比同一行的报告瓦片更靠内").toEqual([]);
  expect(padding('<div class="min-h-0 flex-1 overflow-auto px-3 pb-3">')).toEqual(["px-3", "pb-3"]);
});
