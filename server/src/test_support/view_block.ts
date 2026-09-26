/** 未传 roles 时按列推断角色：year/month 为时间，全为数值的列为度量，其余为维度。 */
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
