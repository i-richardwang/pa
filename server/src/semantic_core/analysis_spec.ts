import { z } from "zod";
import { analysisGraphSink, validateDerivedGraphView } from "./analysis_graph.js";
import { TIME_INPUT } from "./time_contract.js";
import { COLUMN_FORMATS, type ColumnFormat } from "./query_payload.js";

const VIEW_ID = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64)
  .describe("本次分析内稳定且唯一的 ASCII snake_case 视图标识");

export const QUERY_FIELDS = {
  measures: z.array(z.string()).optional().describe("catalog 返回的度量成员全名"),
  dimensions: z.array(z.string()).optional().describe("catalog 返回的分组维度成员全名"),
  filters: z
    .array(
      z.strictObject({
        member: z.string().describe("过滤维度成员全名"),
        /**
         * `contains` 用于维度候选值检索，`set` / `notSet` 用于指标计算的空值子查询和明细投影；
         * 这些算子只由引擎内部生成，不对语义层公开。
         */
        operator: z.enum([
          "equals",
          "notEquals",
          "contains",
          "notContains",
          "gt",
          "gte",
          "lt",
          "lte",
          "set",
          "notSet",
        ]),
        values: z.array(z.string()).optional().describe("与 operator 比较的字符串值"),
      }),
    )
    .optional()
    .describe("过滤条件；名录型维度先用 values_of 确认真实值"),
  order: z
    .array(z.strictObject({ member: z.string(), direction: z.enum(["asc", "desc"]) }))
    .optional()
    .describe("按数组顺序生效的排序规则"),
  time: TIME_INPUT.describe("查询时间协议"),
};

export const TOP_N_SELECTION_INPUT = z.strictObject({
  type: z.literal("top_n"),
  dimensions: z.array(z.string().min(1)).min(1).describe("实际参与选择的物理分组维度"),
  by: z.string().min(1).describe("用于分组排名的物理度量成员，或按名称排序的目标维度"),
  window: z.literal("anchor").describe("按主期间最后一个时间桶的数值排名"),
  count: z.int().positive().max(1000).describe("选取的分组数量"),
  direction: z.enum(["asc", "desc"]).describe("排名指标从低到高或从高到低"),
});

export type TopNSelectionSpec = z.infer<typeof TOP_N_SELECTION_INPUT>;

/** 两层 summary 共用这条口径说明。 */
export const GRAND_TOTAL_DESCRIPTION = "保留筛选与时间粒度，移除业务分组后由模型重新聚合";

export const SUMMARY_INPUT = z.strictObject({
  mode: z.literal("grand_total").describe(GRAND_TOTAL_DESCRIPTION),
});

export type SummarySpec = z.infer<typeof SUMMARY_INPUT>;

const GROUPING_DIMENSION_INPUT = z.strictObject({
  id: z
    .string()
    .regex(/^dimension:[a-z][a-z0-9_]*$/)
    .max(120),
  member: z.string().min(1),
});

const GROUPING_SHARE_CALCULATION_INPUT = z.strictObject({
  kind: z.literal("grouping_share"),
  id: z
    .string()
    .regex(/^calculation:[a-z][a-z0-9_]*$/)
    .max(120),
  title: z.string().trim().min(1).max(30),
  measure: z.string().min(1),
  category_dimension: z
    .string()
    .regex(/^dimension:[a-z][a-z0-9_]*$/)
    .max(120),
});

export const GROUPING_SETS_INPUT = z
  .strictObject({
    base: z.array(GROUPING_DIMENSION_INPUT),
    calculations: z.array(GROUPING_SHARE_CALCULATION_INPUT).optional(),
  })
  .superRefine((value, context) => {
    const ids = value.base.map((dimension) => dimension.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["base"],
        message: "基础分组集不能包含重复语义维度",
      });
    }
    const members = value.base.map((dimension) => dimension.member);
    if (new Set(members).size !== members.length) {
      context.addIssue({
        code: "custom",
        path: ["base"],
        message: "基础分组集不能包含重复物理维度",
      });
    }
    for (const [index, calculation] of (value.calculations ?? []).entries()) {
      if (!ids.includes(calculation.category_dimension)) {
        context.addIssue({
          code: "custom",
          path: ["calculations", index, "category_dimension"],
          message: "构成占比的分类维度必须属于基础分组集",
        });
      }
    }
  });

export type GroupingSetsSpec = z.infer<typeof GROUPING_SETS_INPUT>;
export type GroupingShareCalculationSpec = NonNullable<GroupingSetsSpec["calculations"]>[number];

/** 报告计算的结果列名只由计算 id 派生，不使用业务标题。 */
export function calculationColumnName(id: string): string {
  return id.replace(":", "_");
}

export const QUERY_VIEW_INPUT = z
  .strictObject({
    id: VIEW_ID,
    view_title: z.string().min(1).max(30).optional(),
    /** 跨指标域查询使用的时间与一致维度锚点；仅存在于服务端物理执行规格。 */
    time_view: VIEW_ID.optional(),
    stable_grouping: z.literal(true).optional(),
    ...QUERY_FIELDS,
    grouping_sets: GROUPING_SETS_INPUT.optional(),
    selection: TOP_N_SELECTION_INPUT.optional(),
    summary: SUMMARY_INPUT.optional(),
  })
  .superRefine((view, context) => {
    if (!view.measures?.length && !view.dimensions?.length) {
      context.addIssue({
        code: "custom",
        message: "measures 与 dimensions 至少提供一个",
      });
    }
    if (view.summary && (!view.measures?.length || !view.dimensions?.length)) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "总体行只适用于同时包含指标与业务分组维度的查询",
      });
    }
    if (view.grouping_sets) {
      const dimensions = new Set(view.dimensions ?? []);
      for (const [index, dimension] of view.grouping_sets.base.entries()) {
        if (!dimensions.has(dimension.member)) {
          context.addIssue({
            code: "custom",
            path: ["grouping_sets", "base", index, "member"],
            message: "基础分组集的物理绑定必须属于查询 dimensions",
          });
        }
      }
      const measures = new Set(view.measures ?? []);
      for (const [index, calculation] of (view.grouping_sets.calculations ?? []).entries()) {
        if (!measures.has(calculation.measure)) {
          context.addIssue({
            code: "custom",
            path: ["grouping_sets", "calculations", index, "measure"],
            message: "grouping-set 计算的基础指标必须属于查询 measures",
          });
        }
      }
    }
    if (view.selection) {
      if (view.order?.length) {
        context.addIssue({
          code: "custom",
          path: ["selection"],
          message: "Top-N 分组选择已经声明结果顺序，不能再同时声明普通排序",
        });
      }
      if (
        !view.measures?.includes(view.selection.by) &&
        !view.selection.dimensions.includes(view.selection.by)
      ) {
        context.addIssue({
          code: "custom",
          path: ["selection", "by"],
          message: "Top-N 排名依据必须来自查询 measures，或是选择维度本身",
        });
      }
      const dimensions = new Set(view.dimensions ?? []);
      if (view.selection.dimensions.some((member) => !dimensions.has(member))) {
        context.addIssue({
          code: "custom",
          path: ["selection", "dimensions"],
          message: "Top-N 物理选择维度必须来自查询 dimensions",
        });
      }
      if (new Set(view.selection.dimensions).size !== view.selection.dimensions.length) {
        context.addIssue({
          code: "custom",
          path: ["selection", "dimensions"],
          message: "Top-N 物理选择维度不能重复",
        });
      }
    }
  });

export type QueryViewSpec = z.infer<typeof QUERY_VIEW_INPUT>;

export type ColumnOperand = { col: string; source: string };
export type CarriedColumnInput = ColumnOperand & { as?: string };
export type LiteralOperand = { lit: number };
export type ExprNode = {
  op: "+" | "-" | "*" | "/";
  left: ExprNode | ColumnOperand | LiteralOperand;
  right: ExprNode | ColumnOperand | LiteralOperand;
};
export type DerivedColumnInput =
  | CarriedColumnInput
  | { expr: ExprNode; as: string; format?: ColumnFormat };
export type JoinKeyInput = { left: string; right: string };
export type DerivedViewSpec = {
  id: string;
  view_title: string;
  from: string[];
  join?: {
    on: JoinKeyInput[];
    how: "left" | "inner" | "full";
  };
  columns: DerivedColumnInput[];
  order?: { by: string; direction: "asc" | "desc" }[];
  limit?: number;
  summary?: SummarySpec;
};

const COLUMN_OPERAND = z.strictObject({
  col: z.string().min(1).describe("输入视图中的列名"),
  source: VIEW_ID.describe("该列所属查询视图的 id"),
});
const CARRIED_COLUMN = COLUMN_OPERAND.extend({
  as: z.string().min(1).optional().describe("可选输出列名"),
});
const LITERAL_OPERAND = z.strictObject({ lit: z.number() });
export const EXPR_NODE: z.ZodType<ExprNode> = z.lazy(() =>
  z.strictObject({
    op: z.enum(["+", "-", "*", "/"]),
    left: z.union([EXPR_NODE, COLUMN_OPERAND, LITERAL_OPERAND]),
    right: z.union([EXPR_NODE, COLUMN_OPERAND, LITERAL_OPERAND]),
  }),
);

export const DERIVED_VIEW_INPUT: z.ZodType<DerivedViewSpec> = z
  .strictObject({
    id: VIEW_ID,
    view_title: z.string().min(1).max(30),
    from: z.array(VIEW_ID).min(1).max(2),
    join: z
      .strictObject({
        on: z.array(
          z.strictObject({
            left: z.string().min(1).describe("from[0] 输入视图中的关联列"),
            right: z.string().min(1).describe("from[1] 输入视图中的关联列"),
          }),
        ),
        how: z.enum(["left", "inner", "full"]),
      })
      .optional(),
    columns: z
      .array(
        z.union([
          CARRIED_COLUMN,
          z.strictObject({
            expr: EXPR_NODE,
            as: z.string().min(1),
            format: z.enum(COLUMN_FORMATS).optional(),
          }),
        ]),
      )
      .min(1),
    order: z
      .array(z.strictObject({ by: z.string().min(1), direction: z.enum(["asc", "desc"]) }))
      .optional(),
    limit: z.int().positive().max(1000).optional(),
    summary: SUMMARY_INPUT.optional(),
  })
  .superRefine((view, context) => {
    if (!view.join) return;
    if (view.join.on.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["join", "on"],
        message: "one_to_one join 至少需要一个关联列",
      });
    }
  });

export const ANALYSIS_VIEW_INPUT = z.union([QUERY_VIEW_INPUT, DERIVED_VIEW_INPUT]);
export type AnalysisViewSpec = QueryViewSpec | DerivedViewSpec;

export const ANALYSIS_SPEC_INPUT = z.strictObject({
  title: z.string().min(1).max(100).optional(),
  views: z.array(ANALYSIS_VIEW_INPUT).min(1),
});

export type AnalysisSpec = z.infer<typeof ANALYSIS_SPEC_INPUT>;

export function isDerivedViewSpec(view: AnalysisViewSpec): view is DerivedViewSpec {
  return "from" in view;
}

export function derivedColumnName(column: DerivedColumnInput): string {
  return "col" in column ? (column.as ?? column.col) : column.as;
}

export function analysisSink(views: AnalysisViewSpec[]): string {
  return analysisGraphSink(views);
}

function columnSources(column: DerivedColumnInput): ColumnOperand[] {
  if ("col" in column) return [column];
  const operands: ColumnOperand[] = [];
  const visit = (node: ExprNode | ColumnOperand | LiteralOperand): void => {
    if ("col" in node) operands.push(node);
    else if ("op" in node) {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(column.expr);
  return operands;
}

function validateDerivedView(view: DerivedViewSpec, views: AnalysisViewSpec[]): void {
  validateDerivedGraphView(view, views, {
    operands: (column) =>
      columnSources(column).map((operand) => ({ source: operand.source, label: operand.col })),
    outputName: derivedColumnName,
  });
}

export function parseAnalysisSpec(value: unknown): AnalysisSpec {
  const parsed = ANALYSIS_SPEC_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `分析规格无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const ids = parsed.data.views.map((view) => view.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`视图 id「${duplicate}」重复；每个视图必须使用唯一 id`);
  const queryCount = parsed.data.views.filter((view) => !isDerivedViewSpec(view)).length;
  if (!queryCount) throw new Error("分析至少需要一个查询视图作为数据来源");
  for (const view of parsed.data.views) {
    if (isDerivedViewSpec(view)) validateDerivedView(view, parsed.data.views);
  }
  analysisSink(parsed.data.views);
  return parsed.data;
}
