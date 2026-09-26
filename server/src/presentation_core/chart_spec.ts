/**
 * 图表声明与结果视图的绑定：核对成员是否在结果里，列名换成载荷列短名，
 * 并补齐要看到结果才能确定的默认值（指标列轴、唯一维度作分类轴）。
 * 不进入 MCP 或持久化合同，也不参与分析指纹的内容哈希。
 */
import { memberShortName } from "../semantic_core/member_name.js";
import { ViewIntentError } from "../semantic_core/semantic_analysis.js";
import type { ChartDecl, SeriesDisplay, TableAxis } from "./chart_decl.js";
import type { TableShadingPreferences } from "./view_preferences.js";

export type { TableAxis } from "./chart_decl.js";

type ValueLabels = "main" | "all";
type Display = Record<string, SeriesDisplay>;

/** 编译器产出的图表声明，成员名尚未对照结果视图核对。 */
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

/** 校验呈现声明用到的分析视图度量与维度。 */
export type ChartSpecContext = {
  measures?: string[];
  dimensions?: string[];
};

function resolveMember(name: string, pool: string[]): string | undefined {
  const key = memberShortName(name);
  return pool.find((member) => memberShortName(member) === key);
}

/** 通道引用的成员必须在这次查询的结果里；返回载荷列短名。 */
function boundMember(channel: string, name: string, pool: string[]): string {
  const resolved = resolveMember(name, pool);
  if (!resolved) throw new ViewIntentError(`${channel}的「${name}」不在这次查询的结果里`);
  return memberShortName(resolved);
}

const tableFieldAxis = (member: string): TableAxis => ({
  kind: "field",
  column: memberShortName(member),
});

/** 归一化列轴：未声明指标轴时自动补上，非法声明报错；行轴由结果中其余的列组成，不在这里处理。 */
export function normalizeTableColumns(
  columns: string[] | undefined,
  spec: ChartSpecContext,
): TableAxis[] | undefined {
  if (!columns) return undefined;
  const dimensions = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  const columnAxes: TableAxis[] = columns.map((axis) => {
    if (axis === "metrics") {
      if (!measures.length)
        throw new ViewIntentError("列轴包含 metrics 时，查询必须至少包含一个指标");
      return { kind: "metrics" };
    }
    if (axis === "time") return { kind: "time", level: "bucket" };
    const resolved = resolveMember(axis, dimensions);
    if (!resolved) {
      throw new ViewIntentError(`列轴的「${axis}」不是时间、指标，也不是这次查询的维度`);
    }
    return tableFieldAxis(resolved);
  });
  // 语义层已去重；两个语义维度绑定到同一列的情况只能在这里发现。
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

/** 输出时间轴的成员名，须与 time_plan 的原始时间成员一致；全名和短名都识别 */
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
      : chart.y2.map((name) => boundMember("副轴指标（y2）", name, measures));
  const y = (chart.y ?? measures.filter((name) => !y2?.includes(memberShortName(name)))).map(
    (name) => boundMember("指标（y）", name, measures),
  );
  if (!y.length) throw new ViewIntentError(`${chart.type} 图至少需要一个指标`);
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
    throw new ViewIntentError("使用拆分维度时只能有一个指标；请只保留一个指标，或去掉拆分维度");
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
            boundMember("系列设置（series）", name, measures),
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

/** bar/pie 必须有分类轴；只有一个候选维度时可以不声明。 */
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
