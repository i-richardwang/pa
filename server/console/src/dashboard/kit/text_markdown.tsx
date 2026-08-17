/**
 * 文本瓦片查看态的 Markdown 渲染：react-markdown + remark-gfm（标题/列表/加粗/链接/代码/表格）。
 * 安全硬约束：不引 rehype-raw、不开 raw HTML——看板分享给成员，创建者的 md 在成员浏览器渲染，
 * 开 raw HTML 即对成员的存储型 XSS。react-markdown 默认不渲染原生 HTML（转义为文本），
 * 默认 urlTransform 净化 URL（挡 javascript:），保持默认即安全。链接一律新窗口 + noopener。
 * 排版走 Tailwind 语义令牌、明暗随宿主，不硬编码颜色；不 import `@/` 别名以便 headless 测试直渲。
 */
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ node: _n, ...p }) => <h3 className="mt-3 mb-1 text-base font-medium first:mt-0" {...p} />,
  h2: ({ node: _n, ...p }) => <h4 className="mt-3 mb-1 text-sm font-medium first:mt-0" {...p} />,
  h3: ({ node: _n, ...p }) => <h5 className="mt-2 mb-1 text-sm font-medium first:mt-0" {...p} />,
  h4: ({ node: _n, ...p }) => <h6 className="mt-2 mb-1 text-sm font-medium first:mt-0" {...p} />,
  p: ({ node: _n, ...p }) => (
    <p className="my-1 text-sm leading-relaxed first:mt-0 last:mb-0" {...p} />
  ),
  ul: ({ node: _n, ...p }) => <ul className="my-1 list-disc pl-5 text-sm" {...p} />,
  ol: ({ node: _n, ...p }) => <ol className="my-1 list-decimal pl-5 text-sm" {...p} />,
  li: ({ node: _n, ...p }) => <li className="my-0.5" {...p} />,
  a: ({ node: _n, ...p }) => (
    <a
      className="text-pa-ink underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  strong: ({ node: _n, ...p }) => <strong className="font-semibold" {...p} />,
  em: ({ node: _n, ...p }) => <em className="italic" {...p} />,
  code: ({ node: _n, ...p }) => (
    <code className="rounded bg-pa-surface px-1 py-0.5 font-mono text-[0.8em]" {...p} />
  ),
  pre: ({ node: _n, ...p }) => (
    <pre
      className="my-2 overflow-x-auto rounded bg-pa-surface p-2 text-xs [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs"
      {...p}
    />
  ),
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="my-2 border-pa-muted/30 border-l-2 pl-3 text-pa-muted" {...p} />
  ),
  table: ({ node: _n, ...p }) => <table className="my-2 w-full border-collapse text-sm" {...p} />,
  th: ({ node: _n, ...p }) => (
    <th className="border-pa-line border px-2 py-1 text-left font-medium" {...p} />
  ),
  td: ({ node: _n, ...p }) => <td className="border-pa-line border px-2 py-1" {...p} />,
  hr: ({ node: _n, ...p }) => <hr className="border-pa-line my-3" {...p} />,
};

export function TextMarkdown({ md }: { md: string }) {
  if (!md.trim()) {
    return <p className="text-pa-muted text-sm italic">（空文本）</p>;
  }
  return (
    <div className="text-pa-fg">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </Markdown>
    </div>
  );
}
