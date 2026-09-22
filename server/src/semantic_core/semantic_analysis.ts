/**
 * 分析定义的持久化事实源：只表达查询、计算与结果图关系，
 * 不携带呈现方式、视觉偏好或 Cube view 限定成员。物理 AnalysisSpec
 * 由应用层在当前身份的 catalog 上编译，不是分析身份。
 */
import { z } from "zod";
import { validateDerivedColumns } from "./analysis_graph.js";
import { GRAND_TOTAL_DESCRIPTION } from "./analysis_spec.js";
import { COLUMN_FORMATS, type ColumnFormat } from "./query_payload.js";
import { TIME_INTENT_INPUT } from "./time_contract.js";

const SEMANTIC_MEMBER_NAME = /^[a-z][a-z0-9_]*$/;
const SEMANTIC_MEASURE_ID = z
  .string()
  .regex(/^measure:[a-z][a-z0-9_]*$/)
  .max(120)
  .describe("catalog 搜索响应 measures[].id 中的语义指标 id；不接受中文标题或物理字段名");
const SEMANTIC_DIMENSION_ID = z
  .string()
  .regex(/^dimension:[a-z][a-z0-9_]*$/)
  .max(120)
  .describe("catalog 搜索响应 dimensions[].id 中的语义维度 id；不接受中文标题或物理字段名");
const SEMANTIC_QUERY_MEMBER_ID = z
  .string()
  .max(120)
  .refine((value) => {
    const [kind, name, extra] = value.split(":");
    return (
      extra === undefined &&
      (kind === "measure" || kind === "dimension") &&
      SEMANTIC_MEMBER_NAME.test(name ?? "")
    );
  })
  .describe("catalog 搜索响应中的语义成员 id；指标或维度类型必须符合字段用途");
const SEMANTIC_FILTER_VALUES = z
  .array(z.string().trim().min(1).describe("values_of 返回的真实分类值；不接受空字符串"))
  .min(1)
  .describe("要包含或排除的真实分类值；至少一项，多项按集合处理")
  .transform((values) =>
    [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
/**
 * 来源角色是固定词汇，不是调用方发明的名字：query 指顶层查询，joined 指 derived.joined.query。
 * 派生列据此引用来源，引用错误在 schema 层就能判定。
 */
const SEMANTIC_SOURCE_ROLE = z
  .enum(["query", "joined"])
  .describe("派生列的来源：query = 顶层 query，joined = derived.joined.query");

export type SemanticSourceRole = z.infer<typeof SEMANTIC_SOURCE_ROLE>;

const CALCULATION_ID = z
  .string()
  .regex(/^calculation:[a-z][a-z0-9_]*$/)
  .max(120)
  .describe("报告内稳定且唯一的临时计算 id；不进入全局指标目录");

export const SEMANTIC_PERCENT_OF_TOTAL_CALCULATION_INPUT = z
  .object({
    id: CALCULATION_ID,
    title: z.string().trim().min(1).max(30),
    kind: z.literal("percent_of_total"),
    measure: SEMANTIC_MEASURE_ID.describe("作为分子与分母聚合基础的正式指标 id"),
    category_dimension: SEMANTIC_DIMENSION_ID.describe("从分母分组中移除的构成分类维度 id"),
  })
  .strict();

export type SemanticPercentOfTotalCalculation = z.infer<
  typeof SEMANTIC_PERCENT_OF_TOTAL_CALCULATION_INPUT
>;

const SEMANTIC_GROUP_SORT = z
  .object({
    dimension: SEMANTIC_DIMENSION_ID.describe("要配置排序与最大项数的已选分组维度 id"),
    by: z
      .union([z.literal("name"), SEMANTIC_MEASURE_ID])
      .describe("排序依据；name 表示按分组名称，指标 id 表示按该指标数值"),
    direction: z.enum(["asc", "desc"]).describe("从低到高 / A 到 Z，或从高到低 / Z 到 A"),
    max_items: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .describe("最多保留的完整分组数量；省略即展示全部分组，不做 Top-N 截取"),
  })
  .strict();

export const SEMANTIC_SUMMARY_INPUT = z
  .object({
    mode: z.literal("grand_total").describe(GRAND_TOTAL_DESCRIPTION),
  })
  .strict();

export type SemanticSummary = z.infer<typeof SEMANTIC_SUMMARY_INPUT>;

export const SEMANTIC_QUERY_VIEW_INPUT = z
  .object({
    view_title: z.string().min(1).max(30).optional(),
    measures: z.array(SEMANTIC_MEASURE_ID).optional(),
    dimensions: z.array(SEMANTIC_DIMENSION_ID).optional(),
    filters: z
      .array(
        z
          .object({
            member: SEMANTIC_DIMENSION_ID,
            relation: z
              .enum(["one_of", "none_of"])
              .describe("one_of 保留值属于给定集合的记录；none_of 排除值属于给定集合的记录"),
            values: SEMANTIC_FILTER_VALUES,
          })
          .strict(),
      )
      .describe("分类维度筛选；同一 member 最多出现一次")
      .optional(),
    time: TIME_INTENT_INPUT,
    group_sort: SEMANTIC_GROUP_SORT.optional().describe(
      "所选分组维度的排序与可选最大项数；省略时展示全部分组，不自动套用 Top 10",
    ),
    calculations: z
      .array(SEMANTIC_PERCENT_OF_TOTAL_CALCULATION_INPUT)
      .max(1)
      .optional()
      .describe("报告级受控临时计算；聚合仍由模型查询完成，不注册为正式指标"),
    summary: SEMANTIC_SUMMARY_INPUT.optional().describe("结果表格的模型重算总体"),
  })
  .strict()
  .superRefine((view, context) => {
    if (!view.measures?.length && !view.dimensions?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measures 与 dimensions 至少提供一个",
      });
    }
    if (view.summary && (!view.measures?.length || !view.dimensions?.length)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "总体行只适用于同时包含指标与业务分组维度的查询",
      });
    }
    const calculations = view.calculations ?? [];
    const calculationIds = calculations.map((calculation) => calculation.id);
    if (new Set(calculationIds).size !== calculationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calculations"],
        message: "临时计算 id 不能重复",
      });
    }
    for (const [index, calculation] of calculations.entries()) {
      if (!view.measures?.includes(calculation.measure)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calculations", index, "measure"],
          message: "构成占比的基础指标必须同时出现在 measures 中",
        });
      }
      if (!view.dimensions?.includes(calculation.category_dimension)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calculations", index, "category_dimension"],
          message: "构成占比的分类维度必须同时出现在 dimensions 中",
        });
      }
    }
    const filterMembers = (view.filters ?? []).map((filter) => filter.member);
    const duplicateFilterMember = filterMembers.find(
      (member, index) => filterMembers.indexOf(member) !== index,
    );
    if (duplicateFilterMember) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters"],
        message: `同一维度只能声明一条筛选；请把 ${duplicateFilterMember} 的多个值合并到同一 values`,
      });
    }
    if (!view.group_sort) return;
    const dimensions = new Set(view.dimensions ?? []);
    if (!dimensions.has(view.group_sort.dimension)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["group_sort", "dimension"],
        message: "分组排序配置的 dimension 必须同时出现在 dimensions 中",
      });
    }
    const byMeasure = view.measures?.includes(view.group_sort.by) ?? false;
    const byName = view.group_sort.by === "name";
    if (!byMeasure && !byName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["group_sort", "by"],
        message: 'group_sort.by 必须是查询中的指标，或使用 "name" 表示按名称排序',
      });
    }
    if (view.group_sort.max_items && !view.measures?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["group_sort", "max_items"],
        message: "限制分组最大项数时至少需要一个查询指标",
      });
    }
  });

export type SemanticQueryView = z.infer<typeof SEMANTIC_QUERY_VIEW_INPUT>;

export type SemanticColumnOperand = { member: string; source: SemanticSourceRole };
export type SemanticCarriedColumn = SemanticColumnOperand & { as: string };
export type SemanticLiteralOperand = { lit: number };
export type SemanticExprNode = {
  op: "+" | "-" | "*" | "/";
  left: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand;
  right: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand;
};
export type SemanticDerivedColumn =
  | SemanticCarriedColumn
  | { expr: SemanticExprNode; as: string; format?: ColumnFormat };
export type SemanticDerivedView = {
  view_title: string;
  joined?: {
    query: SemanticQueryView;
    on: string[];
    how: "left" | "inner" | "full";
  };
  columns: SemanticDerivedColumn[];
  order?: { by: string; direction: "asc" | "desc" }[];
  limit?: number;
  summary?: SemanticSummary;
};

const SEMANTIC_COLUMN_OPERAND = z
  .object({ member: SEMANTIC_QUERY_MEMBER_ID, source: SEMANTIC_SOURCE_ROLE })
  .strict();
/** 派生输出列名是标识符：与呈现通道同一份词汇，通道引用才能在 schema 层判定。 */
const DERIVED_OUTPUT_NAME = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "派生输出列名使用 ASCII snake_case")
  .max(120);
const SEMANTIC_CARRIED_COLUMN = SEMANTIC_COLUMN_OPERAND.extend({
  as: DERIVED_OUTPUT_NAME,
}).strict();
const SEMANTIC_LITERAL_OPERAND = z.object({ lit: z.number() }).strict();
const SEMANTIC_EXPR_NODE: z.ZodType<SemanticExprNode> = z.lazy(() =>
  z
    .object({
      op: z.enum(["+", "-", "*", "/"]),
      left: z.union([SEMANTIC_EXPR_NODE, SEMANTIC_COLUMN_OPERAND, SEMANTIC_LITERAL_OPERAND]),
      right: z.union([SEMANTIC_EXPR_NODE, SEMANTIC_COLUMN_OPERAND, SEMANTIC_LITERAL_OPERAND]),
    })
    .strict(),
);

export const SEMANTIC_DERIVED_VIEW_INPUT: z.ZodType<SemanticDerivedView> = z
  .object({
    view_title: z.string().min(1).max(30),
    joined: z
      .object({
        query: SEMANTIC_QUERY_VIEW_INPUT.describe("参与逐行算术的第二个查询；它只为本次算术存在"),
        on: z.array(SEMANTIC_DIMENSION_ID).min(1).describe("两个来源查询共同使用的语义维度 id"),
        how: z.enum(["left", "inner", "full"]).describe("以顶层 query 为左表"),
      })
      .strict()
      .optional()
      .describe("需要跨两个查询逐行算术时声明；第二个查询与它的关联合同只能一起出现"),
    columns: z
      .array(
        z.union([
          SEMANTIC_CARRIED_COLUMN,
          z
            .object({
              expr: SEMANTIC_EXPR_NODE,
              as: DERIVED_OUTPUT_NAME,
              format: z.enum(COLUMN_FORMATS).optional(),
            })
            .strict(),
        ]),
      )
      .min(1),
    order: z
      .array(z.object({ by: DERIVED_OUTPUT_NAME, direction: z.enum(["asc", "desc"]) }).strict())
      .optional(),
    limit: z.number().int().positive().max(1000).optional(),
    summary: SEMANTIC_SUMMARY_INPUT.optional().describe("结果表格的模型重算总体"),
  })
  .strict();

export type SemanticAnalysisView = SemanticQueryView | SemanticDerivedView;

/**
 * 呈现通道按词汇分型：指标通道收 measure/calculation id，分类通道收 dimension id，
 * 两者都允许派生结果的输出列名。跨类型引用在 schema 层就被拒，客户端本地校验即可发现。
 */
const MEASURE_CHANNEL_FIELD = z
  .string()
  .max(120)
  .regex(
    /^(?:(?:measure|calculation):)?[a-z][a-z0-9_]*$/,
    "指标通道只接受语义指标 id、报告内计算 id 或派生输出列名；维度不能画成系列",
  );
const DIMENSION_CHANNEL_FIELD = z
  .string()
  .max(120)
  .regex(
    /^(?:dimension:)?[a-z][a-z0-9_]*$/,
    "分类通道只接受语义维度 id 或派生输出列名；指标不能当分类轴",
  );
const PRESENTATION_SERIES = z
  .array(MEASURE_CHANNEL_FIELD)
  .min(1)
  .optional()
  .describe("有序主指标系列；每项是语义指标 id，派生结果则是输出列名；省略时使用已查询指标");
const PRESENTATION_SECONDARY_SERIES = z
  .array(MEASURE_CHANNEL_FIELD)
  .min(1)
  .optional()
  .describe(
    "画在右轴的指标（第二把尺子）；省略时按量纲自动分侧：量在左、率在右。" +
      "每侧只容一种量纲；不能与 series 重复；与 group_by 互斥",
  );
const PRESENTATION_CATEGORY = DIMENSION_CHANNEL_FIELD.optional().describe(
  "分类轴维度；直接查询使用 dimensions 中的语义维度 id，只有一个分类维度时可省略",
);
const PRESENTATION_GROUP_BY = DIMENSION_CHANNEL_FIELD.optional().describe(
  "拆分系列的第二个分类维度；与多个主指标互斥",
);
export const SEMANTIC_VIEW_INTENT_INPUT = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("table").describe("精确读数、矩阵或类别较多时使用的表格"),
        columns: z
          .array(DIMENSION_CHANNEL_FIELD)
          .min(1)
          .optional()
          .describe(
            "table 专用有序列轴：time=逻辑时间桶，metrics=指标轴，其他值为分组维度 id 或派生输出列名；" +
              "单个指标 id 不能写进列轴，整条指标轴统一用 metrics 表示；" +
              "未进入列轴的分组维度留在行轴；指标与时间同在列轴时默认使用 [metrics, time]，" +
              "即指标在外层、年份或月份在内层；只有明确需要相反层级时才交换顺序",
          ),
      })
      .strict(),
    z
      .object({
        type: z.literal("kpi").describe("无分组维度、只有一个结果行的指标卡"),
      })
      .strict(),
    z
      .object({
        type: z.literal("line").describe("按月或按年的连续时间趋势；横轴恒为时间"),
        series: PRESENTATION_SERIES,
        secondary_series: PRESENTATION_SECONDARY_SERIES,
        group_by: PRESENTATION_GROUP_BY,
      })
      .strict(),
    z
      .object({
        type: z.literal("bar").describe("有限类别的比较或排行"),
        category: PRESENTATION_CATEGORY,
        series: PRESENTATION_SERIES,
        secondary_series: PRESENTATION_SECONDARY_SERIES,
        annotations: z
          .array(MEASURE_CHANNEL_FIELD)
          .optional()
          .describe("结构占比等辅助标注指标；不能与主系列重复，仅 bar 支持"),
        group_by: PRESENTATION_GROUP_BY,
        stack: z.boolean().optional().describe("需同时声明 group_by；true=堆叠，false=并列分组"),
      })
      .strict(),
    z
      .object({
        type: z.literal("pie").describe("一个可加计数指标在少量互斥类别中的构成"),
        category: PRESENTATION_CATEGORY,
        series: z
          .array(MEASURE_CHANNEL_FIELD)
          .length(1)
          .optional()
          .describe("唯一的可加计数指标；省略时使用查询中的唯一指标"),
      })
      .strict(),
  ])
  .superRefine((chart, context) => {
    if (chart.type === "table" && chart.columns) {
      if (new Set(chart.columns).size !== chart.columns.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columns"],
          message: "presentation.columns 不能包含重复列轴",
        });
      }
    }
    if ((chart.type === "line" || chart.type === "bar") && chart.secondary_series) {
      if (chart.group_by) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondary_series"],
          message: "presentation.secondary_series 与 group_by 互斥：拆分系列只画一个指标",
        });
      }
      if (chart.series?.some((member) => chart.secondary_series?.includes(member))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondary_series"],
          message: "presentation.secondary_series 不能与 series 重复",
        });
      }
    }
    if (chart.type === "bar" && chart.stack !== undefined && !chart.group_by) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stack"],
        message: "presentation.stack 仅用于 bar 且需同时声明 group_by",
      });
    }
  });

export type SemanticViewIntent = z.infer<typeof SEMANTIC_VIEW_INTENT_INPUT>;
export type PlottedIntentType = Extract<SemanticViewIntent["type"], "line" | "bar" | "pie">;

/**
 * 一次分析只交付一个结果，所以结果节点由形状固定：声明 derived 时它就是结果，
 * 否则唯一的 query 就是结果。第二个查询只存在于 derived.joined 里，因此
 * 「多个互不相干的结果」和「有第二个查询却没有算术」都写不出来。
 */
export const ANALYSIS_DEFINITION_INPUT = z
  .object({
    title: z.string().min(1).max(100).optional(),
    query: SEMANTIC_QUERY_VIEW_INPUT.describe(
      "数据问题。分组、时间与筛选一致的多个指标写进同一个查询的 measures，得到一张宽表；" +
        "行结构不相容或属于不同业务问题时分成多次 run_analysis",
    ),
    derived: SEMANTIC_DERIVED_VIEW_INPUT.optional().describe(
      "对来源查询逐行算术后交付的结果；声明它时来源查询都成为中间节点。" +
        "已有正式指标不要用它复刻除法",
    ),
  })
  // 多写一个查询、把 view 写进来是最常见的两种错法，strict 的默认文案只会说「多余的键」，
  // 这里替它指路。
  .strict(
    "分析定义只有 title / query / derived 三个字段：分组、时间与筛选一致的多个指标合并进 " +
      "query.measures；需要跨查询逐行算术时把第二个查询放进 derived.joined；" +
      "属于不同业务问题则分成多次 run_analysis。呈现意图写在与 analysis 平级的 view 参数里，" +
      "不放进分析定义",
  );

export type AnalysisDefinition = z.infer<typeof ANALYSIS_DEFINITION_INPUT>;

export class AnalysisDefinitionError extends Error {
  override name = "AnalysisDefinitionError";
}

export class ViewIntentError extends Error {
  override name = "ViewIntentError";
}

function semanticOperands(column: SemanticDerivedColumn): SemanticColumnOperand[] {
  if ("member" in column) return [column];
  const operands: SemanticColumnOperand[] = [];
  const visit = (node: SemanticExprNode | SemanticColumnOperand | SemanticLiteralOperand): void => {
    if ("member" in node) operands.push(node);
    else if ("op" in node) {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(column.expr);
  return operands;
}

/** 派生结果在执行层的视图身份；来源视图身份即来源角色本身。 */
export const SEMANTIC_DERIVED_VIEW_ID = "result";

export function semanticResultView(definition: AnalysisDefinition): SemanticAnalysisView {
  return definition.derived ?? definition.query;
}

export function semanticResultViewId(definition: AnalysisDefinition): string {
  return definition.derived ? SEMANTIC_DERIVED_VIEW_ID : "query";
}

export function semanticSourceViews(
  definition: AnalysisDefinition,
): { role: SemanticSourceRole; query: SemanticQueryView }[] {
  const joined = definition.derived?.joined;
  return [
    { role: "query", query: definition.query },
    ...(joined ? [{ role: "joined" as const, query: joined.query }] : []),
  ];
}

export function parseAnalysisDefinition(value: unknown): AnalysisDefinition {
  const parsed = ANALYSIS_DEFINITION_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new AnalysisDefinitionError(
      `分析定义无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  try {
    const { derived } = parsed.data;
    const sources = semanticSourceViews(parsed.data);
    if (derived) {
      const usesJoined = derived.columns.some((column) =>
        semanticOperands(column).some((operand) => operand.source === "joined"),
      );
      if (usesJoined && !derived.joined) {
        throw new Error(
          `派生结果「${derived.view_title}」的列引用了 joined，但没有声明 derived.joined；` +
            "补上第二个查询与它的关联合同，或把这些列改成引用 query",
        );
      }
      validateDerivedColumns(
        derived,
        sources.map(({ role }) => role),
        {
          operands: (column) =>
            semanticOperands(column).map((operand) => ({ source: operand.source })),
          outputName: (column) => column.as,
        },
      );
      for (const { role, query } of sources) {
        if (!query.view_title?.trim()) {
          throw new Error(
            `声明 derived 时每个来源查询都必须提供 view_title；来源 ${role} 缺少标题`,
          );
        }
        if (query.calculations?.length) {
          throw new Error(
            `报告级构成占比只能声明在直接交付的查询上；来源 ${role} 是 derived 的中间节点`,
          );
        }
        if (query.group_sort) {
          throw new Error(`分组排序只能声明在直接交付的查询上；中间查询 ${role} 不能独立选择分组`);
        }
      }
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AnalysisDefinitionError) throw error;
    throw new AnalysisDefinitionError(error instanceof Error ? error.message : "分析定义无效", {
      cause: error,
    });
  }
}

export function parseSemanticViewIntent(value: unknown): SemanticViewIntent {
  const parsed = SEMANTIC_VIEW_INTENT_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new ViewIntentError(
      `视图意图无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  return parsed.data;
}
