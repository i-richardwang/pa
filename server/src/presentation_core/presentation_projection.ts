/** 把物理呈现成员投影为稳定公共列身份；结果数据与呈现声明共用同一交付映射。 */
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
  if (!id) throw new Error(`交付结果 ${outputId} 的执行列 ${internal} 缺少公共语义身份`);
  return id;
}

export function projectPresentation(
  declaration: ChartDecl,
  delivery: OutputDelivery,
  outputId: string,
): ChartDecl {
  const project = (column: string) => requiredPublicColumnId(delivery, column, outputId);
  return {
    ...declaration,
    ...(declaration.tableColumns
      ? {
          tableColumns: declaration.tableColumns.map((axis) =>
            axis.kind === "field" ? { ...axis, column: project(axis.column) } : axis,
          ),
        }
      : {}),
    ...(declaration.x ? { x: project(declaration.x) } : {}),
    y: declaration.y.map(project),
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
