import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingMark } from "pa-result-view";
import { TileError } from "./board_tile";

const padding = (tag: string) =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .split(/\s+/)
    .filter((name) => /^p[xytblrse]?-/.test(name));

const rootTag = (html: string) => html.match(/<div[^>]*>/)?.[0] ?? "";

test("错误态不叠第二道衬垫，且撑满内容区居中", () => {
  const root = rootTag(renderToStaticMarkup(<TileError message="Cube 暂不可用" />));
  expect(root, "错误态根节点没找到，下面几条落空").not.toBe("");
  expect(padding(root), "错误态自带了衬垫，只有它一态向内缩").toEqual([]);
  expect(root).toContain("flex-1");
  expect(root).toContain("justify-center");
  expect(padding('<div class="p-3">')).toEqual(["p-3"]);
});

test("加载标记与错误态同一个起点：都不自带衬垫", () => {
  const loader = rootTag(renderToStaticMarkup(<LoadingMark size="small" />));
  expect(loader, "加载标记根节点没找到").not.toBe("");
  expect(padding(loader)).toEqual([]);
  expect(loader).toContain("h-full");
});
