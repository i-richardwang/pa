import { cn } from "@/lib/utils";

export function SheetSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  /** 节标题行右侧的动作（如复制按钮）；无标题时不渲染标题行 */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cn("flex flex-col gap-2 rounded-md border p-6", className)}>
      {title && (
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-pa-muted text-sm">{title}</h4>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
