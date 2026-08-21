/**
 * 服务端把 ViewIntent 与 ViewPreferences 合成这份物理呈现输入；它不进入 MCP 或持久化合同。
 * schema 校验成员绑定和图型前提，实际数据不满足声明时只退回忠实表格，不静默改写数据。
 * 时间轴由时间执行器合成；line 可确认时间成员，bar、pie 和 group_by 不接受时间绑定。
 * 个体名单恒为表格。
 * 物理呈现是纯编译产物，不参与分析指纹内容哈希。
 */
import { z } from "zod";
import { memberShortName } from "../semantic_core/member_name.js";
import { PRESENTATION_TYPE_SCHEMA } from "../semantic_core/presentation_type.js";
import {
  resolveTimeOutputGrain,
  type TimeInput,
  type TimeOutputGrain,
} from "../semantic_core/time_contract.js";
import type { ChartDecl, TableAxis, TableLayoutDecl } from "./chart_decl.js";

export type { TableAxis, TableLayoutDecl } from "./chart_decl.js";
import { TABLE_SHADING_PREFERENCES_INPUT } from "./view_preferences.js";

export const CHART_INPUT = z
  .object({
    type: PRESENTATION_TYPE_SCHEMA.describe(
      "必填呈现形态：table=表格；kpi=单行指标卡；line=时间趋势折线（时间恒为横轴）；" +
        "bar=分类柱形或条形，数量与比例混合时自动使用柱线双轴；" +
        "pie=构成饼图（仅可加计数度量）。服务端只编译声明的形态，不自动改选其他图表",
    ),
    columns: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "table 专用有序列轴：time=逻辑时间桶，metrics=指标轴，其他值须为本视图 dimensions；" +
          "未进入列轴的维度留在行轴；指标与时间同在列轴时默认 metrics 在外、time 在内，" +
          "显式顺序仍按声明生效，省略 columns 时使用确定性默认布局",
      ),
    x: z
      .string()
      .optional()
      .describe(
        "横轴绑定：bar/pie 填本视图 dimensions 中的分类（切片）维度成员，只查了一个维度时" +
          "可省略；line 的横轴恒为时间且自动绑定，x 可省略（写时间成员亦可，视为确认）",
      ),
    y: z
      .array(z.string())
      .min(1)
      .optional()
      .describe("参与画图的度量成员子集（保序）；省略时使用本视图全部 measures"),
    annotations: z
      .array(z.string())
      .optional()
      .describe("bar 的辅助标注度量；不占 Y 轴系列，只随对应主系列进入标签或读数卡"),
    group_by: z
      .string()
      .optional()
      .describe(
        "拆系列的分类维度成员（须与 x 不同）：line=每分类值一条折线，bar=每分类值一段/一组；" +
          "与多度量互斥（拆系列时 y 须收窄到一个度量）",
      ),
    stack: z
      .boolean()
      .optional()
      .describe("bar 专用且需同时声明 group_by：true=段堆叠（仅计数度量），缺省并列分组"),
    display: z
      .object({
        series: z
          .record(
            z.string(),
            z
              .object({
                color: z
                  .string()
                  .regex(/^#[0-9a-fA-F]{6}$/)
                  .optional()
                  .describe("十六进制系列颜色，例如 #5b8fd9"),
                type: z.enum(["line", "bar"]).optional().describe("系列呈现为折线或柱形"),
                yAxis: z.enum(["left", "right"]).optional().describe("系列归属左轴或右轴"),
              })
              .strict(),
          )
          .optional()
          .describe("按度量字段 id 设置每系列视觉样式"),
      })
      .strict()
      .optional()
      .describe("line/bar 图的可选系列视觉覆盖"),
    value_labels: z
      .enum(["main", "all"])
      .optional()
      .describe("line/bar 图级数值标签：main=仅第一主系列，all=全部系列（含拆分系列）；缺省不印"),
    shading: TABLE_SHADING_PREFERENCES_INPUT.optional().describe("table 专用热力着色"),
  })
  .strict();

export type ChartDeclInput = z.infer<typeof CHART_INPUT>;

/** 校验呈现声明所需的分析视图切面。 */
export type ChartSpecContext = {
  measures?: string[];
  dimensions?: string[];
  time?: TimeInput;
};

function resolveMember(name: string, pool: string[]): string | undefined {
  const key = memberShortName(name);
  return pool.find((member) => memberShortName(member) === key);
}

const tableFieldAxis = (member: string): TableAxis => ({
  kind: "field",
  column: memberShortName(member),
});

/** 表格布局所依据的输出时间粒度：分组结果不默认按月展开。 */
export function tableLayoutGrain(spec: ChartSpecContext): TimeOutputGrain {
  return resolveTimeOutputGrain(spec.time ?? {}, undefined, {
    grouped: (spec.dimensions ?? []).length > 0,
  });
}

/** 未声明列轴时的确定性表格布局；编辑器与编译器共用这一条规则。 */
export function defaultTableLayout(spec: ChartSpecContext): TableLayoutDecl {
  const dimensions = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  const grain = tableLayoutGrain(spec);
  const rows: TableAxis[] = dimensions.map(tableFieldAxis);
  if (!measures.length) return { rows, columns: [] };
  if (grain === "month" && !dimensions.length) {
    return {
      rows: [{ kind: "time", level: "month" }],
      columns: [{ kind: "metrics" }, { kind: "time", level: "year" }],
    };
  }
  return {
    rows,
    columns: [
      { kind: "metrics" },
      ...(grain === "total" ? [] : ([{ kind: "time", level: "bucket" }] satisfies TableAxis[])),
    ],
  };
}

/** 声明的列轴归一为表格布局：指标轴自动补位、剩余维度与时间留在行轴，非法声明抛错。 */
export function normalizeTableLayout(
  columns: string[] | undefined,
  spec: ChartSpecContext,
): TableLayoutDecl {
  if (!columns) return defaultTableLayout(spec);
  const dimensions = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  const temporal = tableLayoutGrain(spec) !== "total";
  const columnAxes: TableAxis[] = columns.map((axis) => {
    if (axis === "metrics") {
      if (!measures.length) throw new Error("presentation.columns 使用 metrics 时查询必须包含指标");
      return { kind: "metrics" };
    }
    if (axis === "time") {
      if (!temporal) {
        throw new Error("presentation.columns 使用 time 时查询时间必须按年或按月呈现");
      }
      return { kind: "time", level: "bucket" };
    }
    const resolved = resolveMember(axis, dimensions);
    if (!resolved) {
      throw new Error(
        `presentation.columns 的「${axis}」不是 time、metrics 或本视图 dimensions 中的成员`,
      );
    }
    return tableFieldAxis(resolved);
  });
  const axisKeys = columnAxes.map((axis) =>
    axis.kind === "field" ? `field:${memberShortName(axis.column)}` : axis.kind,
  );
  if (new Set(axisKeys).size !== axisKeys.length) {
    throw new Error("presentation.columns 不能包含重复列轴");
  }
  if (measures.length && !columnAxes.some((axis) => axis.kind === "metrics")) {
    const timeIndex = columnAxes.findIndex((axis) => axis.kind === "time");
    columnAxes.splice(timeIndex < 0 ? columnAxes.length : timeIndex, 0, { kind: "metrics" });
  }
  const columnFields = new Set(
    columnAxes.flatMap((axis) => (axis.kind === "field" ? [axis.column] : [])),
  );
  const rows: TableAxis[] = dimensions
    .filter((member) => !columnFields.has(memberShortName(member)))
    .map(tableFieldAxis);
  if (temporal && !columnAxes.some((axis) => axis.kind === "time")) {
    rows.push({ kind: "time", level: "bucket" });
  }
  return { rows, columns: columnAxes };
}

/** 输出时间轴的成员名（与 time_plan 的 raw time 成员一致）；接受全名或短名 */
const TIME_AXIS_PARTS = ["year", "month", "period_month"];
const isTimeAxisRef = (name: string) => TIME_AXIS_PARTS.includes(memberShortName(name));

export function validateChartDecl(input: ChartDeclInput, spec: ChartSpecContext): ChartDecl {
  const measures = spec.measures ?? [];
  const dimensions = spec.dimensions ?? [];
  const tableLayout = defaultTableLayout(spec);

  if (input.columns !== undefined && input.type !== "table") {
    throw new Error("presentation.columns 仅支持 type=table；其他图型请删除 columns");
  }
  if (input.shading !== undefined && input.type !== "table") {
    throw new Error("presentation.shading 仅支持 type=table；其他图型请删除 shading");
  }

  if (
    input.display !== undefined &&
    (input.type === "table" || input.type === "kpi" || input.type === "pie")
  ) {
    throw new Error(
      "presentation.display 仅支持 type=line 或 bar；table/kpi/pie 请删除 display 字段",
    );
  }
  if (
    input.value_labels !== undefined &&
    (input.type === "table" || input.type === "kpi" || input.type === "pie")
  ) {
    throw new Error(
      "presentation.value_labels 仅支持 type=line 或 bar；table/kpi/pie 请删除 value_labels 字段",
    );
  }

  if (input.type === "table" || input.type === "kpi") {
    if (
      input.x !== undefined ||
      input.y !== undefined ||
      input.annotations !== undefined ||
      input.group_by !== undefined ||
      input.stack !== undefined
    ) {
      throw new Error(
        `presentation.type=${input.type} 不接受 x/y/annotations/group_by/stack；请删除多余字段`,
      );
    }
    if (input.type === "kpi") {
      if (!measures.length) {
        throw new Error("presentation.type=kpi 需要至少一个度量");
      }
      if (dimensions.length) {
        throw new Error("presentation.type=kpi 不接受分组维度；分组结果请使用 table 或图表");
      }
    }
    return input.type === "table"
      ? {
          type: "table",
          y: [],
          tableLayout: normalizeTableLayout(input.columns, spec),
          ...(input.shading ? { shading: input.shading } : {}),
        }
      : { type: "kpi", y: [], tableLayout };
  }

  const y = (input.y ?? measures).map((name) => {
    const resolved = resolveMember(name, measures);
    if (!resolved) {
      throw new Error(
        `presentation.y 的「${name}」不在本视图 measures 中；y 只能引用本视图已查询的度量成员`,
      );
    }
    return memberShortName(resolved);
  });
  if (!y.length) {
    throw new Error(
      `presentation.type=${input.type} 需要至少一个度量；请在 measures 中加入度量成员`,
    );
  }
  const annotations = input.annotations?.map((name) => {
    const resolved = resolveMember(name, measures);
    if (!resolved) {
      throw new Error(
        `presentation.annotations 的「${name}」不在本视图 measures 中；只能引用已查询的度量成员`,
      );
    }
    return memberShortName(resolved);
  });
  if (annotations?.some((name) => y.includes(name))) {
    throw new Error("同一度量不能同时进入 presentation.y 与 presentation.annotations");
  }
  if (annotations?.length && input.type !== "bar") {
    throw new Error("presentation.annotations 仅支持 type=bar");
  }

  const resolveDim = (field: "x" | "group_by", name: string): string => {
    if (isTimeAxisRef(name)) {
      throw new Error(
        field === "group_by"
          ? "presentation.group_by 不能引用时间成员；拆系列用分类维度，时间轴已恒为 line 的横轴"
          : `presentation.x 引用了时间成员；时间轴只在 line 中呈现且自动绑定，` +
              `时间趋势请改用 type:"line"，分类对比用 x 指定分类维度`,
      );
    }
    const resolved = resolveMember(name, dimensions);
    if (!resolved) {
      throw new Error(
        `presentation.${field} 的「${name}」不在本视图 dimensions 中；只能引用本视图已查询的分组维度成员`,
      );
    }
    return memberShortName(resolved);
  };

  const groupBy = input.group_by !== undefined ? resolveDim("group_by", input.group_by) : undefined;
  if (groupBy !== undefined && y.length > 1) {
    throw new Error(
      "presentation.group_by（分类拆系列）只支持单一度量；请用 y 收窄到一个度量，或去掉 group_by",
    );
  }
  if (input.stack !== undefined && (input.type !== "bar" || groupBy === undefined)) {
    throw new Error("presentation.stack 仅用于 bar 且需同时声明 group_by（堆叠段来源维度）");
  }
  if (input.display !== undefined && groupBy !== undefined) {
    throw new Error("presentation.display 与 group_by 互斥；请移除其中一个字段");
  }
  if (input.value_labels === "main" && groupBy !== undefined) {
    throw new Error(
      "presentation.value_labels=main 与 group_by 互斥；拆分系列没有主系列，请改用 all 或删除",
    );
  }
  const display =
    input.display === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(input.display.series ?? {}).map(([name, value]) => {
            const resolved = resolveMember(name, measures);
            if (!resolved) {
              throw new Error(
                `presentation.display.series 的「${name}」不在本视图 measures 中；` +
                  "series 键只能引用本视图已查询的度量成员",
              );
            }
            return [memberShortName(resolved), value];
          }),
        );

  if (input.type === "line") {
    // 横轴恒为输出时间轴：x 引用时间成员是无害确认，归一丢弃；引用分类维度才是真歧义
    if (input.x !== undefined && !isTimeAxisRef(input.x)) {
      throw new Error(
        "presentation.type=line 的横轴恒为时间（自动绑定，x 可省略）；按分类拆线请改用 group_by",
      );
    }

    // 只读声明字段会把「自动 · 按月」这类合法状态误判成无时间轴。
    const grain = resolveTimeOutputGrain(spec.time ?? {}, undefined, {
      grouped: (spec.dimensions ?? []).length > 0,
    });
    if (grain !== "month" && grain !== "year") {
      throw new Error(
        "presentation.type=line 需要时间轴：请选择连续期间，并把时间粒度设为按月或按年",
      );
    }
    return {
      type: "line",
      y,
      tableLayout,
      ...(groupBy !== undefined ? { groupBy } : {}),
      ...(display !== undefined ? { display } : {}),
      ...(input.value_labels !== undefined ? { valueLabels: input.value_labels } : {}),
      ...(annotations !== undefined ? { annotations } : {}),
    };
  }

  // bar/pie 的分类轴：显式 x，或从规格唯一可推（去掉 group_by 后恰剩一个维度）时补齐
  const axisCandidates = dimensions
    .map((name) => memberShortName(name))
    .filter((key) => key !== groupBy);
  const x =
    input.x !== undefined
      ? resolveDim("x", input.x)
      : axisCandidates.length === 1
        ? axisCandidates[0]
        : undefined;
  if (x === undefined) {
    throw new Error(
      `presentation.type=${input.type} 无法确定分类轴：请用 x 指定 dimensions 中的一个维度成员`,
    );
  }
  if (x === groupBy) {
    throw new Error(
      "presentation.x 与 presentation.group_by 不能是同一维度；请分别指定分类轴与拆系列维度",
    );
  }

  if (input.type === "pie") {
    if (groupBy !== undefined) {
      throw new Error("presentation.type=pie 不接受 group_by；切片维度用 x 指定");
    }
    if (y.length !== 1) {
      throw new Error("presentation.type=pie 需要唯一度量；请用 y 指定一个可加计数度量");
    }
    return { type: "pie", x, y, tableLayout };
  }

  return {
    type: "bar",
    x,
    y,
    tableLayout,
    ...(groupBy !== undefined ? { groupBy } : {}),
    ...(input.stack !== undefined ? { stack: input.stack } : {}),
    ...(display !== undefined ? { display } : {}),
    ...(input.value_labels !== undefined ? { valueLabels: input.value_labels } : {}),
    ...(annotations !== undefined ? { annotations } : {}),
  };
}
