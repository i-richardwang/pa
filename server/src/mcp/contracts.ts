import { z } from "zod";
import {
  QUERY_PAYLOAD_OUTPUT,
  COLUMN_FORMATS,
  PUBLIC_TIME_CONTEXT_SCHEMA,
} from "../semantic_core/query_payload.js";
import {
  ANALYSIS_DEFINITION_INPUT,
  SEMANTIC_VIEW_INTENT_INPUT,
} from "../semantic_core/semantic_analysis.js";
import { METRIC_TIME_INPUT } from "../semantic_core/time_contract.js";
import { BUSINESS_TERM_RESOLUTION_SCHEMA } from "../contracts/business_term_contract.js";
import { EXPORT_TICKET_TTL_MINUTES } from "../contracts/export_contract.js";
import { ACCESS_SCOPE_DEFINITION_SCHEMA } from "../contracts/access_scope.js";
import {
  MEASURE_QUERY_CAPABILITIES_SCHEMA,
  MEASURE_DATA_AS_OF_SCHEMA,
} from "../contracts/catalog_contract.js";

export const SERVER_INSTRUCTIONS =
  "用 catalog(terms) 取可见语义 id，遵守 query_capabilities、time.constraints 和 report_calculations。取值用 values_of，术语有歧义先确认。按要求选范围和对比，只用正式指标，不开放 SQL。" +
  "同期间用 query，逐列选期用 composition。用 time.constraints.observation 指向的维度查期次编码。" +
  "明细限单结果格、单时间桶且 records_available 的分析，逐人数据只在 PA 记录卡展示。";

export const TOOL_DESCRIPTIONS = {
  catalog:
    "发现当前调用者可用的 PA 指标、维度与业务术语解释。查数时传 terms 按业务概念筛选；不传 terms 返回全部成员，响应很大，只在需要浏览全部能力时使用。成员 id 可直接用于分析。",
  values_of: "搜索一个分类维度在当前调用者权限范围内的真实值，可按子串收窄。",
  run_analysis:
    "用目录语义 id 执行分析。同期间多指标用 query，按稳定实体并列不同期间用 composition 和 table。失败返回含 code/details 的错误 JSON。",
  rerun_analysis: "用当前数据重新运行已有的 analysis_id，并生成新的 view_id；分析定义不变。",
  show_analysis: "为本人已有的 view_id 打开交互结果卡；只负责展示，不修改或重新执行分析。",
  load_analysis_result: "按 view_id 加载本人的分析定义、呈现意图和当前结果，供 Agent 继续修改。",
  load_analysis_card: "按 view_id 加载当前结果，仅供 PA 结果卡渲染使用。",
  show_records:
    "打开本人分析里某个结果格的明细记录（需单个结果格、单个时间桶）；筛选人群请写在分析 filters 里，不能用 dimensions 展开名单。",
  load_records_page: "按 view_id 分页加载明细记录，仅供 PA 记录卡渲染使用。",
  export_result: `为本人的 view_id 生成 CSV 下载链接，${EXPORT_TICKET_TTL_MINUTES} 分钟内有效。`,
  save_report: "把本人的 view_id 保存为报告；不重新执行查询。",
  update_report: "修改本人报告的名称、当前使用的 view_id 或归档状态。",
  find_report: "按名称查找本人未归档的报告，返回当前的 analysis_id、view_id 和控制台链接。",
  feedback:
    "当前目录满足不了用户需求时，提交数据能力缺口；不影响本次回答，也不会直接修改指标或口径。",
} as const;

// MCP SDK 通过 _meta 序列化工具安全声明；OAuth 验签由 HTTP transport 边界执行。
export const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp"] }] as const;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const UI_RESOURCE_URI = "ui://pa/result.html";
export const RECORDS_UI_RESOURCE_URI = "ui://pa/records.html";
export const UI_RESOURCE_META = {
  prefersBorder: false,
  csp: { connectDomains: [], resourceDomains: [] },
};
export const OPENAI_WIDGET_CSP = {
  connect_domains: [],
  resource_domains: [],
} as const;

const CATALOG_MEMBER_OUTPUT = z.strictObject({
  id: z.string().describe("稳定的语义成员 id；分析和 values_of 都用它引用成员"),
  title: z.string(),
  description: z.string(),
  format: z
    .enum(COLUMN_FORMATS)
    .optional()
    .describe("显示格式；percent 和 percentage_point 的原始值都是 0–1 的小数"),
  ai_context: z
    .string()
    .optional()
    .describe("写给 Agent 的说明：何时选用该成员、怎样查询、常见错误"),
  sensitivity: z.literal("restricted").optional(),
});

const CATALOG_MEASURE_OUTPUT = CATALOG_MEMBER_OUTPUT.extend({
  kind: z.literal("measure"),
  data_as_of: MEASURE_DATA_AS_OF_SCHEMA,
  records_available: z.literal(true).optional().describe("可以查看该指标结果的明细记录"),
  query_capabilities: MEASURE_QUERY_CAPABILITIES_SCHEMA.describe(
    "该指标可用的维度及其层级；分组、筛选、排序和构成占比都必须在此范围内",
  ),
  report_calculations: z
    .array(z.literal("percent_of_total"))
    .optional()
    .describe("该指标在分析中可以使用的附加计算"),
  formula: z
    .strictObject({ numerator: z.string(), denominator: z.string() })
    .optional()
    .describe("比率指标的分子和分母（中文标题）"),
  relation: z
    .strictObject({ kind: z.literal("structure_share"), numerator_id: z.string() })
    .optional()
    .describe("指标间的关系：structure_share 表示本指标是 numerator_id 所指指标的结构占比"),
  time: METRIC_TIME_INPUT.describe(
    "指标的时间规则：value_basis 表示指标值覆盖每个时间桶里的哪段时间，" +
      "constraints 表示可以选择哪些时间；没有 constraints 表示无额外限制",
  ),
});

const CATALOG_DIMENSION_OUTPUT = CATALOG_MEMBER_OUTPUT.extend({
  kind: z.literal("dimension"),
  dimension_kind: z.enum(["categorical", "overlapping"]).optional(),
  entity_label: z
    .string()
    .optional()
    .describe("声明此维度可作组合表的稳定实体键；值为对应的显示名称维度 id"),
});

/** 各数据来源的时间范围，按展示顺序排列；title 是语义包提供的业务名称，不输出内部 source key。 */
export const TIME_CONTEXT_OUTPUT = PUBLIC_TIME_CONTEXT_SCHEMA;

export const CATALOG_OUTPUT_SCHEMA = z.strictObject({
  access_scope: ACCESS_SCOPE_DEFINITION_SCHEMA.describe(
    "行级权限所依据的维度（如组织）；实际过滤由服务端执行",
  ),
  observation_scopes: z.array(z.string()),
  data_as_of: z.string().describe("当前结果的数据截至月"),
  time_context: TIME_CONTEXT_OUTPUT.describe("各数据来源的时间可用性"),
  metric_domains: z.array(
    z.strictObject({
      id: z.string().describe("指标域 id，只用于目录导航，不作为查询参数"),
      title: z.string().describe("指标域的业务标题"),
      query_contract: z.string().optional(),
      measure_ids: z
        .array(z.string())
        .describe("本次响应中属于该指标域的指标 id；不表示它们能与其他指标域的指标组合"),
      dimension_ids: z
        .array(z.string())
        .describe("本次响应中该指标域可用的维度 id；能否组合由服务端校验"),
    }),
  ),
  measures: z
    .array(CATALOG_MEASURE_OUTPUT)
    .describe("所有可见或检索命中的指标，每个只出现一次；用 id 声明分析"),
  dimensions: z
    .array(CATALOG_DIMENSION_OUTPUT)
    .describe("所有可见或检索命中的维度，跨指标域去重；用 id 声明分析"),
  matched_terms: z.array(z.string()).describe("检索词中命中了目录或业务术语的词；浏览时为空数组"),
  ambiguous_terms: z.array(z.string()).describe("命中多个业务术语含义、需要向用户确认的词"),
  unmatched_terms: z.array(z.string()).describe("检索词中未命中目录或业务术语的词；浏览时为空数组"),
  term_knowledge_status: z
    .enum(["available", "unavailable"])
    .describe("业务术语库本次是否可用；不可用不代表术语没有收录"),
  term_resolutions: z
    .array(BUSINESS_TERM_RESOLUTION_SCHEMA)
    .describe("业务术语的定义、是否有歧义，以及当前调用者可见的相关成员"),
});

export type AgentCatalogPayload = z.infer<typeof CATALOG_OUTPUT_SCHEMA>;

export const VALUES_OUTPUT_SCHEMA = z.strictObject({
  dimension: z.string(),
  title: z.string(),
  values: z.array(z.string()),
  truncated: z.string().optional(),
});

export const RUN_OUTPUT_SCHEMA = z.strictObject({
  ...QUERY_PAYLOAD_OUTPUT,
  analysis_id: z.string().describe("本次结果对应的分析定义 id（不可变）"),
  view_id: z.string().describe("本次结果对应的呈现视图 id（不可变）"),
  presentation_notes: z
    .array(
      z.strictObject({
        result_view_id: z.string(),
        kind: z.enum(["empty_result", "unsupported_shape"]),
        note: z.string(),
      }),
    )
    .optional()
    .describe(
      "呈现说明：empty_result 表示结果为空；unsupported_shape 表示声明的图型无法如实展示该结果",
    ),
});

export const LOAD_ANALYSIS_OUTPUT_SCHEMA = RUN_OUTPUT_SCHEMA.extend({
  analysis: ANALYSIS_DEFINITION_INPUT.describe(
    "该 analysis_id 对应的规范化分析定义；修改后用 run_analysis 生成新的 analysis_id",
  ),
  view_intent: SEMANTIC_VIEW_INTENT_INPUT.describe(
    "该 view_id 对应的呈现意图，Agent 可以修改后重新提交",
  ),
});

export const SHOW_ANALYSIS_OUTPUT_SCHEMA = z.strictObject({
  view_id: z.uuid().describe("结果卡展示的本人分析视图"),
});

export const RECORDS_OUTPUT_SCHEMA = z.strictObject({
  view_id: z.uuid().describe("名单卡对应的本人分析视图"),
  metric_id: z.string().describe("本次展开的语义指标 id"),
  metric_title: z.string(),
  record_set_title: z.string(),
  record_set_description: z.string(),
  offset: z.int().nonnegative(),
  displayed_records: z.int().nonnegative(),
  has_more: z.boolean(),
  limit_reached: z.literal(true).optional(),
  data_as_of: z.string(),
  data_changed: z.boolean(),
});

export const EXPORT_OUTPUT_SCHEMA = z.strictObject({
  analysis_id: z.uuid(),
  view_id: z.uuid(),
  url: z.string(),
  expires_at: z.string(),
  max_rows: z.int(),
  data_as_of: z.string(),
  time_context: TIME_CONTEXT_OUTPUT,
});
