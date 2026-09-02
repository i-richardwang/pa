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
import { TIME_CAPABILITIES_INPUT } from "../semantic_core/time_contract.js";
import { BUSINESS_TERM_RESOLUTION_SCHEMA } from "../contracts/business_term_contract.js";
import { EXPORT_TICKET_TTL_MINUTES } from "../contracts/export_contract.js";
import { ACCESS_SCOPE_DEFINITION_SCHEMA } from "../contracts/access_scope.js";

export const SERVER_INSTRUCTIONS =
  "PA 是权限裁剪的封闭查询面。成员只引用 catalog 的语义 id，并遵守其 time_constraints 与 incompatible_dimensions；先用 catalog(terms) 读取 term_resolutions，值不确定时用 values_of。" +
  "术语只供理解，不改写查询；歧义先确认。查询只声明指标、维度与 time，不用标题、物理字段或 SQL，也不补充未要求的范围或比较。" +
  "构成记录仅用于单结果格、单时间桶且 records_available 的分析，个体行只在受控 App 展示。";

export const TOOL_DESCRIPTIONS = {
  catalog:
    "发现当前调用者可用的 PA 指标、维度与业务术语解释。不传 terms 返回全部成员，传 terms 按业务概念筛选；成员 id 可直接用于分析。",
  values_of: "搜索一个分类维度在当前调用者权限范围内的真实值，可按子串收窄。",
  run_analysis:
    "用 catalog 的语义 id 与呈现意图执行分析；不接受视觉设置、物理字段、SQL 或个体字段。自动规划兼容指标域；成功返回分析结果，失败返回含 code/details 的错误 JSON。",
  rerun_analysis:
    "从已有 analysis_id 派生新的不可变 View 并按当前数据重跑；AnalysisDefinition 保持不变。",
  show_analysis: "为本人已有 view_id 打开交互结果卡；只负责展示，不重新定义或执行分析。",
  load_analysis_result: "按 view_id 实时加载本人分析定义、呈现意图与当前结果，供 Agent 继续编辑。",
  load_analysis_card: "按 view_id 实时加载当前聚合结果，仅供 PA 结果卡渲染。",
  show_records:
    "为单结果格、单时间桶的本人分析打开受控构成记录；分类条件应在分析 filters 中表达，不能用 dimensions 展开名单。",
  load_records_page: "按 view_id 加载受控构成记录分页，仅供 PA 记录卡渲染。",
  export_result: `从本人不可变 View 对应的分析生成 ${EXPORT_TICKET_TTL_MINUTES} 分钟有效的 CSV 交付。`,
  save_report: "把本人不可变 View 保存为报告；不重新执行查询。",
  update_report: "修改本人报告的名称、当前 view_id 指针或归档状态。",
  find_report: "按名称查找本人未归档报告，返回当前 analysis_id、view_id 与控制台深链。",
  feedback:
    "在当前目录无法满足用户需求时提报数据能力缺口；不改变本次应答，也不会直接改变指标或口径。",
} as const;

// MCP SDK 通过 _meta 序列化工具安全声明；OAuth 验签由 HTTP transport 边界执行。
export const OAUTH_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: ["openid", "profile", "email"] },
] as const;

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
} as const;
export const OPENAI_WIDGET_CSP = {
  connect_domains: [],
  resource_domains: [],
} as const;

const CATALOG_MEMBER_OUTPUT = z
  .object({
    id: z.string().describe("跨指标域稳定的语义成员标识；分析意图与翻值只引用此值"),
    kind: z.enum(["measure", "dimension"]),
    title: z.string(),
    description: z.string(),
    format: z
      .enum(COLUMN_FORMATS)
      .optional()
      .describe("呈现格式；percent 与 percentage_point 的原始值均为 0–1"),
    ai_context: z.string().optional().describe("仅供 Agent 的成员选择、查询方式与避坑规则"),
    sensitivity: z.string().optional(),
    dimension_kind: z.enum(["categorical", "overlapping"]).optional(),
    records_available: z.literal(true).optional().describe("指标结果可投影受控构成记录"),
    incompatible_dimensions: z
      .array(z.string())
      .optional()
      .describe("不能与本成员同时分组的维度语义 id"),
    report_calculations: z
      .array(z.literal("percent_of_total"))
      .optional()
      .describe("该正式指标允许在报告规格中使用的受控临时计算"),
    formula: z
      .object({ numerator: z.string(), denominator: z.string() })
      .strict()
      .optional()
      .describe("率指标的分子与分母口径（中文标题）"),
    relation: z
      .object({ kind: z.literal("structure_share"), numerator_id: z.string() })
      .strict()
      .optional()
      .describe("指标的机器可读呈现关系；numerator_id 为分子指标的语义 id"),
    time_constraints: TIME_CAPABILITIES_INPUT.optional().describe(
      "时间能力卡：指标对序列粒度和日历期间的约束；省略表示没有额外限制",
    ),
  })
  .strict();

/** 数据时间为有序展示数组：每项 title 是语义包提供的业务标签，内部 source key 不上线。 */
export const TIME_CONTEXT_OUTPUT = PUBLIC_TIME_CONTEXT_SCHEMA;

export const CATALOG_OUTPUT = {
  access_scope: ACCESS_SCOPE_DEFINITION_SCHEMA.describe(
    "当前语义包定义的行级授权维度标题；具体过滤由服务端策略执行",
  ),
  observation_scopes: z.array(z.string()),
  data_as_of: z.string().describe("当前结果的数据截至月"),
  time_context: TIME_CONTEXT_OUTPUT.describe("各数据来源的时间可用性"),
  metric_domains: z.array(
    z
      .object({
        id: z.string().describe("稳定指标域 id；仅用于目录导航，不作为查询参数"),
        title: z.string().describe("指标域的业务标题"),
        query_contract: z.string().optional(),
        measure_ids: z
          .array(z.string())
          .describe("本次响应中属于该指标域的指标语义 id；不代表跨域组合兼容性"),
        dimension_ids: z
          .array(z.string())
          .describe("本次响应中该指标域可见的维度语义 id；组合兼容性由服务端校验"),
      })
      .strict(),
  ),
  measures: z
    .array(CATALOG_MEMBER_OUTPUT)
    .describe("全部可见或检索命中的指标，按唯一语义身份返回；用 id 声明分析"),
  dimensions: z
    .array(CATALOG_MEMBER_OUTPUT)
    .describe("全部可见或检索命中的维度，跨指标域去重；用 id 声明分析"),
  matched_terms: z.array(z.string()).describe("检索词中已命中目录或词典的词；浏览时为空数组"),
  ambiguous_terms: z.array(z.string()).describe("命中多个业务术语含义、需要向用户确认的词"),
  unmatched_terms: z.array(z.string()).describe("检索词中未命中目录或业务术语的词；浏览时为空数组"),
  term_knowledge_status: z
    .enum(["available", "unavailable"])
    .describe("业务术语库是否可用于本次解析；不可用不等于术语未收录"),
  term_resolutions: z
    .array(BUSINESS_TERM_RESOLUTION_SCHEMA)
    .describe("业务术语的自含定义、歧义状态与当前调用者可见的相关语义成员"),
};
export const CATALOG_OUTPUT_SCHEMA = z.object(CATALOG_OUTPUT).strict();
export type AgentCatalogPayload = z.infer<typeof CATALOG_OUTPUT_SCHEMA>;

export const VALUES_OUTPUT = {
  dimension: z.string(),
  title: z.string(),
  values: z.array(z.string()),
  truncated: z.string().optional(),
};

export const RUN_OUTPUT = {
  ...QUERY_PAYLOAD_OUTPUT,
  analysis_id: z.string().describe("本次结果使用的不可变分析定义身份"),
  view_id: z.string().describe("本次结果使用的不可变呈现视图身份"),
  presentation_notes: z
    .array(
      z
        .object({
          result_view_id: z.string(),
          kind: z.enum(["empty_result", "unsupported_shape"]),
          note: z.string(),
        })
        .strict(),
    )
    .optional()
    .describe("呈现说明：empty_result=结果为空；unsupported_shape=声明形态无法忠实编译"),
};
export const RUN_OUTPUT_SCHEMA = z.object(RUN_OUTPUT).strict();

export const LOAD_ANALYSIS_OUTPUT = {
  ...RUN_OUTPUT,
  analysis: ANALYSIS_DEFINITION_INPUT.describe(
    "该 analysis_id 固定的 canonical 分析定义；修改后用 run_analysis 产生新的分析身份",
  ),
  view_intent: SEMANTIC_VIEW_INTENT_INPUT.describe("该 view_id 固定且 Agent 可编辑的呈现意图"),
};
export const LOAD_ANALYSIS_OUTPUT_SCHEMA = z.object(LOAD_ANALYSIS_OUTPUT).strict();

export const SHOW_ANALYSIS_OUTPUT = {
  view_id: z.string().uuid().describe("结果卡所展示的本人分析视图"),
};

export const RECORDS_OUTPUT = {
  view_id: z.string().uuid().describe("名单卡对应的本人分析视图"),
  metric_id: z.string().describe("本次展开的语义指标 id"),
  metric_title: z.string(),
  record_set_title: z.string(),
  record_set_description: z.string(),
  offset: z.number().int().nonnegative(),
  displayed_records: z.number().int().nonnegative(),
  has_more: z.boolean(),
  limit_reached: z.literal(true).optional(),
  data_as_of: z.string(),
  data_changed: z.boolean(),
};
export const RECORDS_OUTPUT_SCHEMA = z.object(RECORDS_OUTPUT).strict();

export const EXPORT_OUTPUT = {
  analysis_id: z.string().uuid(),
  view_id: z.string().uuid(),
  url: z.string(),
  expires_at: z.string(),
  max_rows: z.number().int(),
  data_as_of: z.string(),
  time_context: TIME_CONTEXT_OUTPUT,
};
