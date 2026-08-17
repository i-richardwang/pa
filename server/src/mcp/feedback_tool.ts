import { z } from "zod";
import type { FeedbackInput } from "../contracts/feedback_input.js";
import { FEEDBACK_LIMITS } from "../contracts/dashboard_contract.js";
import type { McpRegistrationContext } from "./context.js";
import { OAUTH_SECURITY_SCHEMES, TOOL_DESCRIPTIONS, WRITE_ANNOTATIONS } from "./contracts.js";

export function registerFeedbackTool(context: McpRegistrationContext): void {
  const { server, dependencies, principal, caller } = context;
  server.registerTool(
    "feedback",
    {
      title: "反馈数据能力缺口",
      description: TOOL_DESCRIPTIONS.feedback,
      inputSchema: {
        ask: z
          .string()
          .min(1)
          .max(FEEDBACK_LIMITS.ask)
          .describe("用户问题原文；不要放人员名单、工号或其他逐人信息"),
        detail: z
          .string()
          .min(1)
          .max(FEEDBACK_LIMITS.detail)
          .describe("缺什么、已尝试什么、为何现有目录无法满足"),
      },
      outputSchema: {
        id: z.number().int().positive().describe("本次反馈记录编号"),
        topic_key: z.string().describe("同类反馈的聚合主题编号"),
        status: z.literal("open").describe("待管理员审核"),
        message: z.string().describe("反馈与正式生效边界说明"),
      },
      annotations: WRITE_ANNOTATIONS,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    },
    dependencies.usage.wrap({ tool: "feedback", caller }, async (input: FeedbackInput) => {
      const payload = await dependencies.feedback.submit(principal, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }),
  );
}
