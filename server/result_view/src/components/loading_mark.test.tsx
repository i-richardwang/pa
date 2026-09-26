import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingMark, type LoadingMarkSize } from "./loading_mark.js";

const SIZES: LoadingMarkSize[] = ["default", "small"];

const statusRegions = (html: string) => [...html.matchAll(/role="status"/g)].length;
const bars = (html: string) => [...html.matchAll(/class="pa-loader-bar"/g)].length;

test("加载标记本身是 role=status 区域，屏幕上不显示文字", () => {
  for (const size of SIZES) {
    const html = renderToStaticMarkup(<LoadingMark size={size} />);
    expect(statusRegions(html), `${size} 尺寸缺少 role="status" 区域`).toBe(1);
    expect(html, `${size} 尺寸的状态区域缺少 aria-label`).toContain('aria-label="正在加载"');
    expect(html.replace(/<[^>]*>/g, "").trim(), `${size} 尺寸的加载标记不应显示文字`).toBe("");
    expect(bars(html), `${size} 尺寸应有四根竖条`).toBe(4);
  }
  expect(statusRegions('<div role="status"></div><div role="status"></div>')).toBe(2);
  expect(bars("")).toBe(0);
});

test("加载条的动画延迟依次错开", () => {
  const html = renderToStaticMarkup(<LoadingMark />);
  const delays = [...html.matchAll(/animation-delay:\s*(-?[\d.]+)s/g)].map((m) => m[1]);
  expect(delays).toEqual(["-0.1", "-0.2", "-0.3", "-0.4"]);
});

test("空间较小时使用 small 尺寸", () => {
  const wide = renderToStaticMarkup(<LoadingMark />);
  const narrow = renderToStaticMarkup(<LoadingMark size="small" />);
  expect(wide).toContain("height:18px");
  expect(narrow).toContain("height:11px");
  expect(wide.replace(/18px/g, "").replace(/3px/g, "")).toBe(
    narrow.replace(/11px/g, "").replace(/2px/g, ""),
  );
});

test("组件不设高度，只在宿主给定的区域内居中", () => {
  expect(renderToStaticMarkup(<LoadingMark className="py-16" />)).toContain("py-16");
  expect(renderToStaticMarkup(<LoadingMark />)).not.toMatch(/\bpy-|\bh-\d|min-h-/);
});

test("装饰模式不是状态区域，颜色继承宿主", () => {
  const html = renderToStaticMarkup(<LoadingMark decorative />);
  expect(statusRegions(html), "装饰模式不应再设状态区域，否则读屏器会读两遍").toBe(0);
  expect(html, "装饰模式不应设 aria-label").not.toContain("aria-label");
  expect(html).toContain('aria-hidden="true"');
  expect(html, "装饰模式应使用当前文字颜色").toContain("color:currentColor");
  expect(bars(html)).toBe(4);
  expect(statusRegions(renderToStaticMarkup(<LoadingMark />))).toBe(1);
});

test("自定义 label 覆盖默认的状态名称", () => {
  const html = renderToStaticMarkup(<LoadingMark label="正在预览" />);
  expect(statusRegions(html)).toBe(1);
  expect(html).toContain('aria-label="正在预览"');
  expect(renderToStaticMarkup(<LoadingMark />)).toContain('aria-label="正在加载"');
});
