import { formatCell, formatSignedDelta } from "../../../src/presentation_core/view_format.js";
import type { TotalBand, TotalBandMetric } from "../../../src/presentation_core/view_shape.js";
import { VIEW_SCENES, type ViewScene } from "../scene.js";

const VALUE_SIZE =
  "text-[24px] @min-[224px]:text-[28px] @2xs:text-[36px] @sm:text-[48px] leading-[1.1]";

/** 指标卡数值下方的说明：覆盖期间和各对照期差值；都没有时不渲染。 */
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
  scene,
  canOpen,
  onOpen,
}: {
  totals: TotalBand;
  /** fill 场景撑满容器高度并垂直居中；结果卡按内容高度加上下留白。 */
  scene: ViewScene;
  canOpen?: (column: string) => boolean;
  onOpen?: (column: string) => void;
}) {
  const { fill } = VIEW_SCENES[scene];
  const metrics = totals.metrics;
  const showLabels = metrics.length > 1;

  return (
    <div className={`flex w-full items-center gap-4 ${fill ? "h-full min-h-0 flex-1" : "py-8"}`}>
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
                className={`block max-w-full cursor-pointer truncate rounded-sm tabular-nums underline-offset-4 hover:text-pa-accent hover:underline focus-visible:text-pa-accent focus-visible:underline pa-focus ${VALUE_SIZE}`}
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
