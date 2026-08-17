import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  SEMANTIC_CHART_INPUT,
  SEMANTIC_ANALYSIS_SPEC_INPUT,
  type SemanticChart,
  type SemanticAnalysisSpec,
} from "../semantic_core/semantic_analysis.js";
import { analysisResult } from "./analysis_result.js";
import type { McpRegistrationContext } from "./context.js";
import {
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  LOAD_ANALYSIS_OUTPUT,
  RUN_OUTPUT,
  SHOW_ANALYSIS_OUTPUT,
  TOOL_DESCRIPTIONS,
  UI_RESOURCE_URI,
} from "./contracts.js";

export function registerAnalysisTools(context: McpRegistrationContext): void {
  const { server, dependencies, principal, caller, analysis } = context;

  server.registerTool(
    "run_analysis",
    {
      title: "执行人才分析",
      description: TOOL_DESCRIPTIONS.run_analysis,
      inputSchema: { spec: SEMANTIC_ANALYSIS_SPEC_INPUT },
      outputSchema: RUN_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        "openai/toolInvocation/invoking": "正在执行人才分析…",
        "openai/toolInvocation/invoked": "分析结果已就绪",
      },
    },
    async (input: { spec: SemanticAnalysisSpec }) =>
      analysisResult(dependencies.runtime, await analysis.run(principal, input.spec)),
  );

  server.registerTool(
    "rerun_analysis",
    {
      title: "重新呈现分析",
      description: TOOL_DESCRIPTIONS.rerun_analysis,
      inputSchema: {
        analysis_id: z.string().uuid().describe("run_analysis 返回的 analysis_id"),
        presentation: SEMANTIC_CHART_INPUT,
      },
      outputSchema: RUN_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    async (input: { analysis_id: string; presentation: SemanticChart }) =>
      analysisResult(
        dependencies.runtime,
        await analysis.rerun(principal, input.analysis_id, input.presentation),
      ),
  );

  registerAppTool(
    server,
    "show_analysis",
    {
      title: "展示分析结果",
      description: TOOL_DESCRIPTIONS.show_analysis,
      inputSchema: {
        analysis_id: z
          .string()
          .uuid()
          .describe("run_analysis、rerun_analysis 或 find_report 返回的 analysis_id"),
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
    dependencies.usage.wrap(
      { tool: "show_analysis", caller },
      async (input: { analysis_id: string }) => {
        await analysis.ensureOwned(principal, input.analysis_id);
        const payload = { analysis_id: input.analysis_id };
        return {
          content: [{ type: "text" as const, text: "分析结果卡已打开。" }],
          structuredContent: payload,
        };
      },
    ),
  );

  registerAppTool(
    server,
    "load_analysis_result",
    {
      title: "加载分析结果",
      description: TOOL_DESCRIPTIONS.load_analysis_result,
      inputSchema: {
        analysis_id: z.string().uuid().describe("当前结果卡从 show_analysis 接收的 analysis_id"),
      },
      outputSchema: LOAD_ANALYSIS_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { visibility: ["model"] },
      },
    },
    async (input: { analysis_id: string }) =>
      analysisResult(dependencies.runtime, await analysis.replay(principal, input.analysis_id), {
        includeSpec: true,
      }),
  );

  registerAppTool(
    server,
    "load_analysis_card",
    {
      title: "加载分析卡片",
      description: TOOL_DESCRIPTIONS.load_analysis_card,
      inputSchema: {
        analysis_id: z.string().uuid().describe("当前结果卡的 analysis_id"),
      },
      outputSchema: RUN_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { visibility: ["app"] },
      },
    },
    async (input: { analysis_id: string }) =>
      analysisResult(dependencies.runtime, await analysis.replay(principal, input.analysis_id)),
  );
}
