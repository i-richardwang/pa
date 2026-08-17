/**
 * 分析的持久化事实源：只表达业务字段意图与呈现通道，
 * 不携带 Cube view 限定成员。物理 AnalysisSpec / PresentationSpec
 * 由应用层在当前身份的 catalog 上编译，不是分析身份。
 */
import { z } from "zod";
import { analysisGraphSink, validateDerivedGraphView } from "./analysis_graph.js";
import { GRAND_TOTAL_DESCRIPTION, MAX_PLAN_NODES } from "./analysis_spec.js";
import { COLUMN_FORMATS, type ColumnFormat } from "./query_payload.js";
import { TIME_INTENT_INPUT } from "./time_contract.js";

const SEMANTIC_MEMBER_ID = z.string().min(1).max(120);
const SEMANTIC_MEASURE_ID = SEMANTIC_MEMBER_ID.describe(
  "catalog 搜索响应 measures[].id 中的语义指标 id；不接受中文标题或物理字段名",
);
const SEMANTIC_DIMENSION_ID = SEMANTIC_MEMBER_ID.describe(
  "catalog 搜索响应 dimensions[].id 中的语义维度 id；不接受中文标题或物理字段名",
);
const SEMANTIC_QUERY_MEMBER_ID = SEMANTIC_MEMBER_ID.describe(
  "catalog 搜索响应中的语义成员 id；指标或维度类型必须符合字段用途",
);
const SEMANTIC_FILTER_VALUES = z
  .array(z.string().trim().min(1).describe("values_of 返回的真实分类值；不接受空字符串"))
  .min(1)
  .describe("要包含或排除的真实分类值；至少一项，多项按集合处理")
  .transform((values) =>
    [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
const VIEW_ID = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

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
    id: VIEW_ID,
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
    if (calculations.length && view.summary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "构成占比已经包含分区合计，不能同时声明总体行",
      });
    }
    if (calculations.length && view.group_sort?.max_items) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["group_sort", "max_items"],
        message: "构成占比暂不支持 Top-N；请展示完整分类，避免可见占比合计失真",
      });
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

export type SemanticColumnOperand = { member: string; source: string };
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
  id: string;
  view_title: string;
  from: string[];
  join?: { on: string[]; how: "left" | "inner" | "full" };
  columns: SemanticDerivedColumn[];
  order?: { by: string; direction: "asc" | "desc" }[];
  limit?: number;
  summary?: SemanticSummary;
};

const SEMANTIC_COLUMN_OPERAND = z
  .object({ member: SEMANTIC_QUERY_MEMBER_ID, source: VIEW_ID })
  .strict();
const SEMANTIC_CARRIED_COLUMN = SEMANTIC_COLUMN_OPERAND.extend({
  as: z.string().min(1),
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
    id: VIEW_ID,
    view_title: z.string().min(1).max(30),
    from: z.array(VIEW_ID).min(1).max(2),
    join: z
      .object({
        on: z.array(SEMANTIC_DIMENSION_ID).min(1).describe("两个来源查询共同使用的语义维度 id"),
        how: z.enum(["left", "inner", "full"]),
      })
      .strict()
      .optional(),
    columns: z
      .array(
        z.union([
          SEMANTIC_CARRIED_COLUMN,
          z
            .object({
              expr: SEMANTIC_EXPR_NODE,
              as: z.string().min(1),
              format: z.enum(COLUMN_FORMATS).optional(),
            })
            .strict(),
        ]),
      )
      .min(1),
    order: z
      .array(z.object({ by: z.string().min(1), direction: z.enum(["asc", "desc"]) }).strict())
      .optional(),
    limit: z.number().int().positive().max(1000).optional(),
    summary: SEMANTIC_SUMMARY_INPUT.optional().describe("结果表格的模型重算总体"),
  })
  .strict();

export type SemanticAnalysisView = SemanticQueryView | SemanticDerivedView;

export function isSemanticDerivedView(view: SemanticAnalysisView): view is SemanticDerivedView {
  return "from" in view;
}

export function semanticAnalysisSink(views: SemanticAnalysisView[]): string {
  return analysisGraphSink(views);
}

const SEMANTIC_SERIES_DISPLAY = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    type: z.enum(["line", "bar"]).optional(),
    yAxis: z.enum(["left", "right"]).optional(),
    label: z.boolean().optional(),
  })
  .strict();

const PRESENTATION_FIELD = z
  .string()
  .min(1)
  .max(120)
  .describe("直接查询使用 catalog 返回的语义成员 id；派生结果使用派生列的 as 名称");
const PRESENTATION_SERIES = z
  .array(PRESENTATION_FIELD)
  .min(1)
  .optional()
  .describe("有序主指标系列；每项是语义指标 id，派生结果则是输出列名；省略时使用已查询指标");
const PRESENTATION_CATEGORY = PRESENTATION_FIELD.optional().describe(
  "分类轴维度；直接查询使用 dimensions 中的语义维度 id，只有一个分类维度时可省略",
);
const PRESENTATION_GROUP_BY = PRESENTATION_FIELD.optional().describe(
  "拆分系列的第二个分类维度；与多个主指标互斥",
);
const PRESENTATION_DISPLAY = z
  .object({
    series: z
      .record(PRESENTATION_FIELD, SEMANTIC_SERIES_DISPLAY)
      .optional()
      .describe("按主指标语义 id 或派生输出列名设置视觉样式"),
  })
  .strict()
  .optional()
  .describe("line/bar 的可选系列视觉覆盖；不改变指标、分组或计算结果");

export type SemanticChart = {
  type: "table" | "kpi" | "line" | "bar" | "pie";
  columns?: string[];
  category?: string;
  series?: string[];
  annotations?: string[];
  group_by?: string;
  stack?: boolean;
  display?: { series?: Record<string, z.infer<typeof SEMANTIC_SERIES_DISPLAY>> };
};

export const SEMANTIC_CHART_INPUT: z.ZodType<SemanticChart> = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("table").describe("精确读数、矩阵或类别较多时使用的表格"),
        columns: z
          .array(PRESENTATION_FIELD)
          .min(1)
          .optional()
          .describe(
            "table 专用有序列轴：time=逻辑时间桶，metrics=指标轴，其他值为分组维度 id 或派生输出列名；" +
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
        group_by: PRESENTATION_GROUP_BY,
        display: PRESENTATION_DISPLAY,
      })
      .strict(),
    z
      .object({
        type: z.literal("bar").describe("有限类别的比较或排行"),
        category: PRESENTATION_CATEGORY,
        series: PRESENTATION_SERIES,
        annotations: z
          .array(PRESENTATION_FIELD)
          .optional()
          .describe("结构占比等辅助标注指标；不能与主系列重复，仅 bar 支持"),
        group_by: PRESENTATION_GROUP_BY,
        stack: z.boolean().optional().describe("需同时声明 group_by；true=堆叠，false=并列分组"),
        display: PRESENTATION_DISPLAY,
      })
      .strict(),
    z
      .object({
        type: z.literal("pie").describe("一个可加计数指标在少量互斥类别中的构成"),
        category: PRESENTATION_CATEGORY,
        series: z
          .array(PRESENTATION_FIELD)
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
    if (chart.type === "bar" && chart.stack !== undefined && !chart.group_by) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stack"],
        message: "presentation.stack 仅用于 bar 且需同时声明 group_by",
      });
    }
    if ((chart.type === "line" || chart.type === "bar") && chart.group_by && chart.display) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["display"],
        message: "presentation.display 与 group_by 互斥，请移除其中一个",
      });
    }
  });

export const SEMANTIC_ANALYSIS_SPEC_INPUT = z
  .object({
    version: z.literal(2),
    analysis: z
      .object({
        title: z.string().min(1).max(100).optional(),
        views: z
          .array(z.union([SEMANTIC_QUERY_VIEW_INPUT, SEMANTIC_DERIVED_VIEW_INPUT]))
          .min(1)
          .max(MAX_PLAN_NODES),
      })
      .strict(),
    presentation: SEMANTIC_CHART_INPUT.describe(
      "唯一结果的呈现声明。必须显式选择 table、kpi、line、bar 或 pie；服务端不自动选图",
    ),
  })
  .strict();

export type SemanticAnalysisSpec = z.infer<typeof SEMANTIC_ANALYSIS_SPEC_INPUT>;

/**
 * 呈现声明归一为表格。声明的图表在实际结果形态下画不出时（非空结果仍编译不出图），
 * 执行侧与编辑器都用它当场收敛，规格里不留「声明是图、呈现是表」的冲突态。
 */
export function withTablePresentation(spec: SemanticAnalysisSpec): SemanticAnalysisSpec {
  return { ...spec, presentation: { type: "table" } };
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

function validateSemanticDerivedView(
  view: SemanticDerivedView,
  views: SemanticAnalysisView[],
): void {
  validateDerivedGraphView(view, views, {
    operands: (column) => semanticOperands(column).map((operand) => ({ source: operand.source })),
    outputName: (column) => column.as,
  });
}

export function parseSemanticAnalysisSpec(value: unknown): SemanticAnalysisSpec {
  const parsed = SEMANTIC_ANALYSIS_SPEC_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `语义分析规格无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const ids = new Set(parsed.data.analysis.views.map((view) => view.id));
  if (ids.size !== parsed.data.analysis.views.length) throw new Error("语义分析的视图 id 不得重复");
  const queryCount = parsed.data.analysis.views.filter(
    (view) => !isSemanticDerivedView(view),
  ).length;
  if (!queryCount) throw new Error("语义分析至少需要一个查询视图作为数据来源");
  for (const view of parsed.data.analysis.views) {
    if (isSemanticDerivedView(view)) {
      validateSemanticDerivedView(view, parsed.data.analysis.views);
    }
  }
  const outputId = semanticAnalysisSink(parsed.data.analysis.views);
  const calculationView = parsed.data.analysis.views.find(
    (view) => !isSemanticDerivedView(view) && view.calculations?.length,
  );
  if (
    calculationView &&
    (calculationView.id !== outputId || parsed.data.analysis.views.length > 1)
  ) {
    throw new Error("报告级构成占比只能声明在唯一直接结果视图中");
  }
  const internalGroupSort = parsed.data.analysis.views.find(
    (view) => !isSemanticDerivedView(view) && view.group_sort && view.id !== outputId,
  );
  if (internalGroupSort) {
    throw new Error(
      `分组排序只能声明在唯一直接结果视图；中间查询视图 ${internalGroupSort.id} 不能独立选择分组`,
    );
  }
  return parsed.data;
}

export function semanticResultViewId(spec: SemanticAnalysisSpec): string {
  return semanticAnalysisSink(spec.analysis.views);
}

export function semanticPresentationType(spec: SemanticAnalysisSpec): SemanticChart["type"] {
  return spec.presentation.type;
}
