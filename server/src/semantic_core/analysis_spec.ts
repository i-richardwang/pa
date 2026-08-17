import { z } from "zod";
import { analysisGraphSink, validateDerivedGraphView } from "./analysis_graph.js";
import { TIME_INPUT } from "./time_contract.js";
import { COLUMN_FORMATS, type ColumnFormat } from "./query_payload.js";

/** 引擎预算：一次分析的执行节点（查询腿 + 变换）总数上限。用户不感知此数。 */
export const MAX_PLAN_NODES = 3;

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
      z
        .object({
          member: z.string().describe("过滤维度成员全名"),
          /**
           * 物理算子全集，比客户语言宽：`contains` 供维度取值检索，`set` / `notSet` 供指标
           * 计算的空值腿与明细投影。这些是引擎自己编出来的谓词，不由语义面透出。
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
        })
        .strict(),
    )
    .optional()
    .describe("过滤条件；名录型维度先用 values_of 确认真实值"),
  order: z
    .array(z.object({ member: z.string(), direction: z.enum(["asc", "desc"]) }).strict())
    .optional()
    .describe("按数组顺序生效的排序规则"),
  time: TIME_INPUT.describe("查询时间协议"),
};

export const TOP_N_SELECTION_INPUT = z
  .object({
    type: z.literal("top_n"),
    dimensions: z.array(z.string().min(1)).min(1).describe("实际参与选择的物理分组维度"),
    by: z.string().min(1).describe("用于分组排名的物理度量成员，或按名称排序的目标维度"),
    window: z.literal("anchor").describe("主范围的最新逻辑输出桶"),
    count: z.number().int().positive().max(1000).describe("要选择的完整业务分组数量"),
    direction: z.enum(["asc", "desc"]).describe("排名指标从低到高或从高到低"),
  })
  .strict();

export type TopNSelectionSpec = z.infer<typeof TOP_N_SELECTION_INPUT>;

/** 两层 summary 面向同一批消费者，口径说明单源在此。 */
export const GRAND_TOTAL_DESCRIPTION = "保留筛选与时间粒度，移除业务分组后由模型重新聚合";

export const SUMMARY_INPUT = z
  .object({
    mode: z.literal("grand_total").describe(GRAND_TOTAL_DESCRIPTION),
  })
  .strict();

export type SummarySpec = z.infer<typeof SUMMARY_INPUT>;

export const QUERY_VIEW_INPUT = z
  .object({
    id: VIEW_ID,
    view_title: z.string().min(1).max(30).optional(),
    /** 跨指标域查询使用的时间与一致维度锚点；仅存在于服务端物理执行规格。 */
    time_view: VIEW_ID.optional(),
    ...QUERY_FIELDS,
    selection: TOP_N_SELECTION_INPUT.optional(),
    summary: SUMMARY_INPUT.optional(),
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
    if (view.selection) {
      if (view.order?.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selection"],
          message: "Top-N 分组选择已经声明结果顺序，不能再同时声明普通排序",
        });
      }
      if (
        !view.measures?.includes(view.selection.by) &&
        !view.selection.dimensions.includes(view.selection.by)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selection", "by"],
          message: "Top-N 排名依据必须来自查询 measures，或是选择维度本身",
        });
      }
      const dimensions = new Set(view.dimensions ?? []);
      if (view.selection.dimensions.some((member) => !dimensions.has(member))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selection", "dimensions"],
          message: "Top-N 物理选择维度必须来自查询 dimensions",
        });
      }
      if (new Set(view.selection.dimensions).size !== view.selection.dimensions.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
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
    cardinality?: "one_to_one" | "many_to_one";
  };
  columns: DerivedColumnInput[];
  structure_shares?: { measure: string; numerator: string }[];
  order?: { by: string; direction: "asc" | "desc" }[];
  limit?: number;
  summary?: SummarySpec;
};

const COLUMN_OPERAND = z
  .object({
    col: z.string().min(1).describe("输入视图中的列名"),
    source: VIEW_ID.describe("该列所属查询视图的 id"),
  })
  .strict();
const CARRIED_COLUMN = COLUMN_OPERAND.extend({
  as: z.string().min(1).optional().describe("可选输出列名"),
}).strict();
const LITERAL_OPERAND = z.object({ lit: z.number() }).strict();
export const EXPR_NODE: z.ZodType<ExprNode> = z.lazy(() =>
  z
    .object({
      op: z.enum(["+", "-", "*", "/"]),
      left: z.union([EXPR_NODE, COLUMN_OPERAND, LITERAL_OPERAND]),
      right: z.union([EXPR_NODE, COLUMN_OPERAND, LITERAL_OPERAND]),
    })
    .strict(),
);

export const DERIVED_VIEW_INPUT: z.ZodType<DerivedViewSpec> = z
  .object({
    id: VIEW_ID,
    view_title: z.string().min(1).max(30),
    from: z.array(VIEW_ID).min(1).max(2),
    join: z
      .object({
        on: z.array(
          z
            .object({
              left: z.string().min(1).describe("from[0] 输入视图中的关联列"),
              right: z.string().min(1).describe("from[1] 输入视图中的关联列"),
            })
            .strict(),
        ),
        how: z.enum(["left", "inner", "full"]),
        cardinality: z.enum(["one_to_one", "many_to_one"]).optional(),
      })
      .strict()
      .optional(),
    columns: z
      .array(
        z.union([
          CARRIED_COLUMN,
          z
            .object({
              expr: EXPR_NODE,
              as: z.string().min(1),
              format: z.enum(COLUMN_FORMATS).optional(),
            })
            .strict(),
        ]),
      )
      .min(1),
    structure_shares: z
      .array(z.object({ measure: z.string().min(1), numerator: z.string().min(1) }).strict())
      .optional(),
    order: z
      .array(z.object({ by: z.string().min(1), direction: z.enum(["asc", "desc"]) }).strict())
      .optional(),
    limit: z.number().int().positive().max(1000).optional(),
    summary: SUMMARY_INPUT.optional(),
  })
  .strict()
  .superRefine((view, context) => {
    if (!view.join) return;
    const cardinality = view.join.cardinality ?? "one_to_one";
    if (cardinality === "one_to_one" && view.join.on.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["join", "on"],
        message: "one_to_one join 至少需要一个关联列",
      });
    }
    if (cardinality === "many_to_one" && view.join.how !== "left") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["join", "how"],
        message: "many_to_one 只支持 left join",
      });
    }
  });

export const ANALYSIS_VIEW_INPUT = z.union([QUERY_VIEW_INPUT, DERIVED_VIEW_INPUT]);
export type AnalysisViewSpec = QueryViewSpec | DerivedViewSpec;

export const ANALYSIS_SPEC_INPUT = z
  .object({
    title: z.string().min(1).max(100).optional(),
    views: z.array(ANALYSIS_VIEW_INPUT).min(1).max(MAX_PLAN_NODES),
  })
  .strict();

export type AnalysisSpec = z.infer<typeof ANALYSIS_SPEC_INPUT>;

export function isDerivedViewSpec(view: AnalysisViewSpec): view is DerivedViewSpec {
  return "from" in view;
}

/** 派生列在结果中的列名：携带列可用 as 改名，缺省沿用来源列名；表达式列恒以 as 命名。 */
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
  const outputs = new Set(view.columns.map(derivedColumnName));
  for (const relation of view.structure_shares ?? []) {
    if (!outputs.has(relation.measure) || !outputs.has(relation.numerator)) {
      throw new Error("结构占比关系只能引用派生视图的输出列");
    }
    if (relation.measure === relation.numerator) {
      throw new Error("结构占比列与分子列不能相同");
    }
  }
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
