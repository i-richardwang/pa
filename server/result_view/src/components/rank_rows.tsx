import { RANK_ROW, themedColor } from "../../../src/presentation_core/chart_config.js";
import type { ViewChart } from "../../../src/presentation_core/chart_config.js";
import { formatSeriesValue } from "../../../src/presentation_core/view_format.js";

type RankRow = { label: string; value: number | null; share: number | null };

/** 模型里的类目、唯一那条系列的取值与占比按行拼起来；条长的归一在渲染时按最大值算 */
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
  /** 该格能不能开明细：不能开就不画成可点的样子，缺省即有投影就能开。 */
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
    // 框内再内缩一圈：分隔线与末列的数都不该贴到框缘上
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
            {/* 条只是形：可点的是值那一格，条不认领语义 */}
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
            {/* 值那一格：可下钻时它本身就是一个按钮，不用 role/tabIndex/keydown 手搭一个出来 */}
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
