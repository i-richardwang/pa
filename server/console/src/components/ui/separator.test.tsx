/**
 * 分隔线的方向选择器必须真的命中 Base UI 发出的属性。选择器接空时整条线渲染成 0×0，
 * 而「看不见的线」与「没有线」在页面上长得一模一样，肉眼验收查不出来。
 *
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Separator } from "./separator";

test("方向选择器与 data-orientation 对得上，横线拿得到高度", () => {
  const markup = renderToStaticMarkup(<Separator />);
  expect(markup).toContain('data-orientation="horizontal"');
  expect(markup).toContain("data-[orientation=horizontal]:h-px");
  // 反向：立起来的那一档同样按 data-orientation 取宽。
  const vertical = renderToStaticMarkup(<Separator orientation="vertical" />);
  expect(vertical).toContain('data-orientation="vertical"');
  expect(vertical).toContain("data-[orientation=vertical]:w-px");
});
