
import { formatCell, formatSignedDelta } from "../../../src/presentation_core/view_format.js";
import type { TotalBand, TotalBandMetric } from "../../../src/presentation_core/view_shape.js";

const VALUE_SIZE =
  "text-[24px] @min-[224px]:text-[28px] @2xs:text-[36px] @sm:text-[48px] leading-[1.1]";

/**
 * 大数的注脚：覆盖期间与各对照差值；全部缺席时不占行。
 * 差值恒中性色——模型层没有指标方向声明，涨跌染色会把流失类指标读反。
 */
function TotalCaption({ metric }: { metric: TotalBandMetric }) {
  const parts = [
    ...(metric.period ? [metric.period.label] : []),
    ...metric.comparisons.map(
      (comparison) =>
        `${comparison.label} ${formatSignedDelta(comparison.value, comparison.format, comparison.decimals)}`,
    ),
  ];
  if (!parts.length) return null;
  return <p className="text-pa-muted text-xs">{parts.join(" · ")}</p>;
}

export function Kpis({
  totals,
  fill = false,
  canOpen,
  onOpen,
}: {
  totals: TotalBand;
  /** 容器给定高度（看板瓦片）：卡面撑满并纵向居中；否则按内容高度加呼吸空间。 */
  fill?: boolean;

  canOpen?: (column: string) => boolean;
  onOpen?: (column: string) => void;
}) {
  const metrics = totals.metrics;
  const showLabels = metrics.length > 1;

  return (
    <div
      className={`flex w-full items-center gap-4 ${fill ? "h-full min-h-0 flex-1" : "py-8"}`}
    >
      {metrics.map((metric) => {
        const text = formatCell(metric.value, metric.column, metric.format, metric.decimals);
        return (
          <div
            className="@container flex min-w-0 flex-1 flex-col items-center text-center"
            key={metric.column}
          >
            {showLabels && (
              <div className="mb-2 text-pa-muted text-xs leading-4">{metric.label}</div>
            )}
            {metric.value !== null && canOpen?.(metric.column) ? (
              <button
                className={`block max-w-full cursor-pointer truncate rounded-sm tabular-nums underline-offset-4 hover:text-pa-accent hover:underline focus-visible:text-pa-accent focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pa-accent ${VALUE_SIZE}`}
                onClick={() => onOpen?.(metric.column)}
                type="button"
              >
                {text}
              </button>
            ) : (
              <div className={`max-w-full truncate tabular-nums ${VALUE_SIZE}`}>{text}</div>
            )}
            <div className="mt-2">
              <TotalCaption metric={metric} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
