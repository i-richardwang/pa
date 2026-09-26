import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button.js";

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

test("loading 按钮显示标记并隐藏文本", () => {
  const html = render(<Button loading>保存</Button>);
  expect(html, "加载中的按钮应包含加载标记").toContain('data-slot="loading-mark"');
  expect(html, "加载时文字应变为透明以保持按钮宽度，而不是移除").toContain(
    "data-loading:text-transparent",
  );
  expect(html).toContain("保存");
  expect(html, "加载中的按钮应设 aria-disabled").toContain('aria-disabled="true"');
  expect(html, "按钮内的加载标记不应设 role=status").not.toContain('role="status"');
  expect(html, "按钮内的加载标记应使用按钮文字颜色").toContain("color:currentColor");

  const idle = render(<Button>保存</Button>);
  expect(idle).not.toContain('data-slot="loading-mark"');
  expect(idle).not.toContain("aria-disabled");
});

test("加载标记按按钮尺寸缩放：lg 用 scale-75，其余尺寸用 scale-[0.6]", () => {
  for (const size of ["lg"] as const) {
    expect(
      render(<Button loading size={size} />),
      `${size} 尺寸的加载标记应使用 scale-75`,
    ).toContain("scale-75");
  }
  for (const size of ["default", "compact", "icon", "icon-sm", "icon-xs"] as const) {
    expect(
      render(<Button loading size={size} />),
      `${size} 尺寸的加载标记应使用 scale-[0.6]`,
    ).toContain("scale-[0.6]");
  }
});

test("icon 尺寸为整圆，icon-sm 与 icon-xs 使用基准圆角", () => {
  const shell = render(<Button aria-label="关闭" size="icon" />);
  expect(shell).toContain("rounded-full");
  expect(shell).not.toContain("rounded-md");

  for (const size of ["icon-sm", "icon-xs"] as const) {
    const content = render(<Button aria-label="关闭" size={size} />);
    expect(content, `${size} 尺寸应使用 rounded-md`).toContain("rounded-md");
    expect(content, `${size} 尺寸不应是正圆`).not.toContain("rounded-full");
  }
});
