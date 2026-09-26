import { XIcon } from "lucide-react";
import type { TimeIntent } from "@time";
import { Button } from "@/components/ui/button";
import { DEFAULT_TIME_WINDOW } from "../analyses/analysis_draft";
import { TimeBar } from "../analyses/time_editor";

export function BoardTimeOverride({
  time,
  editing = false,
  onChange,
  dataAsOf,
}: {
  time: TimeIntent | null;
  editing?: boolean;
  onChange: (time: TimeIntent | null) => void;
  dataAsOf: string;
}) {
  if (time) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="board-time-override">
        <TimeBar dataAsOf={dataAsOf} onChange={onChange} time={time} />
        <Button
          aria-label="清除看板时间"
          size="icon-sm"
          variant="subtle"
          onClick={() => onChange(null)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (!editing) return null;

  return (
    <div data-testid="board-time-override">
      <Button
        onClick={() => onChange({ window: DEFAULT_TIME_WINDOW.trailing_months })}
        variant="subtle"
      >
        设置看板时间
      </Button>
    </div>
  );
}
