import type { ReactNode } from "react";

/**
 * 图标钮：内容里的那一档——28 的方命中区配基准圆角（壳那一圈的钮更大、且是整圆，不在此列）。
 * 静息二级字、悬停浮一层薄底，与结果面里其余可点件同一套色。
 *
 * 位置归调用方：钮自己不认识「右上角」，外面套一层定位块即可，故这一档不因摆在哪儿而分身。
 * 结果视图自成一包（控制台引它，它不引控制台），这一档因此在此另存一份，与控制台的内容档同形。
 */
export function IconButton({
  label,
  onClick,
  children,
}: {
  /** 无字可读，故必须给名字 */
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-pa-muted outline-none hover:bg-pa-surface hover:text-pa-fg focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
