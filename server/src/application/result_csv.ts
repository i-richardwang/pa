import { toCsv, type MaterializedExport } from "../engine/export.js";
import { makeTitleOf } from "../presentation_core/view_shape.js";
import {
  observationStatus,
  type ObservationPeriod,
  type ViewBlock,
} from "../semantic_core/query_payload.js";

function requestedMonth(view: ViewBlock, row: ViewBlock["rows"][number]): string | undefined {
  const year = row[view.columns.indexOf("year")];
  const month = row[view.columns.indexOf("month")];
  return typeof year === "number" || typeof year === "string"
    ? `${year}${month == null ? "" : `-${String(month).padStart(2, "0")}`}`
    : undefined;
}

export function materializeResultCsv(view: ViewBlock, asOf: string): MaterializedExport {
  const titleOf = makeTitleOf(view);
  const title = view.columns.map(titleOf);
  const clocks = new Map<string, ObservationPeriod[]>();
  if (!view.observation_axis) {
    for (const period of view.observations ?? []) {
      const label = period.columns?.map(titleOf).join("、") ?? "";
      const key = JSON.stringify(period.columns ?? []);
      let series = clocks.get(key);
      if (!series) {
        series = [];
        clocks.set(key, series);
        for (const field of ["请求期间或期次", "实际期次", "观测日期", "投放状态"]) {
          title.push(label ? `${label} · ${field}` : field);
        }
      }
      series.push(period);
    }
  }
  const rows = view.rows.map((row) => {
    const month = requestedMonth(view, row);
    return [
      ...row,
      ...[...clocks.values()].flatMap((periods) => {
        const period = month
          ? periods.find((item) => item.requested?.to.startsWith(month))
          : periods[0];
        const requested = period?.requested;
        return [
          period?.requested_date ??
            period?.requested_id ??
            (requested && requested.from !== requested.to
              ? `${requested.from} 至 ${requested.to}`
              : requested?.to) ??
            null,
          period?.occurrence?.id ?? null,
          period?.occurrence?.date ?? null,
          period ? observationStatus(period) : null,
        ];
      }),
    ];
  });
  return {
    csv: toCsv(title, rows),
    rowCount: rows.length,
    asOf,
    complete: !view.has_more,
  };
}
