import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingMark, type LoadingMarkSize } from "./loading_mark.js";

const SIZES: LoadingMarkSize[] = ["default", "small"];

const statusRegions = (html: string) => [...html.matchAll(/role="status"/g)].length;
const bars = (html: string) => [...html.matchAll(/class="pa-loader-bar"/g)].length;

test("标记自己就是状态区，且一个字都不印在屏幕上", () => {
  for (const size of SIZES) {
    const html = renderToStaticMarkup(<LoadingMark size={size} />);
    expect(statusRegions(html), `${size} 这一档没了状态区`).toBe(1);
    expect(html, `${size} 这一档的状态区没有名字`).toContain('aria-label="正在加载"');
    expect(html.replace(/<[^>]*>/g, "").trim(), `${size} 标记印了文字`).toBe("");
    expect(bars(html), `${size} 这一档不是四根条`).toBe(4);
  }
  expect(statusRegions('<div role="status"></div><div role="status"></div>')).toBe(2);
  expect(bars("")).toBe(0);
});

test("加载条使用错相动画延迟", () => {
  const html = renderToStaticMarkup(<LoadingMark />);
  const delays = [...html.matchAll(/animation-delay:\s*(-?[\d.]+)s/g)].map((m) => m[1]);
  expect(delays).toEqual(["-0.1", "-0.2", "-0.3", "-0.4"]);
});

test("窄场地走小档：标记按场地换号，而不是按内容形状换形", () => {
  const wide = renderToStaticMarkup(<LoadingMark />);
  const narrow = renderToStaticMarkup(<LoadingMark size="small" />);
  expect(wide).toContain("height:18px");
  expect(narrow).toContain("height:11px");
  expect(wide.replace(/18px/g, "").replace(/3px/g, "")).toBe(
    narrow.replace(/11px/g, "").replace(/2px/g, ""),
  );
});

test("高度归宿主：本件只把标记摆在给定场地的正中，不自己定高", () => {
  expect(renderToStaticMarkup(<LoadingMark className="py-16" />)).toContain("py-16");
  expect(renderToStaticMarkup(<LoadingMark />)).not.toMatch(/\bpy-|\bh-\d|min-h-/);
});

test("装饰态不声明状态区且继承宿主字色", () => {
  const html = renderToStaticMarkup(<LoadingMark decorative />);
  expect(statusRegions(html), "钮自己有名字，标记再认领一次就是念两遍").toBe(0);
  expect(html, "装饰档不该留下名字").not.toContain("aria-label");
  expect(html).toContain('aria-hidden="true"');
  expect(html, "装饰档要随宿主字色，而不是恒定的 20% 墨").toContain("color:currentColor");
  expect(bars(html)).toBe(4);
  expect(statusRegions(renderToStaticMarkup(<LoadingMark />))).toBe(1);
});

test("自定义 label 覆盖状态区名称", () => {
  const html = renderToStaticMarkup(<LoadingMark label="正在预览" />);
  expect(statusRegions(html)).toBe(1);
  expect(html).toContain('aria-label="正在预览"');
  expect(renderToStaticMarkup(<LoadingMark />)).toContain('aria-label="正在加载"');
});
