import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  ANALYSIS_DEFINITION_INPUT,
  SEMANTIC_VIEW_INTENT_INPUT,
  type AnalysisDefinition,
  type SemanticViewIntent,
} from "../semantic_core/semantic_analysis.js";
import { analysisResult } from "./analysis_result.js";
import type { McpRegistrationContext } from "./context.js";
import type { AnalysisService } from "../application/analysis_service.js";
import type { PresentationService } from "../application/presentation_service.js";
import type { UsageService } from "../application/usage_service.js";
import { safeMcpToolHandler } from "./errors.js";
import {
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  LOAD_ANALYSIS_OUTPUT,
  RUN_OUTPUT,
  SHOW_ANALYSIS_OUTPUT,
  TOOL_DESCRIPTIONS,
  UI_RESOURCE_URI,
  WRITE_ANNOTATIONS,
} from "./contracts.js";

export function registerAnalysisTools(
  context: McpRegistrationContext & {
    analysis: Pick<AnalysisService, "run" | "rerun" | "replay" | "ensureOwned">;
    presentation: Pick<PresentationService, "compile" | "runtimeFallbacks">;
    usage: Pick<UsageService, "wrap">;
  },
): void {
  const { server, principal, logger, analysis, presentation, usage } = context;
  const caller = principal.email;

  server.registerTool(
    "run_analysis",
    {
      title: "执行人才分析",
      description: TOOL_DESCRIPTIONS.run_analysis,
      inputSchema: {
        analysis: ANALYSIS_DEFINITION_INPUT.describe(
          "数据问题，与 view 平级。query 使用共同期间，composition 用稳定实体维度拼接独立选期的指标列",
        ),
        view: SEMANTIC_VIEW_INTENT_INPUT.describe("呈现意图；顶层参数，不嵌在 analysis 内"),
      },
      outputSchema: RUN_OUTPUT,
      annotations: WRITE_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        "openai/toolInvocation/invoking": "正在执行人才分析…",
        "openai/toolInvocation/invoked": "分析结果已就绪",
      },
    },
    safeMcpToolHandler(
      logger,
      "run_analysis",
      async (input: { analysis: AnalysisDefinition; view: SemanticViewIntent }) =>
        analysisResult(presentation, await analysis.run(principal, input.analysis, input.view)),
    ),
  );

  server.registerTool(
    "rerun_analysis",
    {
      title: "重新运行分析",
      description: TOOL_DESCRIPTIONS.rerun_analysis,
      inputSchema: {
        analysis_id: z.string().uuid().describe("run_analysis 返回的 analysis_id"),
        view: SEMANTIC_VIEW_INTENT_INPUT,
      },
      outputSchema: RUN_OUTPUT,
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    safeMcpToolHandler(
      logger,
      "rerun_analysis",
      async (input: { analysis_id: string; view: SemanticViewIntent }) =>
        analysisResult(
          presentation,
          await analysis.rerun(principal, input.analysis_id, input.view),
        ),
    ),
  );

  registerAppTool(
    server,
    "show_analysis",
    {
      title: "展示分析结果",
      description: TOOL_DESCRIPTIONS.show_analysis,
      inputSchema: {
        view_id: z
          .string()
          .uuid()
          .describe("run_analysis、rerun_analysis 或 find_report 返回的 view_id"),
      },
      outputSchema: SHOW_ANALYSIS_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { resourceUri: UI_RESOURCE_URI, visibility: ["model"] },
        "openai/outputTemplate": UI_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在打开分析结果…",
        "openai/toolInvocation/invoked": "分析结果卡已就绪",
      },
    },
    safeMcpToolHandler(
      logger,
      "show_analysis",
      usage.wrap({ tool: "show_analysis", caller }, async (input: { view_id: string }) => {
        await analysis.ensureOwned(principal, input.view_id);
        const payload = { view_id: input.view_id };
        return {
          content: [{ type: "text" as const, text: "分析结果卡已打开。" }],
          structuredContent: payload,
        };
      }),
    ),
  );

  registerAppTool(
    server,
    "load_analysis_result",
    {
      title: "加载分析结果",
      description: TOOL_DESCRIPTIONS.load_analysis_result,
      inputSchema: {
        view_id: z.string().uuid().describe("当前结果卡从 show_analysis 接收的 view_id"),
      },
      outputSchema: LOAD_ANALYSIS_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { visibility: ["model"] },
      },
    },
    safeMcpToolHandler(logger, "load_analysis_result", async (input: { view_id: string }) =>
      analysisResult(presentation, await analysis.replay(principal, input.view_id), {
        includeDefinition: true,
      }),
    ),
  );

  registerAppTool(
    server,
    "load_analysis_card",
    {
      title: "加载分析卡片",
      description: TOOL_DESCRIPTIONS.load_analysis_card,
      inputSchema: {
        view_id: z.string().uuid().describe("当前结果卡的 view_id"),
      },
      outputSchema: RUN_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { visibility: ["app"] },
      },
    },
    safeMcpToolHandler(logger, "load_analysis_card", async (input: { view_id: string }) =>
      analysisResult(presentation, await analysis.replay(principal, input.view_id)),
    ),
  );
}
