import { z } from "zod";
import { basisPeriod, METRIC_VALUE_BASIS_INPUT } from "./metric_value_basis.js";

export const COLUMN_FORMATS = ["number", "percent", "percentage_point"] as const;
export const COLUMN_FORMAT_SCHEMA = z.enum(COLUMN_FORMATS);
export type ColumnFormat = z.infer<typeof COLUMN_FORMAT_SCHEMA>;
export const COLUMN_DECIMALS_SCHEMA = z.number().int().min(0).max(4);

export const COLUMN_ROLE_SCHEMA = z.enum(["measure", "dimension", "time"]);

export const CELL_SCHEMA = z.union([z.string(), z.number().finite(), z.null()]);
const ROW_SCHEMA = z.array(CELL_SCHEMA);
const QUERY_NOTE_SCHEMA = z
  .object({
    member: z.string().describe("公共结果列 id；非列级说明使用 notice: 前缀"),
    title: z.string(),
    text: z.string(),
  })
  .strict();
const STRUCTURE_SHARE_SCHEMA = z
  .object({
    measure: z.string(),
    numerator: z.string(),
  })
  .strict();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** key 为 null 表示结果没有时间列。 */
const RESULT_TIME_BUCKET_SCHEMA = z
  .object({
    key: z
      .object({ year: z.number().int(), month: z.number().int().min(1).max(12).optional() })
      .strict()
      .nullable(),
    from: z.string().regex(MONTH),
    to: z.string().regex(MONTH),
  })
  .strict();
const RESULT_TIME_COORDINATE_SCHEMA = z
  .object({
    role: z.enum(["primary", "comparison"]),
    from: z.string().regex(MONTH),
    to: z.string().regex(MONTH),
  })
  .strict();
const RESULT_TIME_SCHEMA = z
  .object({
    grain: z.enum(["total", "year", "month"]),
    coordinates: z
      .array(RESULT_TIME_COORDINATE_SCHEMA)
      .min(1)
      .describe("服务端最终解析的主期间与对比期间；第一项是 primary"),
    buckets: z.array(RESULT_TIME_BUCKET_SCHEMA).min(1),
  })
  .strict()
  .superRefine((time, context) => {
    if (
      time.coordinates[0]?.role !== "primary" ||
      time.coordinates.slice(1).some((coordinate) => coordinate.role !== "comparison")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinates"],
        message: "第一项必须是主期间，其余项必须是对比期间",
      });
    }
    time.coordinates.forEach((coordinate, index) => {
      if (coordinate.from > coordinate.to) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinates", index],
          message: "已解析期间的起点不能晚于终点",
        });
      }
    });
  });
const TOP_N_SELECTION_SCOPE_SCHEMA = z
  .object({
    type: z.literal("top_n"),
    grain: z.array(z.string()).min(1).describe("实际用于选择和补齐的公共分组维度"),
    by: z.string().describe("公共排名字段 id；可以是指标或分组维度名称"),
    window: z
      .enum(["anchor", "all"])
      .describe("anchor 按主期间最后一个时间桶的数值排名；all 按分组名称在全部时间桶中去重排序"),
    direction: z.enum(["asc", "desc"]),
    requested_count: z.number().int().positive(),
    selected_count: z.number().int().nonnegative(),
    has_more_groups: z.boolean().describe("候选分组是否多于本次选中的 Top-N"),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.selected_count > scope.requested_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_count"],
        message: "实际选中分组数不能超过请求的 Top-N 数量",
      });
    }
  });
const SUMMARY_BLOCK_SCHEMA = z
  .object({
    kind: z.literal("grand_total"),
    label: z.string().min(1),
    scope: z.enum(["filtered_set", "selected_groups"]),
    rows: z.array(ROW_SCHEMA).min(1),
  })
  .strict();
/** 整窗合计由查询独立求值，不得从可能截断的明细序列重算。 */
const TOTAL_PERIOD_SCHEMA = z
  .object({
    from: z.string().regex(MONTH).describe("该值实际覆盖的起始月，由本列的求值基准和时间坐标决定"),
    to: z.string().regex(MONTH),
    value: z.number().finite().nullable(),
    degraded: z
      .literal(true)
      .optional()
      .describe("按月定义的指标在跨月期间没有整段合计，改为取终点月的值"),
  })
  .strict();
const TOTALS_BLOCK_SCHEMA = z
  .object({
    metrics: z
      .array(
        z
          .object({
            column: z.string().min(1).describe("公共结果列 id；必须是本结果的指标列"),
            periods: z
              .array(TOTAL_PERIOD_SCHEMA)
              .min(1)
              .describe("与 time.coordinates 等长同序；第一项即主期"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
/** 公共时间上下文按序交付；重复的展示标题不得覆盖数据。 */
const PUBLIC_TIME_SOURCE_SCHEMA = z
  .object({
    title: z.string(),
    actual_through: z.string(),
    available_through: z.string(),
    plan_through: z.string().optional(),
  })
  .strict();
export const PUBLIC_TIME_CONTEXT_SCHEMA = z.array(PUBLIC_TIME_SOURCE_SCHEMA);
const EXPORT_LINK_SCHEMA = z
  .object({
    url: z.string(),
    expires_at: z.string(),
  })
  .strict();

const OUTPUT_CAPABILITIES_SCHEMA = z
  .object({
    export: EXPORT_LINK_SCHEMA.optional().describe("该结果可导出完整 CSV 时的限时链接"),
  })
  .strict();

const OUTPUT_PROVENANCE_SCHEMA = z
  .object({
    sources: z.array(z.object({ title: z.string() }).strict()).min(1),
    join_keys: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
    formula: z.string().min(1),
  })
  .strict();

const PERIOD_SCHEMA = z
  .object({ from: z.string().regex(MONTH), to: z.string().regex(MONTH) })
  .strict();
export const OBSERVATION_OCCURRENCE_SCHEMA = z
  .object({
    id: z
      .string()
      .min(1)
      .max(120)
      .refine((id) => id === id.trim()),
    date: z.string().date(),
    title: z.string().optional(),
  })
  .strict();

export const OBSERVATION_PERIOD_SCHEMA = z
  .object({
    columns: z.array(z.string()).min(1).optional().describe("混合查询中使用此观测时钟的结果列"),
    requested: PERIOD_SCHEMA.optional(),
    requested_date: z.string().date().optional(),
    requested_id: z.string().optional(),
    status: z
      .enum(["observed", "no_release", "not_observed"])
      .describe(
        "observed 为所选期次或期间内有投放；no_release 为期间内无新投放，取 occurrence 指明的最近一期；not_observed 为没有匹配的可见期次",
      ),
    occurrence: OBSERVATION_OCCURRENCE_SCHEMA.optional(),
  })
  .strict();

const COMPOSITION_PERIOD_SCHEMA = z
  .object({
    metric_id: z.string(),
    requested: PERIOD_SCHEMA.optional(),
    actual: PERIOD_SCHEMA.optional(),
    observation: OBSERVATION_PERIOD_SCHEMA.optional(),
    status: z.enum(["available", "unsupported_grain"]),
  })
  .strict();

export const VIEW_BLOCK_SCHEMA = z
  .object({
    id: z.string().min(1).describe("与 AnalysisSpec 对应的稳定结果 id"),
    view_title: z.string().optional().describe("结果名称"),
    provenance: OUTPUT_PROVENANCE_SCHEMA.optional().describe(
      "组合/派生结果的来源、关联键与可审计公式",
    ),
    columns: z
      .array(z.string())
      .describe("公共结果列 id：语义成员 id、标准时间列 id 或派生规格显式列名"),
    column_periods: z.record(COMPOSITION_PERIOD_SCHEMA).optional(),
    observations: z.array(OBSERVATION_PERIOD_SCHEMA).optional(),
    observation_axis: z
      .object({
        id_column: z.string(),
        date_column: z.string(),
      })
      .strict()
      .optional(),
    column_formats: z
      .record(COLUMN_FORMAT_SCHEMA)
      .optional()
      .describe("列呈现格式；percent 与 percentage_point 的原始值均为 0–1"),
    column_decimals: z
      .record(COLUMN_DECIMALS_SCHEMA)
      .optional()
      .describe("列的小数位；只列模型明确声明过的列，未列出的列由呈现层按格式取默认位数"),
    column_roles: z
      .record(COLUMN_ROLE_SCHEMA)
      .describe("每个结果列的语义角色（指标/维度/时间），由服务端完整声明，呈现层不猜测"),
    column_time_basis: z
      .record(METRIC_VALUE_BASIS_INPUT)
      .optional()
      .describe(
        "每个指标列的求值基准：这一列的值覆盖每个时间桶里的哪一段。" +
          "与 time.buckets 一起确定每个单元格的实际期间，totals 的期间也由它决定。" +
          "直接查询的结果每个指标列都有；派生结果只有直接取自来源的列有，公式列的期间见 provenance",
      ),
    structure_shares: z
      .array(STRUCTURE_SHARE_SCHEMA)
      .min(1)
      .optional()
      .describe("模型声明的结构占比与分子列关系"),
    rows: z.array(ROW_SCHEMA).describe("数据行；结果较多时可能仅为头部样本"),
    summary: SUMMARY_BLOCK_SCHEMA.optional().describe(
      "由模型重新计算的总计行，与明细行分开；保留时间粒度，不参与明细排序、截断和明细查看",
    ),
    totals: TOTALS_BLOCK_SCHEMA.optional().describe(
      "各指标在每个时间坐标上的整段合计；不分组，也不按时间粒度拆分",
    ),
    row_count: z.number().int().nonnegative().describe("本次交付的真实行数"),
    has_more: z.boolean().optional().describe("结果中是否仍有更多分组"),
    truncated: z.string().optional().describe("交付上限截断说明"),
    sampled: z.string().optional().describe("模型只收到头部样本时的说明"),
    selection_scope: TOP_N_SELECTION_SCOPE_SCHEMA.optional().describe(
      "业务 Top-N 的结构化选择范围；has_more 仍只表示已选分组的求值结果是否完整",
    ),
    time: RESULT_TIME_SCHEMA.optional().describe(
      "直查结果的已解析业务时间轴：主/对比期间、结果粒度、带行键的业务桶，以及各指标在桶上的求值方式；" +
        "不包含 Cube 物理查询窗口",
    ),
    query_notes: z.array(QUERY_NOTE_SCHEMA).describe("供 Agent 理解和执行查询契约的口径"),
    display_notes: z.array(QUERY_NOTE_SCHEMA).optional().describe("面向用户展示的精简口径说明"),
  })
  .strict()
  .superRefine((view, ctx) => {
    if (!view.provenance && !view.time && !view.column_periods && !view.observations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["time"],
        message: "直查结果必须声明业务时间轴",
      });
    }
    if (view.provenance && view.time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["time"],
        message: "派生结果没有单一业务时间轴",
      });
    }
    if (view.observation_axis) {
      const { id_column, date_column } = view.observation_axis;
      if (
        view.time ||
        id_column === date_column ||
        view.column_roles[id_column] !== "dimension" ||
        view.column_roles[date_column] !== "dimension"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observation_axis"],
          message: "期次轴必须使用独立的期次编码与日期结果列",
        });
      }
    }
    if (view.time) {
      const { grain, buckets } = view.time;
      const keyOf = (bucket: (typeof buckets)[number]) => JSON.stringify(bucket.key);
      if (new Set(buckets.map(keyOf)).size !== buckets.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["time", "buckets"],
          message: "业务时间桶行键必须唯一",
        });
      }
      if (grain === "total" && (buckets.length !== 1 || buckets[0].key !== null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["time", "buckets"],
          message: "合计结果必须且只能有一个无行键业务桶",
        });
      }
      buckets.forEach((bucket, index) => {
        if (bucket.from > bucket.to) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["time", "buckets", index],
            message: "业务时间桶起点不能晚于终点",
          });
        }
        const expectedYear = Number(bucket.to.slice(0, 4));
        const expectedMonth = Number(bucket.to.slice(5, 7));
        const validKey =
          grain === "total"
            ? bucket.key === null
            : grain === "year"
              ? bucket.key?.year === expectedYear && bucket.key.month === undefined
              : bucket.key?.year === expectedYear && bucket.key.month === expectedMonth;
        if (!validKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["time", "buckets", index, "key"],
            message: "业务时间桶行键必须与结果粒度及终点月份一致",
          });
        }
      });
      const expectedTimeColumns =
        grain === "total" ? [] : grain === "year" ? ["year"] : ["year", "month"];
      const declaredTimeColumns = view.columns.filter(
        (column) => view.column_roles[column] === "time",
      );
      if (
        declaredTimeColumns.length !== expectedTimeColumns.length ||
        expectedTimeColumns.some((column) => !declaredTimeColumns.includes(column))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_roles"],
          message: "结果时间列及其角色必须与业务时间粒度完整一致",
        });
      }
      if (grain !== "total") {
        const yearIndex = view.columns.indexOf("year");
        const monthIndex = view.columns.indexOf("month");
        const validateRows = (rows: typeof view.rows, path: "rows" | "summary") => {
          rows.forEach((row, index) => {
            const year = Number(row[yearIndex]);
            const month = Number(row[monthIndex]);
            const matches = buckets.filter(
              (bucket) =>
                bucket.key?.year === year &&
                (grain === "year" ? bucket.key.month === undefined : bucket.key.month === month),
            );
            if (matches.length !== 1) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [path, index],
                message: "结果行必须匹配唯一业务时间桶",
              });
            }
          });
        };
        validateRows(view.rows, "rows");
        if (view.summary) validateRows(view.summary.rows, "summary");
      }
    }
    const measureColumns = view.columns.filter((column) => view.column_roles[column] === "measure");
    const declaredBasis = view.column_time_basis ?? {};
    for (const column of Object.keys(declaredBasis)) {
      if (!measureColumns.includes(column)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_time_basis", column],
          message: "求值基准只能声明在本结果的指标列上",
        });
      }
    }
    if (view.time) {
      for (const column of measureColumns) {
        if (!(column in declaredBasis)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["column_time_basis", column],
            message: "直查结果的每个指标列都必须声明求值基准",
          });
        }
      }
    }
    if (view.totals) {
      const coordinates = view.time?.coordinates;
      if (!coordinates) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totals"],
          message: "整段合计必须与业务时间轴一起返回",
        });
      }
      const seen = new Set<string>();
      view.totals.metrics.forEach((metric, index) => {
        if (view.column_roles[metric.column] !== "measure") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["totals", "metrics", index, "column"],
            message: "整段合计只能针对本结果的指标列",
          });
        }
        if (seen.has(metric.column)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["totals", "metrics", index, "column"],
            message: "同一指标列不能有多份整段合计",
          });
        }
        seen.add(metric.column);
        if (!coordinates) return;
        if (metric.periods.length !== coordinates.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["totals", "metrics", index, "periods"],
            message: "整段合计的期间必须与主期间、对比期间一一对应",
          });
          return;
        }
        const basis = declaredBasis[metric.column];
        if (!basis) return;
        metric.periods.forEach((period, periodIndex) => {
          const coordinate = coordinates[periodIndex];
          const expected = basisPeriod(basis, coordinate, period.degraded === true);
          if (period.from !== expected.from || period.to !== expected.to) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["totals", "metrics", index, "periods", periodIndex],
              message: `整段合计的期间必须与求值基准一致：${basis} 在 ${coordinate.from}~${coordinate.to} 上应为 ${expected.from}~${expected.to}`,
            });
          }
        });
      });
    }
    view.rows.forEach((row, index) => {
      if (row.length !== view.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index],
          message: "数据行宽度必须与 columns 一致",
        });
      }
    });
    view.summary?.rows.forEach((row, index) => {
      if (row.length !== view.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["summary", "rows", index],
          message: "总体行宽度必须与 columns 一致",
        });
      }
    });
    for (const key of Object.keys(view.column_formats ?? {})) {
      if (!view.columns.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_formats", key],
          message: "格式键必须来自 columns",
        });
      }
    }
    for (const key of Object.keys(view.column_decimals ?? {})) {
      if (!view.columns.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_decimals", key],
          message: "小数位键必须来自 columns",
        });
      }
    }
    for (const key of Object.keys(view.column_roles)) {
      if (!view.columns.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_roles", key],
          message: "角色键必须来自 columns",
        });
      }
    }
    for (const column of view.columns) {
      if (view.column_roles[column] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["column_roles", column],
          message: "每个结果列都必须声明语义角色",
        });
      }
    }
    view.structure_shares?.forEach((share, index) => {
      for (const field of ["measure", "numerator"] as const) {
        if (!view.columns.includes(share[field])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["structure_shares", index, field],
            message: `${field} 必须来自 columns`,
          });
        }
      }
    });
  });

/** MCP 注册直接复用此 raw shape，不得在 server.ts 重建这些字段。 */
export const QUERY_PAYLOAD_OUTPUT = {
  analysis_id: z.string().optional().describe("本次结果使用的不可变分析定义身份"),
  view_id: z.string().optional().describe("本次结果使用的不可变呈现视图身份"),
  title: z.string().optional().describe("回显调用方声明的卡片标题"),
  view: VIEW_BLOCK_SCHEMA.describe("用户可见的结果；中间计算结果不返回"),
  observation_scopes: z.array(z.string()),
  data_as_of: z.string(),
  time_context: PUBLIC_TIME_CONTEXT_SCHEMA,
  capabilities: OUTPUT_CAPABILITIES_SCHEMA.optional().describe("结果支持的操作（如导出）"),
} satisfies z.ZodRawShape;

export const QUERY_PAYLOAD_SCHEMA = z.object(QUERY_PAYLOAD_OUTPUT).strict();

export type ObservationPeriod = z.infer<typeof OBSERVATION_PERIOD_SCHEMA>;
export function observationStatus(period: ObservationPeriod): string {
  if (period.status === "not_observed") return "未观测";
  return period.status === "no_release" ? "未投放" : "已观测";
}

export function observationSummary(period: ObservationPeriod): string {
  const occurrence = period.occurrence;
  const requested =
    period.requested_date ??
    (occurrence ? undefined : period.requested_id) ??
    (period.requested &&
      (period.requested.from === period.requested.to
        ? period.requested.to
        : `${period.requested.from} 至 ${period.requested.to}`));
  const name = occurrence?.title ?? occurrence?.id;
  const details = occurrence
    ? [...new Set([occurrence.id, occurrence.date])].filter((part) => part !== name)
    : [];
  const label =
    occurrence && (details.length ? `期次 ${name}（${details.join("，")}）` : `期次 ${name}`);
  return [requested, observationStatus(period), label].filter(Boolean).join(" · ");
}

export type CompositionPeriod = z.infer<typeof COMPOSITION_PERIOD_SCHEMA>;
export type QueryNote = z.infer<typeof QUERY_NOTE_SCHEMA>;
export type StructureShare = z.infer<typeof STRUCTURE_SHARE_SCHEMA>;
export type PublicTimeContext = z.infer<typeof PUBLIC_TIME_CONTEXT_SCHEMA>;
export type ResultTime = z.infer<typeof RESULT_TIME_SCHEMA>;
export type TotalPeriodValue = z.infer<typeof TOTAL_PERIOD_SCHEMA>;
export type OutputProvenance = z.infer<typeof OUTPUT_PROVENANCE_SCHEMA>;
export type ViewBlock = z.infer<typeof VIEW_BLOCK_SCHEMA>;
export type QueryPayload = z.infer<typeof QUERY_PAYLOAD_SCHEMA>;
export type ExportLink = z.infer<typeof EXPORT_LINK_SCHEMA>;
export type OutputCapabilities = z.infer<typeof OUTPUT_CAPABILITIES_SCHEMA>;

export function isColumnFormat(value: unknown): value is ColumnFormat {
  return COLUMN_FORMAT_SCHEMA.safeParse(value).success;
}

export type ExportResourceLink = {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType: string;
};

export const EXPORT_RESOURCE_META_KEY = "ai.pa/export_resource";
export const FULL_ROWS_META_KEY = "ai.pa/full_rows";
/** 唯一结果被模型样本收窄时，在宿主元数据中携带完整行。 */
export type FullRowsBlock = { rows: (string | number | null)[][] };

export const FULL_ROWS_BLOCK_SCHEMA = z
  .object({
    rows: z.array(ROW_SCHEMA),
  })
  .strict();

export const EXPORT_RESOURCE_LINK_SCHEMA = z
  .object({
    type: z.literal("resource_link"),
    uri: z.string().startsWith("pa://export/"),
    name: z.string().min(1),
    mimeType: z.string().startsWith("text/csv"),
  })
  .strict();

export function freshnessLabel(payload: QueryPayload): string {
  const sources = payload.time_context;
  const actual = [...new Set(sources.map((source) => source.actual_through))].sort();
  const plans = [
    ...new Set(sources.flatMap((source) => (source.plan_through ? [source.plan_through] : []))),
  ].sort();
  if (!plans.length) return `数据截至 ${actual.at(-1) ?? payload.data_as_of}`;
  return `实际截至 ${actual.join(" / ") || payload.data_as_of} · 计划截至 ${plans.join(" / ")}`;
}

export function mergeFullRows(
  payload: QueryPayload,
  full: FullRowsBlock | null | undefined,
): QueryPayload {
  if (!full) return payload;
  return {
    ...payload,
    view: { ...payload.view, rows: full.rows },
  };
}
