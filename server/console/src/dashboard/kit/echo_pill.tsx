import { cn } from "@/lib/utils";

const TONE_CLASS = {
  strong:
    "inline-flex max-w-full items-center rounded-sm bg-pa-selected px-2 font-medium text-pa-ink text-sm leading-6",
  muted:
    "inline-flex max-w-full items-center rounded-sm bg-pa-surface px-2 font-medium text-pa-muted text-sm leading-6",
} as const;

export function EchoPill({
  label,
  tone = "strong",
  onClick,
}: {
  label: string;
  tone?: keyof typeof TONE_CLASS;
  onClick?: () => void;
}) {
  const shape = TONE_CLASS[tone];
  if (!onClick) {
    return <span className={cn(shape, "pointer-events-none")}>{label}</span>;
  }
  return (
    <button type="button" className={cn(shape, "pa-focus cursor-pointer")} onClick={onClick}>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
