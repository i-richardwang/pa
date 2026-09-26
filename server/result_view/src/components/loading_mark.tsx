import type { CSSProperties } from "react";

export type LoadingMarkSize = "default" | "small";

const BAR: Record<LoadingMarkSize, { width: number; height: number; gap: number; radius: number }> =
  {
    default: { width: 3, height: 18, gap: 3, radius: 3 },
    small: { width: 2, height: 11, gap: 2, radius: 2 },
  };

/** 深色模式由 `--pa-fg` 变量自动切换。 */
const INK = "color-mix(in srgb, var(--pa-fg) 20%, transparent)";

const DELAYS = ["-0.1s", "-0.2s", "-0.3s", "-0.4s"] as const;

type LoadingMarkProps = {
  /** 空间较小时（看板瓦片、行内）用 `small`。 */
  size?: LoadingMarkSize;
  /** 由宿主指定区域尺寸（如 `py-16`、`h-64`、`min-h-svh`），组件本身不设高度。 */
  className?: string;
} & (
  | {
      /** 放在自带可访问名称的元素里（如按钮的 loading 态）：不作为状态区域，颜色继承宿主。 */
      decorative: true;
      /** 装饰模式不设 label：宿主已有可访问名称，再设会被读屏器读两遍。 */
      label?: never;
    }
  | {
      decorative?: false;
      /** 读屏器读出的状态名称；等待的不是普通加载时改写（如工作台预览用「正在预览」）。 */
      label?: string;
    }
);

export function LoadingMark({
  size = "default",
  label = "正在加载",
  decorative = false,
  className,
}: LoadingMarkProps) {
  const bar = BAR[size];
  const shell = ["flex h-full w-full items-center justify-center", className]
    .filter(Boolean)
    .join(" ");
  const bars = (
    <div
      className="flex items-end"
      style={{ color: decorative ? "currentColor" : INK, gap: bar.gap, height: bar.height }}
    >
      {DELAYS.map((delay) => (
        <span
          className="pa-loader-bar"
          key={delay}
          style={
            {
              animationDelay: delay,
              borderRadius: bar.radius,
              height: bar.height,
              width: bar.width,
            } satisfies CSSProperties
          }
        />
      ))}
    </div>
  );

  if (decorative) {
    return (
      <div aria-hidden="true" className={shell} data-slot="loading-mark">
        {bars}
      </div>
    );
  }
  return (
    <div aria-label={label} className={shell} data-slot="loading-mark" role="status">
      {bars}
    </div>
  );
}
