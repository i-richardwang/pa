import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TextMarkdown } from "./text_markdown.js";

const html = (md: string) => renderToStaticMarkup(<TextMarkdown md={md} />);

test("XSS：<script> 不产可执行脚本元素，转义为文本", () => {
  const out = html("正文\n\n<script>alert(1)</script>");
  expect(out).not.toContain("<script");
  expect(out).toContain("&lt;script&gt;");
});

test("XSS：<img onerror> 不落地为带事件处理器的图片元素", () => {
  const out = html('<img src=x onerror="alert(1)">');
  expect(out).not.toContain("<img");
  expect(out).not.toContain('onerror="');
  expect(out).toContain("&lt;img");
});

test("XSS：javascript: 链接被 urlTransform 净化，不落 href", () => {
  const out = html("[点我](javascript:alert(1))");
  expect(out).not.toContain("javascript:alert");
});

test("gfm：标题/列表/加粗/链接正确渲染，链接新窗口 + noopener", () => {
  const out = html("# 标题\n\n- 甲\n- 乙\n\n**粗** 与 [x](https://example.com)");
  // 题级下沉两档：瓦片之上还有看板的页级标题，md 的 `#` 不许在这里再发一个
  expect(out).toContain("<h3");
  expect(out).not.toContain("<h1");
  expect(out).toContain("<li");
  expect(out).toContain("<strong");
  expect(out).toContain('href="https://example.com"');
  expect(out).toContain('target="_blank"');
  expect(out).toContain('rel="noopener noreferrer"');
});

test("gfm：表格渲染为 table 结构", () => {
  const out = html("| 组织 | 人数 |\n| --- | --- |\n| A | 10 |");
  expect(out).toContain("<table");
  expect(out).toContain("<th");
  expect(out).toContain("<td");
});

test("空 md 查看态渲染淡提示，不抛错", () => {
  expect(html("   ")).toContain("（空文本）");
});
