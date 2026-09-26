/** 呈现声明的列名按交付映射换成公共列名；结果数据用同一份映射。 */
import { memberShortName } from "../semantic_core/member_name.js";
import type { OutputDelivery } from "../semantic_core/execution_plan.js";
import type { ChartDecl } from "./chart_decl.js";

function publicColumnId(delivery: OutputDelivery, internal: string): string | undefined {
  return delivery.columns[internal] ?? delivery.columns[memberShortName(internal)];
}

function requiredPublicColumnId(
  delivery: OutputDelivery,
  internal: string,
  outputId: string,
): string {
  const id = publicColumnId(delivery, internal);
  if (!id) throw new Error(`结果 ${outputId} 的内部列 ${internal} 没有对应的公开语义 id`);
  return id;
}

function projectSeriesChannels(
  declaration: Extract<ChartDecl, { type: "line" | "bar" }>,
  project: (column: string) => string,
) {
  return {
    y: declaration.y.map(project),
    ...(declaration.y2 ? { y2: declaration.y2.map(project) } : {}),
    ...(declaration.annotations ? { annotations: declaration.annotations.map(project) } : {}),
    ...(declaration.groupBy ? { groupBy: project(declaration.groupBy) } : {}),
    ...(declaration.display
      ? {
          display: Object.fromEntries(
            Object.entries(declaration.display).map(([column, display]) => [
              project(column),
              display,
            ]),
          ),
        }
      : {}),
  };
}

export function projectPresentation(
  declaration: ChartDecl,
  delivery: OutputDelivery,
  outputId: string,
): ChartDecl {
  const project = (column: string) => requiredPublicColumnId(delivery, column, outputId);
  switch (declaration.type) {
    case "kpi":
      return declaration;
    case "table":
      return {
        ...declaration,
        ...(declaration.tableColumns
          ? {
              tableColumns: declaration.tableColumns.map((axis) =>
                axis.kind === "field" ? { ...axis, column: project(axis.column) } : axis,
              ),
            }
          : {}),
      };
    case "pie":
      return { ...declaration, x: project(declaration.x), y: declaration.y.map(project) };
    case "line":
      return { ...declaration, ...projectSeriesChannels(declaration, project) };
    case "bar":
      return {
        ...declaration,
        x: project(declaration.x),
        ...projectSeriesChannels(declaration, project),
      };
  }
}
