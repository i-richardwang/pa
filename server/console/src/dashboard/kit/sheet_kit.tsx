import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use_copy_text";
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

export function IdentityCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): React.ReactElement {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <section
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border p-6",
        className,
      )}
    >
      <h4 className="font-medium text-pa-muted text-sm">{label}</h4>
      <span className="inline-flex min-w-0 items-center gap-1">
        <code className="break-all font-mono text-pa-muted text-xs">{value}</code>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`复制${label}`}
                onClick={() => copyToClipboard(value)}
                size="icon-xs"
                variant="subtle"
              />
            }
          >
            {isCopied ? <CheckIcon /> : <CopyIcon />}
          </TooltipTrigger>
          <TooltipPopup>
            <p>复制到剪贴板</p>
          </TooltipPopup>
        </Tooltip>
      </span>
    </section>
  );
}
