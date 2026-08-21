/**
 * 钮的 loading 态：守它**换掉的是记号不是结构**——文字抹掉、标记叠在原位、随钮的字色走，
 * 且这次等待只被念一遍（钮自己有 `aria-disabled`，标记闭嘴）。
 * 尺寸档到缩放档的映射也在这里钉住：小钮塞进原尺寸的标记会顶破 24px 的行高。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button.js";

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

test("loading 按钮显示标记并隐藏文本", () => {
  const html = render(<Button loading>保存</Button>);
  expect(html, "标记没进来").toContain('data-slot="loading-mark"');
  expect(html, "文字该被抹成透明留住宽度，而不是抽走").toContain("data-loading:text-transparent");
  expect(html).toContain("保存");
  expect(html, "钮已经用 aria-disabled 说了在办事").toContain('aria-disabled="true"');
  expect(html, "标记在钮里不认领状态区").not.toContain('role="status"');
  expect(html, "标记随钮的字色，不用区域档那档恒定的墨").toContain("color:currentColor");

  const idle = render(<Button>保存</Button>);
  expect(idle).not.toContain('data-slot="loading-mark"');
  expect(idle).not.toContain("aria-disabled");
});

test("标记按钮的尺寸档缩放：矮钮用更小的那一档", () => {
  for (const size of ["lg"] as const) {
    expect(render(<Button loading size={size} />), `${size} 档没走大缩放`).toContain("scale-75");
  }
  for (const size of ["default", "compact", "icon", "icon-sm", "icon-xs"] as const) {
    expect(render(<Button loading size={size} />), `${size} 档没走小缩放`).toContain("scale-[0.6]");
  }
});

test("图标钮两档：壳那一圈整圆，内容里的取基准圆角", () => {
  const shell = render(<Button aria-label="关闭" size="icon" />);
  expect(shell).toContain("rounded-full");
  expect(shell).not.toContain("rounded-md");

  for (const size of ["icon-sm", "icon-xs"] as const) {
    const content = render(<Button aria-label="关闭" size={size} />);
    expect(content, `${size} 档没取基准圆角`).toContain("rounded-md");
    expect(content, `${size} 档不该是整圆`).not.toContain("rounded-full");
  }
});
