import { CHART_INPUT, validateChartDecl } from "./chart_spec.js";
import {
  analysisSink,
  derivedColumnName,
  isDerivedViewSpec,
  type AnalysisSpec,
  type AnalysisViewSpec,
} from "../semantic_core/analysis_spec.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { ViewIntentError } from "../semantic_core/semantic_analysis.js";
import type { ChartDecl } from "./chart_decl.js";

/** 编译后的物理呈现规格：字段绑定已归一，执行器只消费这一份声明。 */
export type PresentationSpec = ChartDecl;

export function chartContextForView(
  view: AnalysisViewSpec,
  analysis?: AnalysisSpec,
): {
  measures: string[];
  dimensions: string[];
  time?: import("../semantic_core/time_contract.js").TimeInput;
} {
  if (!isDerivedViewSpec(view)) {
    return {
      measures: view.measures ?? [],
      dimensions: view.dimensions ?? [],
      time: view.time,
    };
  }
  const measures: string[] = [];
  const dimensions: string[] = [];
  for (const column of view.columns) {
    const name = derivedColumnName(column);
    if ("expr" in column) {
      measures.push(name);
      continue;
    }
    const source = analysis?.views.find((candidate) => candidate.id === column.source);
    if (
      source &&
      !isDerivedViewSpec(source) &&
      source.measures?.some((member) => memberShortName(member) === memberShortName(column.col))
    ) {
      measures.push(name);
    } else {
      dimensions.push(name);
    }
  }
  return { measures, dimensions };
}

export function parsePresentationSpec(value: unknown, analysis: AnalysisSpec): PresentationSpec {
  const parsed = CHART_INPUT.safeParse(value);
  if (!parsed.success) {
    throw new ViewIntentError(
      `呈现规格无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const outputId = analysisSink(analysis.views);
  const view = analysis.views.find((candidate) => candidate.id === outputId);
  if (!view) throw new Error(`结果视图 ${outputId} 不存在`);
  try {
    return validateChartDecl(parsed.data, chartContextForView(view, analysis));
  } catch (error) {
    if (error instanceof ViewIntentError) throw error;
    throw new ViewIntentError(
      `结果呈现声明无效：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
