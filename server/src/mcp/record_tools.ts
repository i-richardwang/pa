import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { RecordProjectionPayload } from "../contracts/record_projection_contract.js";
import { RECORD_PROJECTION_META_KEY } from "../contracts/record_projection_contract.js";
import type { McpRegistrationContext } from "./context.js";
import type { RecordProjectionService } from "../application/record_projection_service.js";
import type { UsageService } from "../application/usage_service.js";
import { safeMcpHandler } from "./errors.js";
import {
  OAUTH_SECURITY_SCHEMES,
  READ_ONLY_ANNOTATIONS,
  RECORDS_OUTPUT,
  RECORDS_UI_RESOURCE_URI,
  TOOL_DESCRIPTIONS,
} from "./contracts.js";

const recordSummary = (viewId: string, payload: RecordProjectionPayload) => ({
  view_id: viewId,
  metric_id: payload.metric_id,
  metric_title: payload.metric_title,
  record_set_title: payload.record_set_title,
  record_set_description: payload.record_set_description,
  offset: payload.offset,
  displayed_records: payload.rows.length,
  has_more: payload.has_more,
  ...(payload.limit_reached ? { limit_reached: true as const } : {}),
  data_as_of: payload.data_as_of,
  data_changed: payload.data_changed,
});

const result = (viewId: string, payload: RecordProjectionPayload) => {
  const summary = recordSummary(viewId, payload);
  return {
    content: [{ type: "text" as const, text: "人员名单已打开。" }],
    structuredContent: summary,
    _meta: { [RECORD_PROJECTION_META_KEY]: payload },
  };
};

export function registerRecordTools(
  context: McpRegistrationContext & {
    records: Pick<RecordProjectionService, "runAnalysis">;
    usage: Pick<UsageService, "wrap">;
  },
): void {
  const { server, principal, records, usage } = context;
  const caller = principal.email;

  registerAppTool(
    server,
    "show_records",
    {
      title: "展示人员名单",
      description: TOOL_DESCRIPTIONS.show_records,
      inputSchema: {
        view_id: z.string().uuid().describe("run_analysis 返回的 view_id"),
        metric_id: z
          .string()
          .optional()
          .describe("分析中有多个可查看名单的指标时，指定需要展开的语义指标 id"),
      },
      outputSchema: RECORDS_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { resourceUri: RECORDS_UI_RESOURCE_URI, visibility: ["model"] },
        "openai/outputTemplate": RECORDS_UI_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在加载人员名单…",
        "openai/toolInvocation/invoked": "人员名单已就绪",
      },
    },
    safeMcpHandler(
      "show_records",
      usage.wrap(
        { tool: "show_records", caller },
        async (input: { view_id: string; metric_id?: string }) =>
          result(
            input.view_id,
            await records.runAnalysis(principal, input.view_id, {
              ...(input.metric_id ? { metricId: input.metric_id } : {}),
              limit: 20,
            }),
          ),
      ),
    ),
  );

  registerAppTool(
    server,
    "load_records_page",
    {
      title: "加载名单分页",
      description: TOOL_DESCRIPTIONS.load_records_page,
      inputSchema: {
        view_id: z.string().uuid().describe("当前名单卡的 view_id"),
        metric_id: z.string().describe("当前名单卡的语义指标 id"),
        data_as_of: z.string().describe("当前名单卡的数据截至月份，用于识别翻页期间的数据刷新"),
        offset: z.number().int().nonnegative().max(49_999),
        limit: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: RECORDS_OUTPUT,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
        ui: { visibility: ["app"] },
      },
    },
    safeMcpHandler(
      "load_records_page",
      async (input: {
        view_id: string;
        metric_id: string;
        data_as_of: string;
        offset: number;
        limit: number;
      }) =>
        result(
          input.view_id,
          await records.runAnalysis(principal, input.view_id, {
            metricId: input.metric_id,
            dataAsOf: input.data_as_of,
            offset: input.offset,
            limit: input.limit,
          }),
        ),
    ),
  );
}
