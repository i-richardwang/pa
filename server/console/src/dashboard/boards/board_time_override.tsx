import { XIcon } from "lucide-react";
import type { TimeIntent } from "@time";
import { Button } from "@/components/ui/button";
import { DEFAULT_TIME_WINDOW } from "../analyses/analysis_draft";
import { TimeBar } from "../analyses/time_editor";

/**
 * 看板级时间覆盖：有覆盖时就是一条时间栏加一枚清除钮，每一次改动即刻落到看板；
 * 还没有覆盖时，编辑态给一枚入口，点下即以默认窗口开启覆盖，再在栏上调。
 */
export function BoardTimeOverride({
  time,
  editing = false,
  onChange,
  dataAsOf,
}: {
  time: TimeIntent | null;
  /** 编辑态才提供设置入口；查看态仅在覆盖生效时显示。 */
  editing?: boolean;
  onChange: (time: TimeIntent | null) => void;
  dataAsOf: string;
}) {
  if (time) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="board-time-override">
        <TimeBar dataAsOf={dataAsOf} onChange={onChange} time={time} />
        <Button
          aria-label="清除时间覆盖"
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
        设置板级时间
      </Button>
    </div>
  );
}
