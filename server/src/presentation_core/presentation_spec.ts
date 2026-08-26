import { bindChartDecl, type UnboundChart } from "./chart_spec.js";
import {
  analysisSink,
  derivedColumnName,
  isDerivedViewSpec,
  type AnalysisSpec,
  type AnalysisViewSpec,
} from "../semantic_core/analysis_spec.js";
import { memberShortName } from "../semantic_core/member_name.js";
import type { ChartDecl } from "./chart_decl.js";

/** 编译后的物理呈现规格：字段绑定已归一，执行器只消费这一份声明。 */
export type PresentationSpec = ChartDecl;

export function chartContextForView(
  view: AnalysisViewSpec,
  analysis?: AnalysisSpec,
): { measures: string[]; dimensions: string[] } {
  if (!isDerivedViewSpec(view)) {
    return { measures: view.measures ?? [], dimensions: view.dimensions ?? [] };
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

export function bindPresentation(chart: UnboundChart, analysis: AnalysisSpec): PresentationSpec {
  const outputId = analysisSink(analysis.views);
  const view = analysis.views.find((candidate) => candidate.id === outputId);
  if (!view) throw new Error(`结果视图 ${outputId} 不存在`);
  return bindChartDecl(chart, chartContextForView(view, analysis));
}
