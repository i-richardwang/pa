/**
 * 卡是编译器时间知识的投影：卡的预测与生产路径（Cube 元数据 → 目录装配 → 语义编译 →
 * 物理时间规划）的接受/拒绝必须逐例等价。用例矩阵只含时间能力一种失败源。
 */
import { expect, test } from "bun:test";
import {
  seriesGrainIssues,
  totalPeriodOf,
  type TimeCapabilities,
  type TimeIntent,
} from "../semantic_core/time_contract.js";
import { parseAnalysisDefinition } from "../semantic_core/semantic_analysis.js";
import { compileAnalysisView } from "./semantic_analysis_compiler.js";
import {
  buildCatalogDocument as buildRawCatalogDocument,
  toCompilerCatalog,
  toSemanticCatalog,
} from "./catalog_document.js";
import type { CubeMember, CubeView, TimeContext } from "../ports/cube_gateway.js";
import {
  TEST_SEMANTIC_TAXONOMY,
  TEST_TIME_SOURCE_REGISTRY,
} from "../test_support/semantic_taxonomy.js";
import { planMetricQuery } from "../test_support/planning.js";

const buildCatalogDocument = (views: CubeView[]) =>
  buildRawCatalogDocument(views, TEST_SEMANTIC_TAXONOMY, TEST_TIME_SOURCE_REGISTRY, {
    id: "test_scope",
    title: "测试数据范围",
  });

const LATEST = "2026-07";

const measure = (name: string, title: string, meta: CubeMember["meta"]): CubeMember => ({
  name: `flow.${name}`,
  title,
  type: "number",
  meta: { metric_domain_id: "metric_domain:workforce_movement", ...meta },
});

/** 四种时间性格各一枚：无约束求和/期末、按月定义的率、年初累计的率。 */
const views: CubeView[] = [
  {
    name: "flow",
    title: "人员流动",
    meta: { time_source: "workforce", observation_scope: "统计范围：测试" },
    dimensions: [{ name: "flow.organization_name", title: "组织", type: "string" }],
    measures: [
      measure("active_employee_count", "在职人数", {
        time_contract: { aggregation: "last", window: "selected" },
      }),
      measure("turnover_count", "离职人数", {
        time_contract: { aggregation: "sum", window: "selected" },
      }),
      measure("current_month_turnover_rate", "本月离职率", {
        time_contract: { aggregation: "recompute", window: "selected", grain: "month" },
      }),
      measure("ytd_event_rate", "YTD事件率", {
        time_contract: { aggregation: "recompute", window: "year_to_date" },
      }),
    ],
  },
];

const context: TimeContext = {
  dataAsOf: LATEST,
  sources: { workforce: { actualThrough: LATEST, availableThrough: LATEST } },
};

const document = buildCatalogDocument(views);
const semantic = toSemanticCatalog(document);
const compiler = toCompilerCatalog(document);

const cardOf = (id: string): TimeCapabilities =>
  semantic.measures.find((member) => member.id === id)?.time_constraints ?? {};

/** 生产路径：语义规格（带 TimeIntent）→ 编译 → 物理时间规划。抛错即该组合被拒。 */
function rejection(measureId: string, time: TimeIntent): string | undefined {
  try {
    const plan = compileAnalysisView(compiler, {
      analysis: parseAnalysisDefinition({
        views: [{ id: "v1", measures: [measureId], time }],
      }),
      view: { type: "table" },
    });
    const node = plan.plan.nodes[0];
    if (!node || "from" in node) throw new Error("夹具必须编译出查询节点");
    planMetricQuery({ measures: node.measures ?? [] }, node.time, context, views);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const TIMES: { label: string; time: TimeIntent }[] = [
  { label: "单月", time: { window: { kind: "current_month", month: LATEST } } },
  {
    label: "年内期间·按月",
    time: { window: { kind: "range", from: "2026-01", to: "2026-07", grain: "month" } },
  },
  {
    label: "年内期间·按年",
    time: { window: { kind: "range", from: "2026-01", to: "2026-07", grain: "year" } },
  },
  {
    label: "跨年期间·按月",
    time: { window: { kind: "range", from: "2024-01", to: "2026-07", grain: "month" } },
  },
  {
    label: "跨年期间·按年",
    time: { window: { kind: "range", from: "2024-01", to: "2026-07", grain: "year" } },
  },
  {
    label: "近12月",
    time: { window: { kind: "trailing", count: 12, unit: "month", grain: "month" } },
  },
  {
    label: "近3年·按月",
    time: { window: { kind: "trailing", count: 3, unit: "year", grain: "month" } },
  },
  { label: "今年至今", time: { window: { kind: "year_to_date", grain: "year" } } },
  {
    label: "单月×上一周期",
    time: {
      window: { kind: "current_month", month: LATEST },
      comparison: { kind: "previous_period" },
    },
  },
];

const MEASURES = [
  "measure:active_employee_count",
  "measure:turnover_count",
  "measure:current_month_turnover_rate",
  "measure:ytd_event_rate",
];

test("能力卡由模型时间合同推导：按月定义与年初归零各自成位", () => {
  expect(cardOf("measure:active_employee_count")).toEqual({});
  expect(cardOf("measure:turnover_count")).toEqual({});
  expect(cardOf("measure:current_month_turnover_rate")).toEqual({ multi_month_display: "month" });
  expect(cardOf("measure:ytd_event_rate")).toEqual({ year_scoped: true });
  // 合同本身绝不上线：卡只是它在消费面的投影。
  expect(JSON.stringify(semantic)).not.toContain("time_contract");
});

test("卡的预测与生产路径的接受/拒绝逐例等价（双向）", () => {
  const predictedRejections: string[] = [];
  const actualRejections: string[] = [];
  for (const measureId of MEASURES) {
    const card = cardOf(measureId);
    for (const { label, time } of TIMES) {
      const at = `${measureId} × ${label}`;
      // 单月窗口没有粒度可选，无从违规。
      const predicted =
        time.window.kind === "current_month"
          ? undefined
          : seriesGrainIssues(time, card, LATEST)[time.window.grain];
      const actual = rejection(measureId, time);
      if (predicted) predictedRejections.push(at);
      if (actual) actualRejections.push(`${at}：${actual}`);
      expect(Boolean(predicted), `${at} 预测=${predicted ?? "可用"} 实际=${actual ?? "通过"}`).toBe(
        Boolean(actual),
      );
    }
  }
  expect(predictedRejections.length).toBeGreaterThan(0);
  expect(actualRejections.length).toBe(predictedRejections.length);
  expect(predictedRejections.length).toBeLessThan(MEASURES.length * TIMES.length);
});

const at = (label: string) => TIMES.find((entry) => entry.label === label)!.time;

test("被拒的正是按月定义指标的越界组合", () => {
  expect(rejection("measure:current_month_turnover_rate", at("年内期间·按年"))).toContain(
    "按月定义",
  );
  expect(rejection("measure:current_month_turnover_rate", at("年内期间·按月"))).toBeUndefined();
  expect(rejection("measure:active_employee_count", at("年内期间·按年"))).toBeUndefined();
  expect(rejection("measure:turnover_count", at("跨年期间·按月"))).toBeUndefined();
});

test("年初归零由合计位的终点降级承担，不表现为显示档拒绝", () => {
  // 跨日历年按年/按月均合法；年初归零只影响合计位的覆盖期间。
  expect(rejection("measure:ytd_event_rate", at("跨年期间·按月"))).toBeUndefined();
  expect(rejection("measure:ytd_event_rate", at("跨年期间·按年"))).toBeUndefined();
  // 它仍是一位真实能力：整窗合计据此退到终点所在年的年初至今，而不是硬合并跨年。
  const crossYear = { from: "2024-01", to: "2026-07" };
  expect(totalPeriodOf(cardOf("measure:ytd_event_rate"), crossYear)).toEqual({
    from: "2026-01",
    to: "2026-07",
    coverage: "endpoint",
  });
  expect(totalPeriodOf(cardOf("measure:turnover_count"), crossYear)).toEqual({
    ...crossYear,
    coverage: "window",
  });
});
