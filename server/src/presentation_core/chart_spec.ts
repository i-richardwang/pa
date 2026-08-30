/**
 * 图表声明与交付结果的绑定层：编译器按图型定形的声明在这里对着结果视图核对成员、
 * 归一为载荷列短名，并补齐只有看到结果才知道的缺省（指标列轴补位、唯一维度的分类轴）。
 * 不进入 MCP 或持久化合同，也不参与分析指纹内容哈希。
 */
import { memberShortName } from "../semantic_core/member_name.js";
import { ViewIntentError } from "../semantic_core/semantic_analysis.js";
import type { ChartDecl, SeriesDisplay, TableAxis } from "./chart_decl.js";
import type { TableShadingPreferences } from "./view_preferences.js";

export type { TableAxis } from "./chart_decl.js";

type ValueLabels = "main" | "all";
type Display = Record<string, SeriesDisplay>;

/**
 * 编译器产出的图表声明：通道按图型定形，哪个通道属于哪个图型出自这份形状本身，
 * 绑定层不再复述适用性。成员名还是编译期的绑定结果，尚未对着交付视图核对。
 */
export type UnboundChart =
  | { type: "table"; columns?: string[]; shading?: TableShadingPreferences }
  | { type: "kpi" }
  | {
      type: "line";
      y?: string[];
      y2?: string[];
      annotations?: string[];
      group_by?: string;
      display?: Display;
      value_labels?: ValueLabels;
    }
  | {
      type: "bar";
      x?: string;
      y?: string[];
      y2?: string[];
      annotations?: string[];
      group_by?: string;
      stack?: boolean;
      display?: Display;
      value_labels?: ValueLabels;
    }
  | { type: "pie"; x?: string; y?: string[] };

/** 校验呈现声明所需的分析视图切面。 */
export type ChartSpecContext = {
  measures?: string[];
  dimensions?: string[];
};

function resolveMember(name: string, pool: string[]): string | undefined {
  const key = memberShortName(name);
  return pool.find((member) => memberShortName(member) === key);
}

/** 通道引用的成员必须是这次查询交付的成员；归一为载荷列短名。 */
function boundMember(channel: string, name: string, pool: string[]): string {
  const resolved = resolveMember(name, pool);
  if (!resolved) throw new ViewIntentError(`${channel}的「${name}」不在这次查询的结果里`);
  return memberShortName(resolved);
}

const tableFieldAxis = (member: string): TableAxis => ({
  kind: "field",
  column: memberShortName(member),
});

/** 声明的列轴归一：指标轴自动补位，非法声明抛错。行轴不在此裁决——它是结果的余数。 */
export function normalizeTableColumns(
  columns: string[] | undefined,
  spec: ChartSpecContext,
): TableAxis[] | undefined {
  if (!columns) return undefined;
  const dimensions = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  const columnAxes: TableAxis[] = columns.map((axis) => {
    if (axis === "metrics") {
      if (!measures.length) throw new ViewIntentError("列轴放指标时这次查询必须查了指标");
      return { kind: "metrics" };
    }
    if (axis === "time") return { kind: "time", level: "bucket" };
    const resolved = resolveMember(axis, dimensions);
    if (!resolved) {
      throw new ViewIntentError(`列轴的「${axis}」不是时间、指标，也不是这次查询的维度`);
    }
    return tableFieldAxis(resolved);
  });
  // 语义层已去过重；两个语义维度绑到同一列时只有这里看得见。
  const axisKeys = columnAxes.map((axis) =>
    axis.kind === "field" ? `field:${memberShortName(axis.column)}` : axis.kind,
  );
  if (new Set(axisKeys).size !== axisKeys.length) {
    throw new ViewIntentError("列轴不能重复");
  }
  if (measures.length && !columnAxes.some((axis) => axis.kind === "metrics")) {
    const timeIndex = columnAxes.findIndex((axis) => axis.kind === "time");
    columnAxes.splice(timeIndex < 0 ? columnAxes.length : timeIndex, 0, { kind: "metrics" });
  }
  return columnAxes;
}

/** 输出时间轴的成员名（与 time_plan 的 raw time 成员一致）；接受全名或短名 */
const TIME_AXIS_PARTS = ["year", "month", "period_month"];
const isTimeAxisRef = (name: string) => TIME_AXIS_PARTS.includes(memberShortName(name));

export function bindChartDecl(chart: UnboundChart, spec: ChartSpecContext): ChartDecl {
  const measures = spec.measures ?? [];
  const dimensions = spec.dimensions ?? [];

  if (chart.type === "kpi") {
    if (!measures.length) throw new ViewIntentError("指标卡需要至少一个指标");
    if (dimensions.length) {
      throw new ViewIntentError("指标卡不接受分组维度；分组结果请改用表格或图表");
    }
    return { type: "kpi" };
  }
  if (chart.type === "table") {
    const tableColumns = normalizeTableColumns(chart.columns, spec);
    return {
      type: "table",
      ...(tableColumns ? { tableColumns } : {}),
      ...(chart.shading ? { shading: chart.shading } : {}),
    };
  }

  const y2 =
    chart.type === "pie" || chart.y2 === undefined
      ? undefined
      : chart.y2.map((name) => boundMember("副轴系列", name, measures));
  const y = (chart.y ?? measures.filter((name) => !y2?.includes(memberShortName(name)))).map(
    (name) => boundMember("值通道", name, measures),
  );
  if (!y.length) throw new ViewIntentError(`${chart.type} 呈现至少需要一个指标`);
  if (y2?.some((name) => y.includes(name))) {
    throw new ViewIntentError("同一指标不能同时在主轴与副轴");
  }

  const dimension = (channel: string, name: string): string => {
    if (isTimeAxisRef(name)) {
      throw new ViewIntentError(
        channel === "拆分维度"
          ? "拆分维度不能用时间；时间已经是折线的横轴"
          : "分类轴不能用时间；看时间趋势请改用折线",
      );
    }
    return boundMember(channel, name, dimensions);
  };

  if (chart.type === "pie") {
    if (y.length !== 1) throw new ViewIntentError("饼图只能画一个指标");
    return { type: "pie", x: categoryAxis(chart.x, dimensions, dimension, undefined, "饼图"), y };
  }

  const groupBy = chart.group_by !== undefined ? dimension("拆分维度", chart.group_by) : undefined;
  if (groupBy !== undefined && (y.length > 1 || y2)) {
    throw new ViewIntentError("按维度拆系列时只能画一个指标；请把值通道收窄到一个，或去掉拆分");
  }
  const annotations = chart.annotations?.map((name) => boundMember("辅助标注", name, measures));
  if (annotations?.some((name) => y.includes(name))) {
    throw new ViewIntentError("同一指标不能同时是主系列和辅助标注");
  }
  const display =
    chart.display === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(chart.display).map(([name, value]) => [
            boundMember("系列视觉设置", name, measures),
            value,
          ]),
        );

  const style = {
    ...(y2?.length ? { y2 } : {}),
    ...(groupBy !== undefined ? { groupBy } : {}),
    ...(annotations !== undefined ? { annotations } : {}),
    ...(display !== undefined ? { display } : {}),
    ...(chart.value_labels !== undefined ? { valueLabels: chart.value_labels } : {}),
  };
  if (chart.type === "line") return { type: "line", y, ...style };

  const x = categoryAxis(chart.x, dimensions, dimension, groupBy, "柱状图");
  if (x === groupBy) {
    throw new ViewIntentError("分类轴与拆分维度不能是同一个维度");
  }
  return {
    type: "bar",
    x,
    y,
    ...style,
    ...(chart.stack !== undefined ? { stack: chart.stack } : {}),
  };
}

/** 分类轴是 bar/pie 的必备通道；只剩一个候选维度时不必声明。 */
function categoryAxis(
  declared: string | undefined,
  dimensions: string[],
  dimension: (channel: string, name: string) => string,
  groupBy: string | undefined,
  form: string,
): string {
  if (declared !== undefined) return dimension("分类轴", declared);
  const candidates = dimensions
    .map((name) => memberShortName(name))
    .filter((key) => key !== groupBy);
  if (candidates.length !== 1) {
    throw new ViewIntentError(`${form}需要指定一个分类维度`);
  }
  return candidates[0];
}
