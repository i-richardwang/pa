/** 右栏密度样式分别挂在栏、段、行三层，缺任何一层都不会报错，只会退回配置栏的默认密度。 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INSPECTOR_ROW_INDENT_CLASS,
  InspectorBody,
  InspectorProfileCard,
  InspectorRow,
  InspectorSection,
} from "./inspector";

const PROFILE = "group-data-[face=profile]/inspector:";
const SETTINGS = "group-data-[face=settings]/inspector:";

test("详情头卡在同一张卡片中显示名称、口径说明和事实行", () => {
  const markup = renderToStaticMarkup(
    <InspectorProfileCard description="按组织分析入离职。" title="人员流动">
      <div>事实行</div>
    </InspectorProfileCard>,
  );
  expect(markup).toContain('data-slot="inspector-profile-card"');
  expect(markup).toContain("人员流动");
  expect(markup).toContain("按组织分析入离职。");
  expect(markup).toContain('data-slot="inspector-profile-facts"');
  expect(renderToStaticMarkup(<InspectorProfileCard description="" title="X" />)).toContain("—");
  expect(renderToStaticMarkup(<InspectorProfileCard title="X" />)).not.toContain(
    'data-slot="inspector-profile-facts"',
  );
});

test("字符串值按值样式排版，节点值原样渲染；图标位可以放勾选框", () => {
  const text = renderToStaticMarkup(<InspectorRow label="格式">百分比</InspectorRow>);
  expect(text).toMatch(/truncate text-pa-muted text-xs" title="百分比">百分比/);
  expect(text).toContain("max-w-3/5");

  const node = renderToStaticMarkup(
    <InspectorRow label="可用维度">
      <button type="button">3 个</button>
    </InspectorRow>,
  );
  expect(node).toContain('<button type="button">3 个</button>');
  expect(node).not.toContain("text-pa-muted text-xs");

  const control = renderToStaticMarkup(
    <InspectorRow icon={<input type="checkbox" />} label="在职人数" />,
  );
  // 图标位里的控件可交互，不被 aria-hidden 隐藏。
  expect(control).toMatch(/data-slot="inspector-row-icon"><input type="checkbox"/);
  expect(control).not.toContain(
    'aria-hidden="true" class="flex shrink-0 items-center text-pa-faint',
  );
});

test("行动作渲染在行框之外；名称只在配置栏使用弱化字色", () => {
  const markup = renderToStaticMarkup(
    <InspectorRow actions={<button type="button">移除</button>} indent label="入职人数" />,
  );
  expect(markup.indexOf('data-slot="inspector-row-box"')).toBeLessThan(markup.indexOf("移除"));
  expect(markup).toContain(INSPECTOR_ROW_INDENT_CLASS);
  expect(renderToStaticMarkup(<InspectorRow label="入职人数" />)).not.toContain(
    INSPECTOR_ROW_INDENT_CLASS,
  );
  expect(markup).toContain("min-h-11");
  expect(markup).toContain("md:min-h-8");
  // 详情栏名称不使用弱化字色：text-pa-muted 只带配置栏前缀出现。
  expect(markup).toContain(`${SETTINGS}text-pa-muted`);
  expect(markup).not.toMatch(/(?<!:)\btext-pa-muted\b/);
});

test("详情栏密度由 InspectorBody 设置，分节和行按该密度渲染", () => {
  const markup = renderToStaticMarkup(
    <InspectorBody face="profile">
      <InspectorSection title="指标">
        <InspectorRow label="入职人数" />
      </InspectorSection>
    </InspectorBody>,
  );
  expect(markup).toContain('data-face="profile"');
  expect(markup).toContain("group/inspector");
  expect(markup).toContain(`${PROFILE}p-4`);
  expect(markup).toContain('data-slot="inspector-section-rule"');
  expect(markup).toContain(`${PROFILE}px-0`);
  expect(markup).toContain(`${PROFILE}py-0.5`);
  // 分节标题使用 font-semibold（PA 中对应字重 520）。
  expect(markup).toContain("font-semibold");

  const settings = renderToStaticMarkup(
    <InspectorBody>
      <InspectorSection title="指标" />
    </InspectorBody>,
  );
  expect(settings).toContain('data-face="settings"');
  expect(settings).not.toContain('data-face="profile"');
});
