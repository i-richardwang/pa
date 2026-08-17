import type { Principal } from "../engine/cube_security.js";
import type { QueryRunResult } from "./query_pipeline.js";
import type { ExecutionPlan } from "../semantic_core/execution_plan.js";
import type { PresentationSpec } from "../presentation_core/presentation_spec.js";
import { compilePresentationBlock } from "../presentation_core/chart_config.js";
import {
  parseSemanticAnalysisSpec,
  withTablePresentation,
  type SemanticChart,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import type { CompiledSemanticAnalysis } from "../engine/semantic_analysis_compiler.js";
import type { AnalysisRecord, AnalysisRepository } from "../ports/analysis_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { RecordProjectionBindings } from "../contracts/record_projection_contract.js";

/** 执行器只收不透明 plan——由 compiler 产出后直接递入。 */
type ExecuteAnalysis = (
  principal: Principal,
  plan: ExecutionPlan,
  presentation: PresentationSpec,
) => Promise<QueryRunResult>;

/** 语义编译入口：语义规格 → 私有执行计划 + 已解析物理呈现。 */
type CompileSemantic = (
  principal: Principal,
  spec: SemanticAnalysisSpec,
) => Promise<CompiledSemanticAnalysis>;

export type ExecutedAnalysis = QueryRunResult & {
  analysis_id: string;
  /** 本次执行的语义规格（句柄回显用）。 */
  spec: SemanticAnalysisSpec;
  /** 编译解析出的物理呈现——供图表装配与运行期降级说明。 */
  presentation: PresentationSpec;
  /** 最终结果格可以投影到的受控记录集绑定。 */
  record_projection_bindings: RecordProjectionBindings;
};

export function createAnalysisService(deps: {
  repository: AnalysisRepository;
  execute: ExecuteAnalysis;
  compile: CompileSemantic;
  usage: Pick<UsageLog, "log">;
}) {
  async function executeAndLog(input: {
    principal: Principal;
    /** 本次执行的语义规格：落库为句柄、回显给编辑器。 */
    spec: SemanticAnalysisSpec;
    /** 该语义规格的编译产物（执行器只消费 compiled.plan，图表消费 compiled.presentation）。 */
    compiled: CompiledSemanticAnalysis;
    tool: "run_analysis" | "rerun_analysis" | "report_replay" | "replay";
    analysisId?: string;
    existing?: AnalysisRecord;
    createHandle: boolean;
    args: unknown;
  }): Promise<ExecutedAnalysis> {
    const started = performance.now();
    const { spec, compiled } = input;
    const title = spec.analysis.title;
    try {
      const result = await deps.execute(input.principal, compiled.plan, compiled.presentation);
      // 非空结果画不出声明图表时，当场归一为表格；表格布局失败保留原声明并由呈现状态明确说明，
      // 不能因一次结果形态改变用户的行列意图。
      const presentationBlock = compilePresentationBlock(result.fullRowViewBlock, result.decl);
      const degraded =
        result.fullRowViewBlock.rows.length > 0 &&
        compiled.presentation.type !== "table" &&
        presentationBlock.type === "table";
      const settledSpec = input.createHandle && degraded ? withTablePresentation(spec) : spec;
      const handle = input.createHandle
        ? await deps.repository.create(input.principal.email, settledSpec)
        : (input.existing ??
          (await deps.repository.resolveOwned(input.analysisId ?? "", input.principal.email)));
      const payload = { ...result.payload, analysis_id: handle.id };
      await deps.usage.log({
        caller: input.principal.email,
        tool: input.tool,
        ...(title ? { title } : {}),
        args: input.args,
        outcome: "ok",
        row_count: payload.view.row_count,
        has_more: payload.view.has_more,
        duration_ms: performance.now() - started,
        analysis_id: handle.id,
      });
      return {
        ...result,
        payload,
        analysis_id: handle.id,
        spec: handle.spec,
        presentation: compiled.presentation,
        record_projection_bindings: compiled.record_projection_bindings,
      };
    } catch (error) {
      await deps.usage.log({
        caller: input.principal.email,
        tool: input.tool,
        ...(title ? { title } : {}),
        args: input.args,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: performance.now() - started,
        ...(input.analysisId ? { analysis_id: input.analysisId } : {}),
      });
      throw error;
    }
  }

  async function run(
    principal: Principal,
    rawSpec: SemanticAnalysisSpec,
  ): Promise<ExecutedAnalysis> {
    const spec = parseSemanticAnalysisSpec(rawSpec);
    const compiled = await deps.compile(principal, spec);
    return executeAndLog({
      principal,
      spec,
      compiled,
      tool: "run_analysis",
      createHandle: true,
      args: { spec },
    });
  }

  async function rerun(
    principal: Principal,
    analysisId: string,
    presentation: SemanticChart,
  ): Promise<ExecutedAnalysis> {
    const handle = await deps.repository.resolveOwned(analysisId, principal.email);
    const spec = parseSemanticAnalysisSpec({ ...handle.spec, presentation });
    const compiled = await deps.compile(principal, spec);
    return executeAndLog({
      principal,
      spec,
      compiled,
      tool: "rerun_analysis",
      analysisId,
      createHandle: true,
      args: { analysis_id: analysisId, presentation },
    });
  }

  async function replay(principal: Principal, analysisId: string): Promise<ExecutedAnalysis> {
    const handle = await deps.repository.resolveOwned(analysisId, principal.email);
    const compiled = await deps.compile(principal, handle.spec);
    return executeAndLog({
      principal,
      spec: handle.spec,
      compiled,
      tool: "replay",
      analysisId,
      existing: handle,
      createHandle: false,
      args: { analysis_id: analysisId },
    });
  }

  // 只校验句柄归属与有效期，不执行查询；供结果卡挂载入口在创建 UI 前 fail-closed。
  async function ensureOwned(principal: Principal, analysisId: string): Promise<void> {
    await deps.repository.resolveOwned(analysisId, principal.email);
  }

  // 报告/看板运行：复用 Report 指向的不可变 Analysis，不复制规格、不铸造新句柄。
  async function executeReferenced(
    principal: Principal,
    analysis: AnalysisRecord,
    compiled: CompiledSemanticAnalysis,
    reportId: string,
  ): Promise<ExecutedAnalysis> {
    return executeAndLog({
      principal,
      spec: analysis.spec,
      compiled,
      tool: "report_replay",
      analysisId: analysis.id,
      existing: analysis,
      createHandle: false,
      args: { report_id: reportId },
    });
  }

  async function preview(
    principal: Principal,
    spec: SemanticAnalysisSpec,
    compiled: CompiledSemanticAnalysis,
  ): Promise<ExecutedAnalysis> {
    return executeAndLog({
      principal,
      spec,
      compiled,
      tool: "run_analysis",
      createHandle: true,
      args: { spec, source: "editor" },
    });
  }

  return { run, rerun, replay, ensureOwned, executeReferenced, preview };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;
