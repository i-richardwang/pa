/** 选择器接空时线渲染成 0×0，与没有线肉眼无差。 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Separator } from "./separator";

test("方向选择器与 data-orientation 对得上，横线拿得到高度", () => {
  const markup = renderToStaticMarkup(<Separator />);
  expect(markup).toContain('data-orientation="horizontal"');
  expect(markup).toContain("data-[orientation=horizontal]:h-px");
  const vertical = renderToStaticMarkup(<Separator orientation="vertical" />);
  expect(vertical).toContain('data-orientation="vertical"');
  expect(vertical).toContain("data-[orientation=vertical]:w-px");
});
