import type { CSSProperties } from "react";

export type LoadingMarkSize = "default" | "small";

const BAR: Record<LoadingMarkSize, { width: number; height: number; gap: number; radius: number }> =
  {
    default: { width: 3, height: 18, gap: 3, radius: 3 },
    small: { width: 2, height: 11, gap: 2, radius: 2 },
  };

/** 深浅两套由 `--pa-fg` 自己翻面。 */
const INK = "color-mix(in srgb, var(--pa-fg) 20%, transparent)";

const DELAYS = ["-0.1s", "-0.2s", "-0.3s", "-0.4s"] as const;

type LoadingMarkProps = {
  /** 窄场地（看板瓦片、行内）用 `small`。 */
  size?: LoadingMarkSize;
  /** 宿主给的场地尺寸（`py-16`、`h-64`、`min-h-svh`）；本件自己不定高。 */
  className?: string;
} & (
  | {
      /** 住在会说话的宿主里（钮的 loading 态）：不认领状态区、字色随宿主。 */
      decorative: true;
      /** 装饰档没有名字可挂：宿主自己会念，这里再挂就是念第二遍。 */
      label?: never;
    }
  | {
      decorative?: false;
      /** 状态区读给读屏的名字：等的是别的事情时改写（工作台预览＝「正在预览」）。 */
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

  // 装饰档与状态档是两种语义，各自写全一套：读屏器读到的是元素身份，不是一组条件属性。
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
