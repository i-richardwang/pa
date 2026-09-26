/**
 * 卡是编译器时间知识的投影：卡的预测与生产路径（Cube 元数据 → 目录装配 → 语义编译 →
 * 物理时间规划）的接受/拒绝必须逐例等价。用例矩阵只含时间能力一种失败源。
 */
import { expect, test } from "bun:test";
import {
  metricTimeSelectionIssue,
  resolveTimeSelection,
  resolveTimeIntentSelection,
  TimeSelectionError,
  timeSelectionIssueMessage,
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
import { resolveMetricTime } from "./metric_time.js";

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
    dimensions: [
      {
        name: "flow.organization_name",
        title: "组织",
        type: "string",
        meta: { dimension_group: "organization" },
      },
    ],
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
  semantic.measures.find((member) => member.id === id)?.time.constraints ?? {};

const members = new Map(views.flatMap((view) => view.measures).map((m) => [m.name, m]));
/** 指标的时间解析，与生产同源。 */
const metricTimeOf = (name: string) => {
  const member = members.get(`flow.${name}`);
  if (!member) throw new Error(`fixture 缺指标 ${name}`);
  return resolveMetricTime(member, members);
};

const basisOf = (id: string) => {
  const basis = semantic.measures.find((member) => member.id === id)?.time.value_basis;
  if (!basis) throw new Error(`fixture 缺 ${id} 的求值基准`);
  return basis;
};

function predictedIssue(time: TimeIntent, capabilities: TimeCapabilities) {
  const result = resolveTimeIntentSelection(time, LATEST);
  return result.status === "invalid"
    ? result.issue
    : metricTimeSelectionIssue([{ capabilities }], result.selection);
}

/** 生产路径：语义规格（带 TimeIntent）→ 编译 → 物理时间规划。抛错即该组合被拒。 */
function planningFailure(measureId: string, time: TimeIntent): unknown {
  try {
    const plan = compileAnalysisView(compiler, {
      analysis: parseAnalysisDefinition({
        query: { measures: [measureId], time },
      }),
      view: { type: "table" },
    });
    const node = plan.plan.nodes[0];
    if (!node || "from" in node) throw new Error("夹具必须编译出查询节点");
    planMetricQuery({ measures: node.measures ?? [] }, node.time, context, views);
    return undefined;
  } catch (error) {
    return error;
  }
}

function rejection(measureId: string, time: TimeIntent): string | undefined {
  const error = planningFailure(measureId, time);
  return error === undefined ? undefined : error instanceof Error ? error.message : String(error);
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

test("时间能力由指标时间合同推导：按月定义和年初累计分别体现在能力中", () => {
  expect(cardOf("measure:active_employee_count")).toEqual({});
  expect(cardOf("measure:turnover_count")).toEqual({});
  expect(cardOf("measure:current_month_turnover_rate")).toEqual({ grain: "month" });
  expect(cardOf("measure:ytd_event_rate")).toEqual({ year_scoped: true });
  // 合同本身绝不上线：卡只是它在消费面的投影。
  expect(JSON.stringify(semantic)).not.toContain("time_contract");
});

test("对每种时间组合，能力预测的可用或不可用与实际查询结果一致", () => {
  const predictedRejections: string[] = [];
  const actualRejections: string[] = [];
  for (const measureId of MEASURES) {
    const card = cardOf(measureId);
    for (const { label, time } of TIMES) {
      const at = `${measureId} × ${label}`;
      const issue = predictedIssue(time, card);
      const predicted = issue ? timeSelectionIssueMessage(issue) : undefined;
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

test("被拒绝的只有按月定义指标合并多个月份的组合", () => {
  const failure = planningFailure("measure:current_month_turnover_rate", at("年内期间·按年"));
  expect(failure).toBeInstanceOf(TimeSelectionError);
  expect(failure).toMatchObject({
    issue: {
      code: "metric_time_grain_incompatible",
      required_grain: "month",
      selected_grain: "year",
    },
  });
  expect(rejection("measure:current_month_turnover_rate", at("年内期间·按月"))).toBeUndefined();
  expect(rejection("measure:active_employee_count", at("年内期间·按年"))).toBeUndefined();
  expect(rejection("measure:turnover_count", at("跨年期间·按月"))).toBeUndefined();
});

test("时间参数自身冲突时，能力预测与实际查询返回相同的结构化错误", () => {
  const time: TimeIntent = {
    window: { kind: "trailing", count: 5, unit: "year", grain: "year" },
    comparison: { kind: "previous_year" },
  };
  expect(predictedIssue(time, {})).toEqual({
    code: "time_output_bucket_overlap",
    selected_grain: "year",
    bucket: "2022",
  });
  const failure = planningFailure("measure:active_employee_count", time);
  expect(failure).toBeInstanceOf(TimeSelectionError);
  expect(failure).toMatchObject({
    issue: {
      code: "time_output_bucket_overlap",
      selected_grain: "year",
      bucket: "2022",
    },
  });
});

test("年初累计指标不因输出粒度被拒绝，合计按求值基准标明实际覆盖期间", () => {
  // 跨日历年按年/按月均合法；年初归零只影响合计位的覆盖期间。
  expect(rejection("measure:ytd_event_rate", at("跨年期间·按月"))).toBeUndefined();
  expect(rejection("measure:ytd_event_rate", at("跨年期间·按年"))).toBeUndefined();
  // 目录的两个字段各答各的：基准说数覆盖哪一段，限制位说用户能选什么。
  expect(basisOf("measure:ytd_event_rate")).toBe("year_start_to_bucket_end");
  expect(cardOf("measure:ytd_event_rate")).toEqual({ year_scoped: true });
  const crossYear = { from: "2024-01", to: "2026-07" };
  // 合计期间走生产同一条路：由指标自己的时间解析展开，不经过能力卡。
  expect(totalPeriodOf(metricTimeOf("ytd_event_rate"), crossYear)).toEqual({
    from: "2026-01",
    to: "2026-07",
  });
  expect(totalPeriodOf(metricTimeOf("turnover_count"), crossYear)).toEqual(crossYear);
});

test("年初累计指标跨年合并时，能力预测与实际查询返回相同的结构化错误", () => {
  const time = { range: { from: "2025-01", to: "2026-07" }, grain: "total" } as const;
  const selection = resolveTimeSelection(time, LATEST);
  if (selection.status === "invalid") throw new Error(timeSelectionIssueMessage(selection.issue));
  const predicted = metricTimeSelectionIssue(
    [{ capabilities: cardOf("measure:ytd_event_rate"), title: "YTD事件率" }],
    selection.selection,
  );
  expect(predicted).toEqual({
    code: "metric_time_calendar_year_total_incompatible",
    metric_titles: ["YTD事件率"],
    from: "2025-01",
    to: "2026-07",
    selected_grain: "total",
  });
  const actual = (() => {
    try {
      planMetricQuery({ measures: ["flow.ytd_event_rate"] }, time, context, views);
      return undefined;
    } catch (error) {
      return error;
    }
  })();
  expect(actual).toBeInstanceOf(TimeSelectionError);
  expect(actual).toMatchObject({ issue: predicted });
});
