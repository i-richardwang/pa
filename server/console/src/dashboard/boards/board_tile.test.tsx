import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingMark } from "pa-result-view";
import { TileError } from "./board_tile";

const padding = (tag: string) =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .split(/\s+/)
    .filter((name) => /^p[xytblrse]?-/.test(name));

const rootTag = (html: string) => html.match(/<div[^>]*>/)?.[0] ?? "";

test("错误状态不带内边距，撑满内容区并垂直居中", () => {
  const root = rootTag(renderToStaticMarkup(<TileError message="Cube 暂不可用" />));
  expect(root, "没有找到错误状态的根元素").not.toBe("");
  expect(padding(root), "错误状态带了内边距，会比其他状态更靠内").toEqual([]);
  expect(root).toContain("flex-1");
  expect(root).toContain("justify-center");
  expect(padding('<div class="p-3">')).toEqual(["p-3"]);
});

test("加载标记与错误状态一样不带内边距", () => {
  const loader = rootTag(renderToStaticMarkup(<LoadingMark size="small" />));
  expect(loader, "没有找到加载标记的根元素").not.toBe("");
  expect(padding(loader)).toEqual([]);
  expect(loader).toContain("h-full");
});
