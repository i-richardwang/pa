import { compileChart, makeTitleOf } from "../presentation_core/view_shape.js";
import { expect, test } from "bun:test";
import type { CubeView, TimeContext } from "../ports/cube_gateway.js";
import { buildTimeSourceRegistry } from "../semantic_core/time_source.js";
import type { QueryViewSpec } from "../semantic_core/analysis_spec.js";
import type { EngineViewBlock } from "../engine/transform.js";
import { executeCalendarAndObservation } from "./mixed_observation_execution.js";
import { createObservationDirectory } from "./observation_directory.js";
import { executeObservationView, selectObservations } from "./observation_execution.js";

const source = { actualThrough: "2026-07", availableThrough: "2026-07" };

const occurrences = [
  { id: "may_early", date: "2026-05-04" },
  { id: "may_late", date: "2026-05-19" },
];

const context: TimeContext = {
  dataAsOf: "2026-07",
  sources: { workforce: source, engagement: source },
};

const sourceRegistry = buildTimeSourceRegistry([
  { id: "workforce", title: "人员", role: "actual", primary: true, comparison_policy: "calendar" },
  {
    id: "engagement",
    title: "员工调研",
    role: "actual",
    primary: false,
    comparison_policy: "explicit_only",
    observation: { id_member: "wave_id", date_member: "wave_date" },
  },
]);

const peopleView: CubeView = {
  name: "people_metrics",
  title: "人员",
  meta: { time_source: "workforce" },
  dimensions: [],
  measures: [],
};

const surveyView: CubeView = {
  name: "survey_metrics",
  title: "员工调研",
  meta: { time_source: "engagement", time_anchor_measure: "survey_score" },
  measures: [],
  dimensions: [
    { name: "survey_metrics.wave_id", type: "string", title: "期次" },
    { name: "survey_metrics.wave_date", type: "string", title: "日期" },
  ],
};

function block(metric: string, rows: EngineViewBlock["rows"], month = false): EngineViewBlock {
  return {
    id: "query",
    columns: ["department_id", ...(month ? ["year", "month"] : []), metric],
    column_roles: {
      department_id: "dimension",
      ...(month ? { year: "time", month: "time" } : {}),
      [metric]: "measure",
    },
    rows,
    row_count: rows.length,
    query_notes: [],
  };
}

test("同月独立期次可分别选择，未投放的月保留最近一期，首期前未观测", () => {
  const trend = selectObservations(
    occurrences,
    {
      observation: { kind: "trend", from: "2026-05-01", to: "2026-05-31" },
    },
    source,
  );
  expect(trend.periods.map(({ occurrence }) => occurrence?.id)).toEqual(["may_early", "may_late"]);
  const asOf = selectObservations(
    occurrences,
    {
      observation: { kind: "as_of", date: "2026-05-12" },
    },
    source,
  );
  expect(asOf.periods[0]?.occurrence?.id).toBe("may_early");
  const months = selectObservations(
    occurrences,
    {
      range: { from: "2026-04", to: "2026-06" },
      grain: "month",
    },
    source,
  );
  expect(months.periods.map(({ status, occurrence }) => [status, occurrence?.id])).toEqual([
    ["not_observed", undefined],
    ["observed", "may_late"],
    ["no_release", "may_late"],
  ]);
});

test("先按授权选择期次，所选组无数据时只查询该期", async () => {
  const cubeQueries: unknown[] = [];
  const spec: QueryViewSpec = {
    id: "query",
    time_view: surveyView.name,
    measures: ["survey_metrics.survey_score"],
    filters: [{ member: "survey_metrics.department_id", operator: "equals", values: ["team_a"] }],
    time: { cutoff: "2026-06" },
  };
  const resolved: QueryViewSpec[] = [];
  const result = await executeObservationView({
    directory: createObservationDirectory({
      cube: {
        load: async (query) => {
          cubeQueries.push(query);
          return {
            data: occurrences.map(({ id, date }) => ({
              "survey_metrics.wave_id": id,
              "survey_metrics.wave_date": date,
            })),
            annotation: { measures: {}, dimensions: {} },
          };
        },
      },
      security: { subject: "tester", groups: [], accessScope: { kind: "all" } },
      views: [surveyView],
      sources: sourceRegistry,
    }),
    spec,
    views: [surveyView],
    context,
    sources: sourceRegistry,
    summary: false,
    execute: async (query) => {
      resolved.push(query);
      return { block: block("survey_score", []), sampleForModel: true };
    },
  });
  expect(cubeQueries).toEqual([
    {
      dimensions: ["survey_metrics.wave_id", "survey_metrics.wave_date"],
      limit: 1001,
    },
  ]);
  expect(resolved.map(({ filters }) => filters)).toEqual([
    [
      ...spec.filters!,
      { member: "survey_metrics.wave_id", operator: "equals", values: ["may_late"] },
    ],
  ]);
  expect(result?.block.rows).toEqual([]);
  expect(result?.block.observations).toMatchObject([
    { status: "no_release", occurrence: { id: "may_late" } },
  ]);
});

test("从首期以前开始的月序列保留后来有样本的总体行", async () => {
  const result = await executeObservationView({
    directory: createObservationDirectory({
      cube: {
        load: async () => ({
          data: [...occurrences, { id: "june_wave", date: "2026-06-20" }].map(({ id, date }) => ({
            "survey_metrics.wave_id": id,
            "survey_metrics.wave_date": date,
          })),
          annotation: { measures: {}, dimensions: {} },
        }),
      },
      security: { subject: "tester", groups: [], accessScope: { kind: "all" } },
      views: [surveyView],
      sources: sourceRegistry,
    }),
    spec: {
      id: "query",
      time_view: surveyView.name,
      measures: ["survey_metrics.survey_score"],
      dimensions: ["survey_metrics.department_id"],
      time: { range: { from: "2026-04", to: "2026-07" }, grain: "month" },
    },
    views: [surveyView],
    context,
    sources: sourceRegistry,
    summary: true,
    execute: async (query) => {
      const observed = query.filters?.some((filter) => filter.values?.includes("june_wave"));
      const source = block("survey_score", observed ? [["team_a", 88]] : []);
      if (observed)
        source.summary = {
          kind: "grand_total",
          label: "总体",
          scope: "filtered_set",
          rows: [[null, 88]],
        };
      return { block: source, sampleForModel: true };
    },
  });
  expect(result?.block.observations?.map((period) => period.status)).toEqual([
    "not_observed",
    "observed",
    "observed",
    "no_release",
  ]);
  expect(result?.block.summary?.rows).toEqual([
    [null, "2026", "6", 88],
    [null, "2026", "7", 88],
  ]);
});

test("混合月序列按相同日历键对齐，保留普通直查的列顺序和 Cube 键类型", async () => {
  const result = await executeCalendarAndObservation(
    {
      id: "query",
      time_view: peopleView.name,
      dimensions: ["people_metrics.department_id"],
      measures: ["people_metrics.headcount", "survey_metrics.survey_score"],
      time: { range: { from: "2026-05", to: "2026-06" }, grain: "month" },
    },
    [peopleView, surveyView],
    sourceRegistry,
    context,
    async (spec) => ({
      block:
        spec.time_view === peopleView.name
          ? block(
              "headcount",
              [
                ["team_a", "2026", "5", 40],
                ["team_a", "2026", "6", 42],
              ],
              true,
            )
          : block(
              "survey_score",
              [
                ["team_a", "2026", "5", 70],
                ["team_a", "2026", "6", 70],
              ],
              true,
            ),
      sampleForModel: true,
    }),
  );
  expect(result.block.columns).toEqual([
    "department_id",
    "year",
    "month",
    "headcount",
    "survey_score",
  ]);
  expect(result.block.rows).toEqual([
    ["team_a", "2026", "5", 40, 70],
    ["team_a", "2026", "6", 42, 70],
  ]);
});

test("混合指标由排名指标所在来源选组，同一筛选应用于各列和总体", async () => {
  const applied: { source?: string; groups: (string | null)[][] }[] = [];
  const result = await executeCalendarAndObservation(
    {
      id: "query",
      time_view: peopleView.name,
      dimensions: ["people_metrics.department_id"],
      measures: ["people_metrics.headcount", "survey_metrics.survey_score"],
      time: { range: { from: "2026-05", to: "2026-06" }, grain: "month" },
      selection: {
        type: "top_n",
        window: "anchor",
        dimensions: ["people_metrics.department_id"],
        by: "survey_metrics.survey_score",
        count: 1,
        direction: "desc",
      },
    },
    [peopleView, surveyView],
    sourceRegistry,
    context,
    async (spec, selection, ranking) => {
      if (ranking) {
        expect(spec.measures).toEqual(["survey_metrics.survey_score"]);
        expect(spec.selection?.dimensions).toEqual(["survey_metrics.department_id"]);
        return {
          block: block("survey_score", [["team_b", "2026", "6", 88]], true),
          groupSelection: {
            groups: [["team_b"]],
            filter: {
              member: "survey_metrics.department_id",
              operator: "equals",
              values: ["team_b"],
            },
            outcome: {
              dimensions: ["survey_metrics.department_id"],
              by: "survey_metrics.survey_score",
              window: "anchor",
              direction: "desc",
              requestedCount: 1,
              selectedCount: 1,
              hasMoreGroups: true,
            },
          },
          sampleForModel: true,
        };
      }
      if (!selection) throw new Error("展示子查询必须使用已选分组");
      applied.push({ source: spec.time_view, groups: selection.groups });
      const isPeople = spec.time_view === peopleView.name;
      const value = isPeople ? 42 : 88;
      return {
        block: {
          ...block(isPeople ? "headcount" : "survey_score", [["team_b", "2026", "6", value]], true),
          summary: {
            kind: "grand_total",
            label: "所选分组总体",
            scope: "selected_groups",
            rows: [[null, "2026", "6", value]],
          },
        },
        sampleForModel: true,
      };
    },
  );
  expect(applied).toEqual([
    { source: peopleView.name, groups: [["team_b"]] },
    { source: surveyView.name, groups: [["team_b"]] },
  ]);
  expect(result.block.rows).toEqual([["team_b", "2026", "6", 42, 88]]);
  expect(result.block.summary?.rows).toEqual([[null, "2026", "6", 42, 88]]);
});

test("混合结果按第二来源指标普通排序，而非首个来源顺序", async () => {
  const result = await executeCalendarAndObservation(
    {
      id: "query",
      time_view: peopleView.name,
      dimensions: ["people_metrics.department_id"],
      measures: ["people_metrics.headcount", "survey_metrics.survey_score"],
      time: { cutoff: "2026-06" },
      order: [{ member: "survey_metrics.survey_score", direction: "desc" }],
    },
    [peopleView, surveyView],
    sourceRegistry,
    context,
    async (spec) => ({
      block:
        spec.time_view === peopleView.name
          ? block("headcount", [
              ["team_a", 40],
              ["team_b", 42],
            ])
          : block("survey_score", [
              ["team_b", 88],
              ["team_a", 70],
            ]),
      sampleForModel: true,
    }),
  );
  expect(result.block.rows).toEqual([
    ["team_b", 42, 88],
    ["team_a", 40, 70],
  ]);
});

test("期次折线区分同月甚至同日独立观测，缺样本保持空", () => {
  const trend = {
    id: "query",
    columns: ["observation_id", "observation_date", "measure:survey_score"],
    column_roles: {
      observation_id: "dimension" as const,
      observation_date: "dimension" as const,
      "measure:survey_score": "measure" as const,
    },
    rows: [
      ["may_early", "2026-05-04", 70],
      ["may_same_day", "2026-05-04", null],
      ["may_late", "2026-05-19", 88],
    ],
    row_count: 3,
    observation_axis: { id_column: "observation_id", date_column: "observation_date" },
    observations: [occurrences[0], { id: "may_same_day", date: "2026-05-04" }, occurrences[1]].map(
      (occurrence) => ({ status: "observed" as const, occurrence }),
    ),
    query_notes: [],
  };
  const chart = compileChart(trend, makeTitleOf(trend), {
    type: "line",
    y: ["measure:survey_score"],
  });
  expect(chart?.rows).toEqual([
    { t: "2026-05-04 · may_early", s0: 70 },
    { t: "2026-05-04 · may_same_day", s0: null },
    { t: "2026-05-19", s0: 88 },
  ]);
});

test("同一请求的两个指标列共享时钟目录，不同请求按各自身份读取", async () => {
  const calls: string[] = [];
  const makeDirectory = (subject: string) =>
    createObservationDirectory({
      cube: {
        load: async (_query, security) => {
          calls.push(security.subject);
          return {
            data: [
              {
                "survey_metrics.wave_id": security.subject,
                "survey_metrics.wave_date": "2026-05-04",
              },
            ],
            annotation: { measures: {}, dimensions: {} },
          };
        },
      },
      security: { subject, groups: [], accessScope: { kind: "all" } },
      views: [surveyView],
      sources: sourceRegistry,
    });
  const runColumn = (directory: ReturnType<typeof makeDirectory>, id: string) =>
    executeObservationView({
      directory,
      views: [surveyView],
      sources: sourceRegistry,
      context,
      summary: false,
      spec: {
        id,
        measures: ["survey_metrics.survey_score"],
        time_view: surveyView.name,
        time: { cutoff: "2026-05" },
      },
      execute: async () => ({ block: block("survey_score", []), sampleForModel: true }),
    });
  const directory = makeDirectory("caller_a");
  const [first, second, other] = await Promise.all([
    runColumn(directory, "a"),
    runColumn(directory, "b"),
    runColumn(makeDirectory("caller_b"), "c"),
  ]);
  expect(calls).toEqual(["caller_a", "caller_b"]);
  expect(
    [first, second, other].map((result) => result?.block.observations?.[0]?.occurrence?.id),
  ).toEqual(["caller_a", "caller_a", "caller_b"]);
});

test("观测日期必须精确到日且是有效日历日期", async () => {
  const load = (date: string) =>
    createObservationDirectory({
      cube: {
        load: async () => ({
          data: [{ "survey_metrics.wave_id": "wave", "survey_metrics.wave_date": date }],
          annotation: { measures: {}, dimensions: {} },
        }),
      },
      security: { subject: "tester", groups: [], accessScope: { kind: "all" } },
      views: [surveyView],
      sources: sourceRegistry,
    }).sequence("engagement");
  await expect(load("2026-02-29")).rejects.toThrow("返回的期次信息无效");
  await expect(load("2024-04-31")).rejects.toThrow("返回的期次信息无效");
  await expect(load("2024-02-29")).resolves.toEqual([{ id: "wave", date: "2024-02-29" }]);
  await expect(load("2024-02")).rejects.toThrow("返回的期次信息无效");
});

test("同一请求中的两个时钟分别读取各自锚点，即使期次编码相同", async () => {
  const other: CubeView = {
    ...surveyView,
    name: "second_survey_metrics",
    meta: { ...surveyView.meta, time_source: "second_survey" },
    dimensions: surveyView.dimensions.map((dimension) => ({
      ...dimension,
      name: dimension.name.replace("survey_metrics.", "second_survey_metrics."),
    })),
  };
  const sources = buildTimeSourceRegistry([
    ...sourceRegistry.definitions,
    {
      ...sourceRegistry.by_id.get("engagement")!,
      id: "second_survey",
      reference_source: "second_survey",
    },
  ]);
  const loads: string[] = [];
  const directory = createObservationDirectory({
    cube: {
      load: async (query) => {
        const [id, date] = query.dimensions!;
        loads.push(id);
        return {
          data: [
            { [id]: "first_wave", [date]: id.startsWith("second_") ? "2026-06-04" : "2026-05-04" },
          ],
          annotation: { measures: {}, dimensions: {} },
        };
      },
    },
    security: { subject: "tester", groups: [], accessScope: { kind: "all" } },
    views: [surveyView, other],
    sources,
  });
  const [first, second, again] = await Promise.all([
    directory.sequence("engagement"),
    directory.sequence("second_survey"),
    directory.sequence("engagement"),
  ]);
  expect(loads).toEqual(["survey_metrics.wave_id", "second_survey_metrics.wave_id"]);
  expect(first).toEqual([{ id: "first_wave", date: "2026-05-04" }]);
  expect(second).toEqual([{ id: "first_wave", date: "2026-06-04" }]);
  expect(again).toBe(first);
});
