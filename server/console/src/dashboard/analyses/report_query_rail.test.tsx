/**
 * 查询栏在**无结果**语境（空白新建的首次预览之前）下的不变式：
 * 空查询是合法中间态但不可执行，出口由「运行预览」的禁用把住；
 * 成员名仍恒经目录翻成中文标题上屏（docs/ui_spec.md 同源纪律），不因缺结果而回落限定名。
 * headless 直渲（renderToStaticMarkup），不需 DOM/testing-library。
 */
import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { SemanticQueryView } from "@semantic-analysis";
import {
  beginAnalysisEdit,
  blankAnalysisDefinition,
  type AnalysisEditState,
} from "./analysis_draft";
import { defaultPercentOfTotal, percentOfTotalPick, ReportQueryRail } from "./report_query_rail";

const catalog: CatalogPayload = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: ["统计口径"],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [],
  measures: [
    {
      id: "measure:active_employee_count",
      kind: "measure",
      title: "在职人数",
      description: "在职人数。",
      report_calculations: ["percent_of_total"],
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "组织。",
    },
  ],
};

const blankDraft = (): AnalysisEditState =>
  beginAnalysisEdit(
    {
      name: "未命名分析",
      analysis: blankAnalysisDefinition("未命名分析"),
      view: { type: "table" },
    },
    false,
  );

function withMembers(draft: AnalysisEditState): AnalysisEditState {
  const view = draft.analysis.views[0];
  if (!view || "from" in view) throw new Error("空白种子必须是语义查询视图");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      views: [
        {
          ...view,
          measures: ["measure:active_employee_count"],
          dimensions: ["dimension:organization_name"],
        },
      ],
    },
  };
}

function withSort(
  draft: AnalysisEditState,
  group_sort: Omit<NonNullable<SemanticQueryView["group_sort"]>, "dimension">,
): AnalysisEditState {
  const view = draft.analysis.views[0];
  if (!view || "from" in view) throw new Error("空白种子必须是语义查询视图");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      views: [{ ...view, group_sort: { ...group_sort, dimension: "dimension:organization_name" } }],
    },
  };
}

function withCalculation(draft: AnalysisEditState): AnalysisEditState {
  const withMembersDraft = withMembers(draft);
  const view = withMembersDraft.analysis.views[0];
  if (!view || "from" in view) throw new Error("测试草稿必须是语义查询视图");
  return {
    ...withMembersDraft,
    analysis: {
      ...withMembersDraft.analysis,
      views: [
        {
          ...view,
          calculations: [
            {
              id: "calculation:active_employee_organization_share",
              title: "组织结构",
              kind: "percent_of_total",
              measure: "measure:active_employee_count",
              category_dimension: "dimension:organization_name",
            },
          ],
        },
      ],
    },
  };
}

function withFilter(
  draft: AnalysisEditState,
  relation: "one_of" | "none_of",
  values = ["示例组织甲"],
): AnalysisEditState {
  const view = draft.analysis.views[0];
  if (!view || "from" in view) throw new Error("空白种子必须是语义查询视图");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      views: [
        {
          ...view,
          filters: [{ member: "dimension:organization_name", relation, values }],
        },
      ],
    },
  };
}

// 筛选卡就地取维度取值（TanStack Query），故整栏与运行时一样活在 QueryClient 里。
const render = (draft: AnalysisEditState) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ReportQueryRail
        catalog={catalog}
        draft={draft}
        onChange={() => {}}
        onRunPreview={() => {}}
        previewing={false}
        replay={null}
      />
    </QueryClientProvider>,
  );

/** 「运行预览」是栏内唯一的 filled 按钮；只看它这一枚的 disabled 属性。 */
function previewDisabled(markup: string): boolean {
  const at = markup.lastIndexOf("运行预览");
  if (at < 0) throw new Error("查询栏必须渲染「运行预览」");
  const button = markup.slice(markup.lastIndexOf("<button", at), at);
  return button.includes("disabled=");
}

test("无结果且零成员：预览禁用并给出补齐提示", () => {
  const out = render(blankDraft());
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("至少选择一个指标或分组维度");
});

test("补上成员后预览即可点，提示随之消失", () => {
  const out = render(withMembers(blankDraft()));
  expect(previewDisabled(out)).toBe(false);
  expect(out).not.toContain("至少选择一个指标或分组维度");
});

test("时间不在查询栏：它是舞台 chrome，唯一实现在工作台页脚时间栏", () => {
  const out = render(withMembers(blankDraft()));
  expect(out).not.toContain('aria-label="观察时间"');
  expect(out).not.toContain("数据最新月份");
});

test("无结果时成员名仍走目录翻译，不上屏限定名", () => {
  const out = render(withMembers(blankDraft()));
  expect(out).toContain("在职人数");
  expect(out).toContain("组织");
  expect(out).not.toContain("measure:active_employee_count");
  expect(out).not.toContain("dimension:organization_name");
});

test("已选成员成行不成片：胶囊只留给筛选取值", () => {
  const out = render(withMembers(blankDraft()));
  // 指标仍是一行；分组维度是一行 Breakdown，维度与范围两枚触发件并列在同一行内。
  expect(out.match(/data-slot="inspector-row"/g)).toHaveLength(1);
  expect(out.match(/data-slot="breakdown-field"/g)).toHaveLength(1);
  expect(out).toContain('aria-label="组织分组范围：全部"');
  expect(out).not.toContain('data-slot="inspector-field-group"');
  expect(out).not.toContain('data-slot="notebook-cell-item"');
  expect(render(withFilter(withMembers(blankDraft()), "one_of"))).toContain(
    'data-slot="notebook-cell-item"',
  );
});

test("筛选条件就地成卡：维度、取值关系与已选值都在栏内直接可读", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of"));
  // 卡不是浮层：题行、关系与取值片必须出现在这一次静态渲染里（浮层只会渲染触发件）。
  expect(out).toContain('data-slot="filter-card"');
  expect(out).toContain("是其中之一");
  // 已有取值 ⇒ 收起态：改的控件收起，读的取值仍印在卡上。
  expect(out).toContain("示例组织甲");
  expect(out).not.toContain("搜索或输入取值");
});

test("未取值的筛选是可编辑中间态，但不能运行预览", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of", []));
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("请先为筛选选择至少一个值");
});

test("添加入口一律在题行右端，没有行内添加位", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of"));
  for (const label of ["添加筛选条件", "选择指标", "选择分组维度", "移除 组织 筛选"]) {
    expect(out).toContain(`aria-label="${label}"`);
  }
  expect(out.indexOf('aria-label="添加筛选条件"')).toBeLessThan(out.indexOf("是其中之一"));
  expect(out.indexOf('aria-label="选择指标"')).toBeLessThan(out.indexOf("在职人数"));
  // 筛选的取值胶囊不承载第二种添加入口。
  expect(out).not.toContain("添加筛选条件缩小范围");
});

test("取值关系只有两档，翻转即换文案", () => {
  const out = render(withFilter(withMembers(blankDraft()), "none_of"));
  expect(out).toContain("不是其中之一");
  // 筛选面只提供成员取值关系，不提供比较算子。
  for (const dropped of ["包含", "大于", "小于", "有值", "无值"]) {
    expect(out).not.toContain(dropped);
  }
});

test("题行记号要么都给要么都不给：每一节题行左端恰好一枚", () => {
  const out = render(withMembers(blankDraft()));
  const headers = out.match(/data-slot="inspector-section-header"/g) ?? [];
  const icons = out.match(/data-slot="inspector-section-icon"/g) ?? [];
  expect(headers.length).toBe(3);
  expect(icons.length).toBe(headers.length);
});

test("一个分组维度一行：维度可就地换，排名选项只在范围浮层里", () => {
  const out = render(withMembers(blankDraft()));
  const row = out.slice(out.indexOf('data-slot="breakdown-field"'));
  const rowEnd = row.indexOf('data-slot="inspector-section-content"');
  const field = rowEnd < 0 ? row : row.slice(0, rowEnd);
  // 维度自己就是选择器（不必删掉再加一个），范围触发件与它同在这一行内。
  expect(field).toContain('aria-label="分组维度：组织"');
  expect(field).toContain('aria-label="组织分组范围：全部"');
  expect(field).toContain('aria-label="移除 组织"');
  // 浮层只渲染触发件：两组设置的题与控件都不在这一次静态渲染里。
  for (const inPopover of ["排序依据", "最大项数", "数值", "名称"]) {
    expect(out).not.toContain(inPopover);
  }
});

test("范围触发件印的是结论不是控件名：限项说端与量，只排序说依据", () => {
  const cases: [Parameters<typeof withSort>[1], string][] = [
    [{ by: "measure:active_employee_count", direction: "desc", max_items: 5 }, "前 5"],
    [{ by: "measure:active_employee_count", direction: "asc", max_items: 5 }, "后 5"],
    [{ by: "name", direction: "asc", max_items: 5 }, "A→Z (5)"],
    [{ by: "name", direction: "desc", max_items: 5 }, "Z→A (5)"],
    // 只声明排序、不限项数：仍是展示全部，但它已不是「没设过」，触发件得说清按什么排。
    [{ by: "measure:active_employee_count", direction: "desc" }, "按数值"],
    [{ by: "name", direction: "asc" }, "按名称"],
  ];
  for (const [sort, label] of cases) {
    expect(render(withSort(withMembers(blankDraft()), sort))).toContain(
      `aria-label="组织分组范围：${label}"`,
    );
  }
});

test("分组默认展示全部，不在新增维度时暗写 Top 10", () => {
  const draft = withMembers(blankDraft());
  const view = draft.analysis.views[0];
  if (!view || "from" in view) throw new Error("测试草稿必须是语义查询视图");
  expect(view.group_sort).toBeUndefined();
  const out = render(draft);
  expect(out).toContain('aria-label="组织分组范围：全部"');
  expect(out).not.toContain("分组 Top-N");
});

test("三节常驻：一项能力没被用上，它的题行仍在原位；没有「计算」第四节", () => {
  const out = render(blankDraft());
  const titles = ["筛选", "指标", "分组"];
  const at = titles.map((title) => out.indexOf(`>${title}<`));
  for (const position of at) expect(position).toBeGreaterThan(-1);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(out).not.toContain(">计算<");
  expect(out).not.toContain("添加构成占比");
});

test("构成占比住在指标节：候选就在指标浮层里，落定后是一行带算法触发件的指标", () => {
  const empty = render(withMembers(blankDraft()));
  expect(empty).not.toContain('aria-label="添加构成占比"');
  const calculated = render(withCalculation(blankDraft()));
  const measuresAt = calculated.indexOf(">指标<");
  const groupsAt = calculated.indexOf(">分组<");
  const rowAt = calculated.indexOf('aria-label="组织结构怎么算');
  expect(rowAt).toBeGreaterThan(measuresAt);
  expect(rowAt).toBeLessThan(groupsAt);
  expect(calculated).toContain("组织结构");
  expect(calculated).toContain('aria-label="组织结构怎么算：在职人数按组织的占比"');
  // 结论不写成 `A / B`——那读成除法。
  expect(calculated).not.toContain("在职人数 / 组织");
  expect(calculated).toContain(">按组织<");
  expect(calculated).toContain('aria-label="移除 组织结构"');
  expect(calculated).not.toContain("calculation:active_employee_organization_share");
});

test("构成占比候选：前置条件不满足时仍列出、只是灰，理由讲的是先去做什么", () => {
  const nothing = percentOfTotalPick({ measures: [], dimensions: [], chosen: false });
  expect(nothing.incompatible).toBe(true);
  expect(nothing.incompatible_reason).toBe("先添加一个可以算占比的指标（例如人数）");
  const noDimension = percentOfTotalPick({
    measures: catalog.measures,
    dimensions: [],
    chosen: false,
  });
  expect(noDimension.incompatible_reason).toBe("先添加一个分组");
  const ready = percentOfTotalPick({
    measures: catalog.measures,
    dimensions: catalog.dimensions,
    chosen: false,
  });
  expect(ready.incompatible).toBe(false);
  const chosen = percentOfTotalPick({ measures: [], dimensions: [], chosen: true });
  expect(chosen.incompatible).toBe(false);
  const measure = catalog.measures[0];
  const dimension = catalog.dimensions[0];
  if (!measure || !dimension) throw new Error("fixture");
  expect(defaultPercentOfTotal(measure, dimension)).toEqual({
    id: "calculation:measure_active_employee_count_dimension_organization_name_share",
    title: "组织结构",
    kind: "percent_of_total",
    measure: measure.id,
    category_dimension: dimension.id,
  });
});
