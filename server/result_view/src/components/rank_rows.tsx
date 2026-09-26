import { RANK_ROW, themedColor } from "../../../src/presentation_core/chart_config.js";
import type { ViewChart } from "../../../src/presentation_core/chart_config.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";

type RankRow = { label: string; value: number | null; share: number | null };

/** 把类目、唯一系列的值和占比按行组合；条形长度在渲染时按最大值归一化。 */
function rankRows(chart: ViewChart): RankRow[] {
  const { categories, legend, share } = chart.model;
  return categories.map((label, i) => ({
    label,
    value: legend[0]?.values[i] ?? null,
    share: share?.values[i] ?? null,
  }));
}

export function RankRows({
  chart,
  dark,
  onPointClick,
  canOpenPoint,
}: {
  chart: ViewChart;
  dark: boolean;
  onPointClick?: (point: { row: number; column: string }) => void;
  /** 该数据点能否查看明细，决定是否显示为可点击；不传时有明细定义即可点击。 */
  canOpenPoint?: (point: { row: number; column: string }) => boolean;
}) {
  const rows = rankRows(chart);
  const lead = chart.model.legend[0];
  const format = lead?.format ?? "number";
  const decimals = lead?.decimals;
  const color = themedColor(lead?.color ?? "", dark);
  const widest = rows.reduce((max, row) => Math.max(max, Math.abs(row.value ?? 0)), 0);
  const points = chart.model.records?.points[0] ?? [];

  return (
    <div className="h-full overflow-y-auto px-4">
      {rows.map((row, i) => {
        const point = points[i];
        const openable = point && onPointClick && (canOpenPoint?.(point) ?? true);
        const value = row.value === null ? "—" : formatSeriesValue(row.value, format, decimals);
        return (
          <div
            className="flex items-center border-pa-line border-t first:border-t-0"
            key={`${row.label}-${i}`}
            style={{ height: RANK_ROW.height }}
          >
            <span
              className="shrink-0 truncate pr-3 text-sm text-pa-fg"
              style={{ width: RANK_ROW.labelColumn }}
              title={row.label}
            >
              {row.label}
            </span>
            {/* 条形只作展示，可点击的是右侧数值 */}
            <span className="min-w-0 flex-1">
              <span
                aria-hidden="true"
                className="block"
                style={{
                  background: color,
                  borderRadius: RANK_ROW.radius,
                  height: RANK_ROW.bar,
                  width: widest > 0 ? `${(Math.abs(row.value ?? 0) / widest) * 100}%` : 0,
                }}
              />
            </span>
            {openable && point ? (
              <button
                className="shrink-0 cursor-pointer rounded-sm border-0 bg-transparent pl-3 text-right text-pa-fg text-sm tabular-nums underline-offset-2 hover:underline pa-focus"
                onClick={() => onPointClick?.(point)}
                style={{ width: RANK_ROW.valueColumn }}
                type="button"
              >
                {value}
              </button>
            ) : (
              <span
                className="shrink-0 pl-3 text-right text-pa-muted text-sm tabular-nums"
                style={{ width: RANK_ROW.valueColumn }}
              >
                {value}
              </span>
            )}
            {chart.model.share ? (
              <span
                className="shrink-0 pl-2 text-right text-sm text-pa-faint tabular-nums"
                style={{ width: RANK_ROW.shareColumn }}
              >
                {row.share === null ? "" : formatSeriesValue(row.share, "percent")}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
