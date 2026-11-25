import { z } from "zod";
import type { CubeGateway, CubeSecurityContext } from "../ports/cube_gateway.js";
import { memberDisplayTitle } from "./member_presentation.js";
import { executeBoundedMetricQuery } from "./metric_executor.js";
import {
  METRIC_QUERY_PLAN_SCHEMA,
  metricOutputMembers,
  type MetricQueryPlan,
} from "./metric_planner.js";
import { applyValueOrder } from "./value_order.js";

/** Cube REST /v1/load 的默认行上限即 50000，导出档位顶格使用 */
export const EXPORT_MAX_ROWS = 50000;

export const EXPORT_PLAN_SCHEMA = z.union([
  METRIC_QUERY_PLAN_SCHEMA,
  z.strictObject({ kind: z.literal("analysis_view"), view_id: z.uuid() }),
]);
export type ExportPlan = z.infer<typeof EXPORT_PLAN_SCHEMA>;

export type MaterializedExport = {
  csv: string;
  rowCount: number;
  asOf: string;
  complete: boolean;
};

/**
 * 执行导出计划并装配 CSV。与分析执行服务复用同一指标计划、结果计算与序数维度排序——
 * 三处出口（文本/预览/CSV）同数同序。列头与预览卡片共用规范化成员名。
 *
 * 触顶导出上限即置 complete=false：引擎上限无法多取探测，完整性不可确认，
 * 由应用服务拒绝交付。
 */
export async function runExport(
  cube: CubeGateway,
  plan: MetricQueryPlan,
  securityContext: CubeSecurityContext,
): Promise<MaterializedExport> {
  const cap = EXPORT_MAX_ROWS;
  const views = await cube.meta(securityContext);
  const bounded = await executeBoundedMetricQuery(cube, plan, securityContext, views, cap);
  const res = bounded.load;
  const memberKeys = res.data.length ? Object.keys(res.data[0]) : metricOutputMembers(plan);
  const titles = new Map(
    [...Object.entries(res.annotation.measures), ...Object.entries(res.annotation.dimensions)].map(
      ([name, a]) => [name, memberDisplayTitle(views, name, a.title)],
    ),
  );
  const records = applyValueOrder(
    res.data,
    { dimensions: plan.dimensions, order: plan.order },
    views,
  );
  const delivered = records.slice(0, cap);
  const columns = memberKeys.map((k) => titles.get(k) ?? k);
  const rows = delivered.map((r) =>
    memberKeys.map((k) => (r[k] ?? null) as string | number | null),
  );
  const asOf = await cube
    .timeContext()
    .then((context) => context.dataAsOf)
    .catch(() => "unknown");
  return {
    csv: toCsv(columns, rows),
    rowCount: rows.length,
    asOf,
    complete: bounded.complete,
  };
}

/** RFC 4180 CSV；UTF-8 BOM 供 Excel 直开中文 */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const escapeCsv = (v: string | number | null): string => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const bom = "\uFEFF";
  return `${bom}${[columns, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}
