/**
 * 拒绝文案质量的横切门禁：分析规格解析、查询语义护栏（`query_contract`）、时间规划
 * （`time_plan`）与目录可见性各自 fail-closed，判据只有一条——文案必须给出可执行的
 * 下一步，调用方读完就知道改哪个参数。故断言落在文案本身，不在是否抛错上；
 * 各护栏的判定逻辑由它们自己的用例覆盖。
 */
import { describe, expect, test } from "bun:test";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import { assertMeasureFilterCompatibility } from "./query_contract.js";
import { parseAnalysisSpec } from "../semantic_core/analysis_spec.js";
import { observationScopes } from "./catalog_document.js";
import { planTimeQuery } from "../test_support/planning.js";

const views: CubeView[] = [
  {
    name: "flow",
    title: "人员流动",
    meta: { time_source: "workforce", observation_scope: "统计范围" },
    dimensions: [
      { name: "flow.org", title: "组织", type: "string" },
      { name: "flow.year", title: "年", type: "number" },
    ],
    measures: [
      {
        name: "flow.active_employee_count",
        title: "在职人数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
      {
        name: "flow.hires",
        title: "入职人数",
        type: "number",
        meta: { time_contract: { aggregation: "sum", window: "selected" } },
      },
      {
        name: "flow.ytd_rate",
        title: "YTD主要事件率",
        type: "number",
        meta: { time_contract: { aggregation: "recompute", window: "year_to_date" } },
      },
      {
        name: "flow.share",
        title: "结构占比",
        type: "number",
        meta: { calculation_role: "structure_share" },
      },
    ],
  },
  {
    name: "hc",
    title: "编制",
    meta: { time_source: "hc", observation_scope: "统计范围" },
    dimensions: [],
    measures: [
      {
        name: "hc.plan",
        title: "编制数",
        type: "number",
        meta: { time_contract: { aggregation: "last", window: "selected" } },
      },
    ],
  },
];

const context: TimeContext = {
  dataAsOf: "2026-07",
  sources: {
    workforce: { actualThrough: "2026-07", availableThrough: "2026-07" },
    hc: { actualThrough: "2026-07", availableThrough: "2026-12", planThrough: "2026-12" },
  },
};

function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("测试规格应被护栏拒绝");
}

describe("拒绝文案", () => {
  test("canonical 分析规格错误有明确上下文", () => {
    expect(errorMessage(() => parseAnalysisSpec({ views: [] }))).toContain("分析规格无效");
    expect(
      errorMessage(() =>
        parseAnalysisSpec({
          views: [
            { id: "source", measures: ["flow.active_employee_count"], time: {} },
            {
              id: "derived",
              view_title: "派生",
              from: ["missing"],
              columns: [{ col: "active_employee_count", source: "missing" }],
            },
          ],
        }),
      ),
    ).toMatch(/引用的视图 missing 不存在/);
  });

  test("查询语义护栏给出可行动修正方向", () => {
    const cases = [
      () =>
        planTimeQuery(
          { measures: ["flow.active_employee_count"], dimensions: ["flow.year"] },
          {},
          context,
          views,
        ),
      () =>
        planTimeQuery(
          { measures: ["flow.active_employee_count"] },
          { cutoff: "2026-08" },
          context,
          views,
        ),
      () =>
        planTimeQuery(
          { measures: ["flow.hires"] },
          { range: { from: "2026-06", to: "2026-05" } },
          context,
          views,
        ),
      () =>
        planTimeQuery(
          { measures: ["flow.ytd_rate"] },
          { range: { from: "2025-06", to: "2026-06" }, grain: "total" },
          context,
          views,
        ),
      () =>
        planTimeQuery(
          { measures: ["flow.ytd_rate"] },
          {
            cutoff: "2026-06",
            compare: [{ cutoff: "2025-06" }],
            grain: "total",
          },
          context,
          views,
        ),
      () => assertMeasureFilterCompatibility({ measures: ["flow.share"] }, views),
    ];
    for (const run of cases) {
      expect(errorMessage(run)).toMatch(/请|必须|只能|删除|拆|改用|改为/);
    }
  });

  test("零可见视图明确归因授权", () => {
    const message = errorMessage(() => observationScopes([]));
    expect(message).toMatch(/没有可见数据视图.*查询参数无需修改.*管理员/);
  });
});
