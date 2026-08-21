/**
 * 栏、卡、行三件一起看：密度写在栏上、由段与行自己认，坏在哪一头都是静默的——
 * 照样渲染，只是又变回配置面那副样子。行是全栏唯一的一种，右槽给字符串还是给节点，
 * 排版规矩不同却常被当成同一件事写在调用处。
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INSPECTOR_ROW_INDENT_CLASS,
  InspectorBody,
  InspectorProfileCard,
  InspectorRow,
  InspectorSection,
} from "./inspector";

const READING = "group-data-[density=reading]/inspector:";
const SETTINGS = "group-data-[density=settings]/inspector:";

test("头卡把名字、口径与事实行收在同一张卡里", () => {
  const markup = renderToStaticMarkup(
    <InspectorProfileCard description="按组织分析入离职。" title="人员流动">
      <div>事实行</div>
    </InspectorProfileCard>,
  );
  expect(markup).toContain('data-slot="inspector-profile-card"');
  expect(markup).toContain("人员流动");
  expect(markup).toContain("按组织分析入离职。");
  expect(markup).toContain('data-slot="inspector-profile-facts"');
  // 没写口径的那一条不留空白：破折号也是一句话。
  expect(renderToStaticMarkup(<InspectorProfileCard description="" title="X" />)).toContain("—");
  // 没有事实行时不出空的下半块。
  expect(renderToStaticMarkup(<InspectorProfileCard title="X" />)).not.toContain(
    'data-slot="inspector-profile-facts"',
  );
});

test("值给字符串就按值排版，给节点就照放；记号槽可放勾选框", () => {
  const text = renderToStaticMarkup(<InspectorRow label="格式">百分比</InspectorRow>);
  // 字符串是一个值：次一档、单行截断，调用处不必也不该自己写这套。
  expect(text).toMatch(/truncate text-pa-muted text-xs">百分比/);
  // 右槽有上限，长值不会把名字挤没。
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
  // 记号槽里的控件是可达的：槽不遮蔽它。
  expect(control).toMatch(/data-slot="inspector-row-icon"><input type="checkbox"/);
  expect(control).not.toContain(
    'aria-hidden="true" class="flex shrink-0 items-center text-pa-faint',
  );
});

test("行外的动作不占右槽，名字只在配置面让位", () => {
  const markup = renderToStaticMarkup(
    <InspectorRow actions={<button type="button">移除</button>} indent label="入职人数" />,
  );
  // 动作在行盒之外：它是对这一行做什么，不是这一行的内容。
  expect(markup.indexOf('data-slot="inspector-row-box"')).toBeLessThan(markup.indexOf("移除"));
  // 无记号的行让出记号槽：与带记号那行的名字同起点。
  expect(markup).toContain(INSPECTOR_ROW_INDENT_CLASS);
  expect(renderToStaticMarkup(<InspectorRow label="入职人数" />)).not.toContain(
    INSPECTOR_ROW_INDENT_CLASS,
  );
  // 触屏一档够手指点，桌面收回 32。
  expect(markup).toContain("min-h-11");
  expect(markup).toContain("md:min-h-8");
  // 名字次于控件只发生在配置面；档案面里名字就是内容本身，不预先压灰。
  expect(markup).toContain(`${SETTINGS}text-pa-muted`);
  expect(markup).not.toMatch(/(?<!:)\btext-pa-muted\b/);
});

test("档案密度由栏发出、由段与行认领", () => {
  const markup = renderToStaticMarkup(
    <InspectorBody density="reading">
      <InspectorSection title="指标">
        <InspectorRow label="入职人数" />
      </InspectorSection>
    </InspectorBody>,
  );
  expect(markup).toContain('data-density="reading"');
  expect(markup).toContain("group/inspector");
  // 段与行各自带着这一档的写法，否则栏发了信号也没人接。
  expect(markup).toContain(`${READING}p-4`);
  expect(markup).toContain('data-slot="inspector-section-rule"');
  // 行与段题左缘对齐（内容不再多缩一格），行间留一口气。
  expect(markup).toContain(`${READING}px-0`);
  expect(markup).toContain(`${READING}py-0.5`);
  // 段题走 semibold（PA 的 520 一档）。
  expect(markup).toContain("font-semibold");

  // 反向：配置面是默认档，栏上不留 reading 标记。
  const settings = renderToStaticMarkup(
    <InspectorBody>
      <InspectorSection title="指标" />
    </InspectorBody>,
  );
  expect(settings).toContain('data-density="settings"');
  expect(settings).not.toContain('data-density="reading"');
});
