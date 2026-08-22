/**
 * 呈现层测试的结果块夹具：给列名与行就得到一个 ViewBlock。
 * 列角色缺省按名推：year/month 是时间，全数值列是度量，其余是维度；要改就显式给 roles。
 */
import type { ColumnFormat, ViewBlock } from "../semantic_core/query_payload.js";

export type Cell = string | number | null;

export function viewBlock(
  columns: string[],
  rows: Cell[][],
  extras: {
    formats?: Record<string, ColumnFormat>;
    shares?: ViewBlock["structure_shares"];
    roles?: ViewBlock["column_roles"];
    summary?: ViewBlock["summary"];
    decimals?: Record<string, number>;
    queryNotes?: ViewBlock["query_notes"];
  } = {},
): ViewBlock {
  const defaultRoles = Object.fromEntries(
    columns.map((column, index) => {
      if (column === "year" || column === "month") return [column, "time"];
      const values = rows.map((row) => row[index]).filter((value) => value !== null);
      return [
        column,
        values.length && values.every((value) => Number.isFinite(Number(value)))
          ? "measure"
          : "dimension",
      ];
    }),
  ) as ViewBlock["column_roles"];
  return {
    id: "result",
    columns,
    column_roles: extras.roles ?? defaultRoles,
    rows,
    row_count: rows.length,
    query_notes: extras.queryNotes ?? [],
    ...(extras.formats ? { column_formats: extras.formats } : {}),
    ...(extras.decimals ? { column_decimals: extras.decimals } : {}),
    ...(extras.shares ? { structure_shares: extras.shares } : {}),
    ...(extras.summary ? { summary: extras.summary } : {}),
  };
}
