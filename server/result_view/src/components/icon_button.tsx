import type { ReactNode } from "react";

/**
 * 内容区里的图标按钮：28px 方形点击区域、基础圆角（应用外框上的图标按钮更大且是正圆，不用这个组件）。
 * 本包不依赖控制台，外观须与控制台内容区的图标按钮保持一致。位置由调用方包一层定位元素决定。
 */
export function IconButton({
  label,
  onClick,
  children,
}: {
  /** 按钮没有文字，必须提供可访问名称 */
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-pa-muted hover:bg-pa-surface hover:text-pa-fg pa-focus [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
