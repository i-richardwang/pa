import { useState } from "react";
import { XIcon } from "lucide-react";
import type { TimeIntent } from "@time";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { TimeEditor } from "../analyses/time_editor";

const DEFAULT_OVERRIDE: TimeIntent = {
  window: { kind: "trailing", count: 12, unit: "month" },
};

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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimeIntent>(DEFAULT_OVERRIDE);

  if (time) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="board-time-override">
        <TimeEditor dataAsOf={dataAsOf} onChange={onChange} time={time} />
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
      <Popover
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft(DEFAULT_OVERRIDE);
        }}
        open={open}
      >
        <PopoverTrigger render={<Button variant="subtle" />}>设置板级时间</PopoverTrigger>
        <PopoverPopup className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <TimeEditor dataAsOf={dataAsOf} onChange={setDraft} time={draft} />
            <Button
              variant="filled"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              应用
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
