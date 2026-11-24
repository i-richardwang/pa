/**
 * Analysis 定义、View 意图与视觉偏好拥有独立生命周期。
 * Run 只在需要新数据时执行；仅创建 View 时不得触碰执行器。
 */
import { describe, expect, test } from "bun:test";
import type { Principal } from "../contracts/principal.js";
import {
  STRUCTURE_ARGS,
  createTestAppDatabase,
  semanticAccessStub,
} from "../test_support/dashboard.js";
import { planExecution } from "../semantic_core/execution_plan.js";
import { compilePresentationBlock } from "../presentation_core/chart_config.js";
import type { ViewBlock } from "../semantic_core/query_payload.js";
import type { AnalysisDefinition, SemanticViewIntent } from "../semantic_core/semantic_analysis.js";
import { semanticAnalysisOf, unexpectedExport } from "../test_support/report.js";
import { createAnalysisRepository } from "../storage/analysis_repository.js";
import { createAnalysisService } from "./analysis_service.js";
import type { QueryRunResult } from "./query_pipeline.js";
import type { ViewPreferences } from "../presentation_core/view_preferences.js";

const principal: Principal = { email: "alice@x", roles: ["user"], accessScope: { kind: "all" } };
const definition: AnalysisDefinition = semanticAnalysisOf(STRUCTURE_ARGS).analysis;
const barIntent: SemanticViewIntent = {
  type: "bar",
  category: "dimension:category_level",
  series: ["measure:active_employee_count"],
};

const compiled = {
  plan: planExecution(STRUCTURE_ARGS, { delivery: "identity" }),
  presentation: {
    type: "bar" as const,
    x: "category_level",
    y: ["active_employee_count"],
  },
  render_decl: {
    type: "bar" as const,
    x: "category_level",
    y: ["active_employee_count"],
  },
  routes: [{ status: "direct" as const, result_view_id: "structure" }],
  record_projection_bindings: { views: [] },
  access: semanticAccessStub(principal),
};

const pivotDefinition: AnalysisDefinition = {
  query: {
    measures: ["measure:active_employee_count"],
    dimensions: ["dimension:organization_name", "dimension:department_name"],
    time: { window: { kind: "current_month", month: "2026-07" } },
  },
};
const pivotIntent: SemanticViewIntent = {
  type: "table",
  columns: ["dimension:department_name"],
};
const pivotCompiled = {
  ...compiled,
  presentation: {
    type: "table" as const,
    tableColumns: [
      { kind: "field" as const, column: "department_name" },
      { kind: "metrics" as const },
    ],
  },
  render_decl: {
    type: "table" as const,
    tableColumns: [
      { kind: "field" as const, column: "department_name" },
      { kind: "metrics" as const },
    ],
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
      observation_scopes: ["统计范围"],
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: compiled.render_decl,
  };
}

function serviceWith(rows: ViewBlock["rows"]) {
  const repository = createAnalysisRepository(createTestAppDatabase());
  let executions = 0;
  const service = createAnalysisService({
    createDelivery: unexpectedExport,
    repository,
    execute: async () => {
      executions += 1;
      return resultOf(rows);
    },
    plan: async (_principal, _definition, intent) =>
      intent.type === "table"
        ? {
            ...compiled,
            presentation: {
              type: "table" as const,
            },
            render_decl: {
              type: "table" as const,
            },
          }
        : compiled,
    usage: { log: async () => {} },
  });
  return { repository, service, executions: () => executions };
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
      observation_scopes: ["统计范围"],
      data_as_of: "2026-07",
      time_context: [],
      view,
    },
    fullRowViewBlock: view,
    decl: pivotCompiled.render_decl,
  };
}

function pivotServiceWith(rows: ViewBlock["rows"]) {
  const repository = createAnalysisRepository(createTestAppDatabase());
  const service = createAnalysisService({
    createDelivery: unexpectedExport,
    repository,
    execute: async () => pivotResultOf(rows),
    plan: async () => pivotCompiled,
    usage: { log: async () => {} },
  });
  return { repository, service };
}

describe("analysis service 身份与呈现边界", () => {
  const humanPreferences: ViewPreferences = {
    series: {
      "test_people_metrics.active_employee_count": { color: "#509ee3" },
    },
    value_labels: "main",
  };

  test("运行时形态守卫只影响 RenderBundle，不反向改写 ViewIntent", async () => {
    const { repository, service } = serviceWith([
      ["P5", 10],
      ["P5", 8],
    ]);
    const executed = await service.run(principal, definition, barIntent);
    expect(executed.intent).toEqual(barIntent);
    expect(compilePresentationBlock(executed.fullRowViewBlock, executed.decl).type).toBe("table");
    const stored = await repository.resolveOwnedView(executed.view_id, principal.email);
    expect(stored.view.intent).toEqual(barIntent);
    expect(stored.analysis.id).toBe(executed.analysis_id);
  });

  test("空结果保留 View 声明，数据到位后可重放", async () => {
    const { repository, service } = serviceWith([]);
    const executed = await service.run(principal, definition, barIntent);
    expect(executed.intent.type).toBe("bar");
    expect(
      (await repository.resolveOwnedView(executed.view_id, principal.email)).view.intent.type,
    ).toBe("bar");
  });

  test("预览独立持久化视觉偏好，运行时降级不改写作者选择", async () => {
    const valid = serviceWith([
      ["P5", 10],
      ["P6", 8],
    ]);
    const executed = await valid.service.preview(
      principal,
      definition,
      barIntent,
      humanPreferences,
    );
    expect(executed.preferences).toEqual(humanPreferences);
    expect(
      (await valid.repository.resolveOwnedView(executed.view_id, principal.email)).view.preferences,
    ).toEqual(humanPreferences);

    const degraded = serviceWith([
      ["P5", 10],
      ["P5", 8],
    ]);
    const fallback = await degraded.service.preview(
      principal,
      definition,
      barIntent,
      humanPreferences,
    );
    expect(fallback.intent).toEqual(barIntent);
    expect(fallback.preferences).toEqual(humanPreferences);
    expect(compilePresentationBlock(fallback.fullRowViewBlock, fallback.decl).type).toBe("table");
  });

  test("表格布局不可用时保留 View 声明", async () => {
    const { repository, service } = pivotServiceWith([
      ["公司", "研发", 10],
      ["公司", "研发", 8],
    ]);
    const executed = await service.run(principal, pivotDefinition, pivotIntent);
    expect(executed.intent).toEqual(pivotIntent);
    expect(compilePresentationBlock(executed.fullRowViewBlock, executed.decl).type).toBe("table");
    expect(
      (await repository.resolveOwnedView(executed.view_id, principal.email)).view.intent,
    ).toEqual(pivotIntent);
  });

  test("仅新建 View 不执行查询，并复用 Analysis 身份", async () => {
    const current = serviceWith([
      ["P5", 10],
      ["P6", 8],
    ]);
    const original = await current.service.preview(
      principal,
      definition,
      barIntent,
      humanPreferences,
    );
    expect(current.executions()).toBe(1);

    const materialized = await current.service.materializeView(
      principal,
      original.analysis_id,
      { type: "table" },
      {},
    );
    expect(current.executions()).toBe(1);
    expect(materialized.analysis.id).toBe(original.analysis_id);
    expect(materialized.view.id).not.toBe(original.view_id);
    expect(materialized.view.intent).toEqual({ type: "table" });
  });

  test("rerun 重新取数但只派生 View，原 View 不变且新 View 可重放", async () => {
    const current = serviceWith([
      ["P5", 10],
      ["P6", 8],
    ]);
    const original = await current.service.preview(
      principal,
      definition,
      barIntent,
      humanPreferences,
    );
    const rerun = await current.service.rerun(principal, original.analysis_id, { type: "table" });

    expect(rerun.analysis_id).toBe(original.analysis_id);
    expect(rerun.view_id).not.toBe(original.view_id);
    expect(
      (await current.repository.resolveOwnedView(original.view_id, principal.email)).view.intent
        .type,
    ).toBe("bar");
    expect(
      (await current.repository.resolveOwnedView(original.view_id, principal.email)).view
        .preferences,
    ).toEqual(humanPreferences);
    expect(
      (await current.repository.resolveOwnedView(rerun.view_id, principal.email)).view.intent.type,
    ).toBe("table");

    const replayed = await current.service.replay(principal, rerun.view_id);
    expect(replayed.analysis_id).toBe(original.analysis_id);
    expect(replayed.view_id).toBe(rerun.view_id);
    expect(replayed.intent.type).toBe("table");
    expect(replayed.presentation.type).toBe("table");
    expect(current.executions()).toBe(3);
  });

  test("定义被拒同样留下使用记录：最常见的失败不能在观察面上消失", async () => {
    const logged: { outcome: string; error?: string; tool: string }[] = [];
    const service = createAnalysisService({
      createDelivery: unexpectedExport,
      repository: createAnalysisRepository(createTestAppDatabase()),
      plan: async () => {
        throw new Error("不应规划");
      },
      execute: async () => {
        throw new Error("不应执行");
      },
      usage: {
        log: async (record) => {
          logged.push({
            outcome: record.outcome,
            ...(record.error ? { error: record.error } : {}),
            tool: record.tool,
          });
        },
      },
    });
    await expect(
      service.run(
        principal,
        // 定义里没有并列查询的落脚点：越过类型验被拒时仍然留痕。
        { queries: [definition, definition] } as unknown as AnalysisDefinition,
        { type: "table" },
      ),
    ).rejects.toThrow(/query\.measures/);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tool: "run_analysis", outcome: "error" });
    expect(logged[0].error).toMatch(/query\.measures/);
  });
});
