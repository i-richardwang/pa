/**
 * 执行落句柄边界的呈现归一：非空结果画不出声明的图表时，句柄与回显的语义规格
 * 当场归一为表格（不留「声明是图、呈现是表」的冲突态）；空结果保留声明，
 * 数据到位后重跑自然出图。
 */
import { describe, expect, test } from "bun:test";
import type { Principal } from "../engine/cube_security.js";
import { STRUCTURE_ARGS, createTestAppDatabase } from "../test_support/dashboard.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { compilePresentationBlock } from "../presentation_core/chart_config.js";
import type { ViewBlock } from "../semantic_core/query_payload.js";
import { parseSemanticAnalysisSpec } from "../semantic_core/semantic_analysis.js";
import { semanticSpecOf } from "../test_support/report.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import { createAnalysisService } from "./analysis_service.js";
import type { QueryRunResult } from "./query_pipeline.js";

const principal: Principal = { email: "alice@x", roles: [], orgScope: "*" };

const semanticSpec = parseSemanticAnalysisSpec({
  ...semanticSpecOf(STRUCTURE_ARGS),
  presentation: {
    type: "bar",
    category: "test_people_metrics.category_level",
    series: ["test_people_metrics.active_employee_count"],
  },
});

const compiled = {
  plan: planExecution(STRUCTURE_ARGS),
  presentation: { type: "bar" as const, x: "category_level", y: ["active_employee_count"] },
  routes: [{ status: "direct" as const, view_id: "structure" }],
  record_projection_bindings: { views: [] },
};

const pivotSemanticSpec = parseSemanticAnalysisSpec({
  version: 2,
  analysis: {
    views: [
      {
        id: "structure",
        measures: ["test_people_metrics.active_employee_count"],
        dimensions: [
          "test_people_metrics.organization_name",
          "test_people_metrics.department_name",
        ],
        time: {
          window: { kind: "current_month", month: "2026-07" },
        },
      },
    ],
  },
  presentation: {
    type: "table",
    columns: ["test_people_metrics.department_name"],
  },
});

const pivotCompiled = {
  ...compiled,
  presentation: {
    type: "table" as const,
    y: [],
    tableLayout: {
      rows: [{ kind: "field" as const, column: "organization_name" }],
      columns: [
        { kind: "field" as const, column: "department_name" },
        { kind: "metrics" as const },
      ],
    },
  },
};

function resultOf(rows: ViewBlock["rows"]): QueryRunResult {
  const view: ViewBlock = {
    id: "structure",
    columns: ["category_level", "active_employee_count"],
    column_roles: { category_level: "dimension", active_employee_count: "measure" },
    column_formats: { active_employee_count: "number" },
    rows,
    row_count: rows.length,
    query_notes: [],
  };
  return {
    payload: {
      default_population_scope: "统计范围",
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: { type: "bar", x: "category_level", y: ["active_employee_count"] },
  };
}

function serviceWith(rows: ViewBlock["rows"]) {
  const repository = createAnalysisRepository(createTestAppDatabase());
  const service = createAnalysisService({
    repository,
    execute: async () => resultOf(rows),
    compile: async () => compiled,
    usage: { log: async () => {} },
  });
  return { repository, service };
}

function pivotResultOf(rows: ViewBlock["rows"]): QueryRunResult {
  const view: ViewBlock = {
    id: "structure",
    columns: ["organization_name", "department_name", "active_employee_count"],
    column_roles: {
      organization_name: "dimension",
      department_name: "dimension",
      active_employee_count: "measure",
    },
    column_formats: { active_employee_count: "number" },
    rows,
    row_count: rows.length,
    query_notes: [],
  };
  return {
    payload: {
      default_population_scope: "统计范围",
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: pivotCompiled.presentation,
  };
}

function pivotServiceWith(rows: ViewBlock["rows"]) {
  const repository = createAnalysisRepository(createTestAppDatabase());
  const service = createAnalysisService({
    repository,
    execute: async () => pivotResultOf(rows),
    compile: async () => pivotCompiled,
    usage: { log: async () => {} },
  });
  return { repository, service };
}

describe("analysis service 呈现归一", () => {
  test("非空结果画不出声明图表：句柄与回显的呈现声明归一为表格", async () => {
    // 分类值全部重复：bar 的分类轴不成角色，图编译为空
    const { repository, service } = serviceWith([
      ["P5", 10],
      ["P5", 8],
    ]);
    const executed = await service.run(principal, semanticSpec);
    expect(executed.spec.presentation).toEqual({ type: "table" });
    const stored = await repository.resolveOwned(executed.analysis_id, principal.email);
    expect(stored.spec.presentation).toEqual({ type: "table" });
  });

  test("空结果保留图表声明：数据到位后重跑即可出图", async () => {
    const { repository, service } = serviceWith([]);
    const executed = await service.run(principal, semanticSpec);
    expect(executed.spec.presentation.type).toBe("bar");
    const stored = await repository.resolveOwned(executed.analysis_id, principal.email);
    expect(stored.spec.presentation.type).toBe("bar");
  });

  test("形态满足声明时规格原样落库", async () => {
    const { repository, service } = serviceWith([
      ["P5", 10],
      ["P6", 8],
    ]);
    const executed = await service.run(principal, semanticSpec);
    expect(executed.spec.presentation.type).toBe("bar");
    const stored = await repository.resolveOwned(executed.analysis_id, principal.email);
    expect(stored.spec.presentation.type).toBe("bar");
  });

  test("表格布局不可用时保留语义声明并显式报告状态", async () => {
    const { repository, service } = pivotServiceWith([
      ["公司", "研发", 10],
      ["公司", "研发", 8],
    ]);
    const executed = await service.run(principal, pivotSemanticSpec);
    expect(executed.spec.presentation).toEqual(pivotSemanticSpec.presentation);
    expect(compilePresentationBlock(executed.fullRowViewBlock, executed.decl)).toMatchObject({
      table_layout: { state: "unavailable", reason: "duplicate_coordinate" },
    });
    const stored = await repository.resolveOwned(executed.analysis_id, principal.email);
    expect(stored.spec.presentation).toEqual(pivotSemanticSpec.presentation);
  });

  test("空结果与可成矩阵结果都原样保留 columns 声明", async () => {
    const empty = pivotServiceWith([]);
    const emptyExecuted = await empty.service.run(principal, pivotSemanticSpec);
    expect(emptyExecuted.spec.presentation).toEqual(pivotSemanticSpec.presentation);

    const applied = pivotServiceWith([
      ["公司", "研发", 10],
      ["公司", "销售", 8],
      ["海外", "研发", 6],
      ["海外", "销售", 4],
    ]);
    const appliedExecuted = await applied.service.run(principal, pivotSemanticSpec);
    expect(appliedExecuted.spec.presentation).toEqual(pivotSemanticSpec.presentation);
  });

  test("重新呈现派生新句柄，原句柄不变且新句柄可按新呈现重放", async () => {
    const repository = createAnalysisRepository(createTestAppDatabase());
    const service = createAnalysisService({
      repository,
      execute: async () =>
        resultOf([
          ["P5", 10],
          ["P6", 8],
        ]),
      compile: async (_principal, spec) => ({
        ...compiled,
        presentation:
          spec.presentation.type === "table"
            ? { type: "table" as const, y: [] }
            : compiled.presentation,
      }),
      usage: { log: async () => {} },
    });

    const original = await service.run(principal, semanticSpec);
    const rerun = await service.rerun(principal, original.analysis_id, { type: "table" });

    expect(rerun.analysis_id).not.toBe(original.analysis_id);
    expect(
      (await repository.resolveOwned(original.analysis_id, principal.email)).spec.presentation
        ?.type,
    ).toBe("bar");
    expect(
      (await repository.resolveOwned(rerun.analysis_id, principal.email)).spec.presentation?.type,
    ).toBe("table");

    const replayed = await service.replay(principal, rerun.analysis_id);
    expect(replayed.analysis_id).toBe(rerun.analysis_id);
    expect(replayed.spec.presentation.type).toBe("table");
    expect(replayed.presentation.type).toBe("table");
  });
});
