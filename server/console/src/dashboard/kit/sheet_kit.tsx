import { cn } from "@/lib/utils";

export function SheetSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cn("flex flex-col gap-2 rounded-md border border-pa-line p-6", className)}>
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
