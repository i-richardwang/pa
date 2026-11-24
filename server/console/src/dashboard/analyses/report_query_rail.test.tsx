import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { SemanticQueryView } from "@semantic-analysis";
import {
  beginAnalysisEdit,
  blankAnalysisDefinition,
  semanticEditableQuery,
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
      query_capabilities: {
        dimension_ids: ["dimension:organization_name"],
      },
      time: { value_basis: "bucket_end" as const },
      report_calculations: ["percent_of_total"],
    },
    {
      id: "measure:monthly_hire_rate",
      kind: "measure",
      title: "月度入职率",
      description: "所选月份的入职率。",
      query_capabilities: {
        dimension_ids: ["dimension:organization_name"],
      },
      time: { value_basis: "whole_bucket" as const, constraints: { grain: "month" as const } },
    },
  ],
  dimensions: [
    {
      id: "dimension:organization_name",
      kind: "dimension",
      title: "组织",
      description: "组织。",
      dimension_group: { id: "organization", title: "组织与部门" },
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
  const view = semanticEditableQuery(draft.analysis)!;
  if (!view || "from" in view) throw new Error("空白分析应是单个语义查询");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      query: {
        ...view,
        measures: ["measure:active_employee_count"],
        dimensions: ["dimension:organization_name"],
      },
    },
  };
}

function withAnnualMonthlyMetric(draft: AnalysisEditState): AnalysisEditState {
  const view = semanticEditableQuery(draft.analysis)!;
  if (!view || "from" in view) throw new Error("空白分析应是单个语义查询");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      query: {
        ...view,
        measures: ["measure:monthly_hire_rate"],
        time: { window: { kind: "trailing", count: 3, unit: "year", grain: "year" } },
      },
    },
  };
}

function withOverlappingTime(draft: AnalysisEditState): AnalysisEditState {
  const withMeasure = withMembers(draft);
  const view = semanticEditableQuery(withMeasure.analysis)!;
  if (!view || "from" in view) throw new Error("测试草稿应是单个语义查询");
  return {
    ...withMeasure,
    analysis: {
      ...withMeasure.analysis,
      query: {
        ...view,
        time: {
          window: { kind: "trailing", count: 5, unit: "year", grain: "year" },
          comparison: { kind: "previous_year" },
        },
      },
    },
  };
}

function withSort(
  draft: AnalysisEditState,
  group_sort: Omit<NonNullable<SemanticQueryView["group_sort"]>, "dimension">,
): AnalysisEditState {
  const view = semanticEditableQuery(draft.analysis)!;
  if (!view || "from" in view) throw new Error("空白分析应是单个语义查询");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      query: { ...view, group_sort: { ...group_sort, dimension: "dimension:organization_name" } },
    },
  };
}

function withCalculation(draft: AnalysisEditState): AnalysisEditState {
  const withMembersDraft = withMembers(draft);
  const view = semanticEditableQuery(withMembersDraft.analysis)!;
  if (!view || "from" in view) throw new Error("测试草稿应是单个语义查询");
  return {
    ...withMembersDraft,
    analysis: {
      ...withMembersDraft.analysis,
      query: {
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
    },
  };
}

function withFilter(
  draft: AnalysisEditState,
  relation: "one_of" | "none_of",
  values = ["示例组织甲"],
): AnalysisEditState {
  const view = semanticEditableQuery(draft.analysis)!;
  if (!view || "from" in view) throw new Error("空白分析应是单个语义查询");
  return {
    ...draft,
    analysis: {
      ...draft.analysis,
      query: {
        ...view,
        filters: [{ member: "dimension:organization_name", relation, values }],
      },
    },
  };
}

// 筛选行通过 TanStack Query 查询维度候选值，渲染时需要 QueryClientProvider。
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

function previewDisabled(markup: string): boolean {
  const at = markup.lastIndexOf("运行预览");
  if (at < 0) throw new Error("查询栏必须渲染「运行预览」");
  const button = markup.slice(markup.lastIndexOf("<button", at), at);
  return button.includes("disabled=");
}

test("没有结果也没有成员时，预览禁用并提示先选成员", () => {
  const out = render(blankDraft());
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("至少选择一个指标或分组维度");
});

test("选了成员后预览可用，提示消失", () => {
  const out = render(withMembers(blankDraft()));
  expect(previewDisabled(out)).toBe(false);
  expect(out).not.toContain("至少选择一个指标或分组维度");
});

test("指标与时间设置冲突时，预览禁用并显示冲突原因", () => {
  const out = render(withAnnualMonthlyMetric(blankDraft()));
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("指标「月度入职率」按月定义；连续期间请改为按月呈现，不能合并多个月份");
});

test("已保存规格的时间设置自相冲突时照常渲染，预览禁用并显示原因", () => {
  const out = render(withOverlappingTime(blankDraft()));
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("主时间与对照时间在按年呈现时都会产生 2022 年");
  expect(out).not.toContain("服务暂时无法完成请求");
});

test("查询栏不渲染时间控件", () => {
  const out = render(withMembers(blankDraft()));
  expect(out).not.toContain('aria-label="观察时间"');
  expect(out).not.toContain("数据最新月份");
});

test("没有结果时成员名取目录标题，不显示成员 id", () => {
  const out = render(withMembers(blankDraft()));
  expect(out).toContain("在职人数");
  expect(out).toContain("组织");
  expect(out).not.toContain("measure:active_employee_count");
  expect(out).not.toContain("dimension:organization_name");
});

test("已选成员按行显示，只有筛选取值显示成胶囊", () => {
  const out = render(withMembers(blankDraft()));
  expect(out.match(/data-slot="inspector-row"/g)).toHaveLength(1);
  expect(out.match(/data-slot="breakdown-field"/g)).toHaveLength(1);
  expect(out).toContain('aria-label="组织分组范围：全部"');
  expect(out).not.toContain('data-slot="notebook-cell-item"');
  expect(render(withFilter(withMembers(blankDraft()), "one_of"))).toContain(
    'data-slot="notebook-cell-item"',
  );
});

test("筛选条件在栏内按行显示维度、取值关系和已选值", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of"));
  // 浮层在静态渲染中只输出触发器，这些内容能出现说明它们直接渲染在行内。
  expect(out).toContain('data-slot="filter-row"');
  expect(out).toContain("是其中之一");
  expect(out).toContain("示例组织甲");
  expect(out).not.toContain("搜索或输入取值");
});

test("筛选未选取值时可以继续编辑，但预览禁用", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of", []));
  expect(previewDisabled(out)).toBe(true);
  expect(out).toContain("请先为筛选选择至少一个值");
});

test("添加按钮在各节标题行右侧，行内没有添加入口", () => {
  const out = render(withFilter(withMembers(blankDraft()), "one_of"));
  for (const label of ["添加筛选条件", "选择指标", "选择分组维度", "移除 组织 筛选"]) {
    expect(out).toContain(`aria-label="${label}"`);
  }
  expect(out.indexOf('aria-label="添加筛选条件"')).toBeLessThan(out.indexOf("是其中之一"));
  expect(out.indexOf('aria-label="选择指标"')).toBeLessThan(out.indexOf("在职人数"));
  expect(out).not.toContain("添加筛选条件缩小范围");
});

test("取值关系只有「是其中之一」和「不是其中之一」两种", () => {
  const out = render(withFilter(withMembers(blankDraft()), "none_of"));
  expect(out).toContain("不是其中之一");
  for (const dropped of ["包含", "大于", "小于", "有值", "无值"]) {
    expect(out).not.toContain(dropped);
  }
});

test("每一节标题行左侧各有一个图标", () => {
  const out = render(withMembers(blankDraft()));
  const headers = out.match(/data-slot="inspector-section-header"/g) ?? [];
  const icons = out.match(/data-slot="inspector-section-icon"/g) ?? [];
  expect(headers.length).toBe(3);
  expect(icons.length).toBe(headers.length);
});

test("每个分组维度一行，维度可直接替换，排序选项在范围浮层里", () => {
  const out = render(withMembers(blankDraft()));
  const row = out.slice(out.indexOf('data-slot="breakdown-field"'));
  const rowEnd = row.indexOf('data-slot="inspector-section-content"');
  const field = rowEnd < 0 ? row : row.slice(0, rowEnd);
  expect(field).toContain('aria-label="分组维度：组织"');
  expect(field).toContain('aria-label="组织分组范围：全部"');
  expect(field).toContain('aria-label="移除 组织"');
  for (const inPopover of ["排序依据", "最大项数", "数值", "名称"]) {
    expect(out).not.toContain(inPopover);
  }
});

test("范围按钮显示当前设置：限制项数时显示方向和数量，只排序时显示排序依据", () => {
  const cases: [Parameters<typeof withSort>[1], string][] = [
    [{ by: "measure:active_employee_count", direction: "desc", max_items: 5 }, "前 5"],
    [{ by: "measure:active_employee_count", direction: "asc", max_items: 5 }, "后 5"],
    [{ by: "name", direction: "asc", max_items: 5 }, "A→Z (5)"],
    [{ by: "name", direction: "desc", max_items: 5 }, "Z→A (5)"],
    // 只排序、不限项数时显示全部分组，按钮显示排序依据。
    [{ by: "measure:active_employee_count", direction: "desc" }, "按数值"],
    [{ by: "name", direction: "asc" }, "按名称"],
  ];
  for (const [sort, label] of cases) {
    expect(render(withSort(withMembers(blankDraft()), sort))).toContain(
      `aria-label="组织分组范围：${label}"`,
    );
  }
});

test("新增分组维度默认显示全部，不设置项数上限", () => {
  const draft = withMembers(blankDraft());
  const view = semanticEditableQuery(draft.analysis)!;
  if (!view || "from" in view) throw new Error("测试草稿应是单个语义查询");
  expect(view.group_sort).toBeUndefined();
  const out = render(draft);
  expect(out).toContain('aria-label="组织分组范围：全部"');
  expect(out).not.toContain("分组 Top-N");
});

test("筛选、指标、分组三节始终按顺序显示，没有单独的「计算」节", () => {
  const out = render(blankDraft());
  const titles = ["筛选", "指标", "分组"];
  const at = titles.map((title) => out.indexOf(`>${title}<`));
  for (const position of at) expect(position).toBeGreaterThan(-1);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(out).not.toContain(">计算<");
  expect(out).not.toContain("添加构成占比");
});

test("占比在指标节中显示为一行，带计算设置按钮", () => {
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
  // 不写成 `A / B`，避免被读成除法。
  expect(calculated).not.toContain("在职人数 / 组织");
  expect(calculated).toContain(">按组织<");
  expect(calculated).toContain('aria-label="移除 组织结构"');
  expect(calculated).not.toContain("calculation:active_employee_organization_share");
});

test("占比选项在前置条件不满足时仍列出但不可选，并提示需要先做什么", () => {
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
  const conflicting = percentOfTotalPick({
    measures: catalog.measures,
    dimensions: catalog.dimensions,
    chosen: false,
    incompatibleReason: "构成占比需要完整分类",
  });
  expect(conflicting.incompatible_reason).toBe("构成占比需要完整分类");
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
