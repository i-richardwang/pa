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

test("文本瓦片正文不叠第二道衬垫", () => {
  const html = renderToStaticMarkup(
    <TextTile md="**说明**" editing={false} interacting={false} onChangeMd={() => {}} />,
  );
  const content = contentTag(html);
  expect(content, "没定位到文本瓦片自己那层，下面那条落空").not.toBe("");
  expect(content).toContain("overflow-auto");
  expect(padding(content), "文本瓦片自带了衬垫，左缘会比同排的报告瓦片深一档").toEqual([]);
  expect(padding('<div class="min-h-0 flex-1 overflow-auto px-3 pb-3">')).toEqual(["px-3", "pb-3"]);
});
