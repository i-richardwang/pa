import { XIcon } from "lucide-react";
import type { ReadoutModel, ReadoutRow } from "../readout.js";
import { IconButton } from "./icon_button.js";
import { chartMarkerClass, themedColor } from "../../../src/presentation_core/chart_config.js";

/**
 * 读数卡：指针落在哪一格，这张卡就读哪一格。壳与菜单、Popover 同一张（`.pa-popup-surface`），
 * 模糊换到卡那一档（`.pa-popup-surface-card`，缘由见 tokens.css）。
 *
 * 单系列以值为主、系列名为次：只有一个数时先读数，再读它是什么。多系列走「色点 / 名 / 值」
 * 三栏，一栏排到 17 行才另起一栏、至多四栏，栏宽随栏数成档——否则一条长清单会顶穿画布。
 *
 * 卡内不标「指针在哪一根」：那件事由画布的指针（列高亮带或竖虚线）与激活点交代，卡片只管读数。
 * 未钉住时整张卡不可命中（指针要能穿过它继续读图），钉住后才接管悬停与点击。
 */

const COLUMN_TIERS = [
  "min-w-[200px] max-w-[300px]",
  "min-w-[400px] max-w-[500px]",
  "min-w-[600px] max-w-[700px]",
  "min-w-[800px] max-w-[900px]",
] as const;
const ROWS_PER_COLUMN = 17;
const COLUMN_GRID = ["", "grid grid-cols-2 gap-x-4", "grid grid-cols-3 gap-x-4", "grid grid-cols-4 gap-x-4"];

function columnCount(rows: number): number {
  return Math.min(COLUMN_TIERS.length, Math.max(1, Math.ceil(rows / ROWS_PER_COLUMN)));
}

function Marker({ color, span, sole }: { color?: string; span: number; sole: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={chartMarkerClass(sole ? "lead" : "row")}
      style={{ gridRow: `span ${span}`, ...(color ? { backgroundColor: color } : {}) }}
    />
  );
}

/** 副读数：占比与对照差值同占值下方那一行，与主值同一档中性色。 */
function subReadings(row: ReadoutRow): string[] {
  return [row.secondary, row.delta].filter((text): text is string => text !== undefined);
}

function SoleRow({ row }: { row: ReadoutRow }) {
  const subs = subReadings(row);
  return (
    <div className="grid grid-cols-[12px_auto] gap-x-1.5 gap-y-0.5 py-1">
      <Marker color={row.color} span={2 + subs.length} sole />
      <span title={row.value} className="truncate font-medium text-lg text-pa-fg tabular-nums">
        {row.value}
      </span>
      <span className="truncate text-pa-faint text-xs">{row.name}</span>
      {subs.map((text, index) => (
        <span key={`${text}-${index}`} className="truncate text-pa-muted text-xs tabular-nums">
          {text}
        </span>
      ))}
    </div>
  );
}

function SeriesRow({ row }: { row: ReadoutRow }) {
  const subs = subReadings(row);
  return (
    <div className="grid grid-cols-[12px_1fr_min-content] gap-x-1.5 gap-y-0.5 py-1">
      <Marker color={row.color} span={1 + subs.length} sole={false} />
      <span className="truncate text-pa-muted text-xs">{row.name}</span>
      <span title={row.value} className="truncate text-right text-pa-fg text-xs tabular-nums">
        {row.value}
      </span>
      {subs.map((text, index) => (
        <span
          key={`${text}-${index}`}
          className="col-start-3 truncate text-right text-pa-muted text-xs tabular-nums"
        >
          {text}
        </span>
      ))}
    </div>
  );
}

export function ReadoutCard({
  model,
  dark,
  pinned = false,
  onClose,
  onRowHover,
  onRowClick,
}: {
  model: ReadoutModel;
  dark: boolean;
  /** 钉住：卡片接管命中，行可悬停可点，角上出关闭钮 */
  pinned?: boolean;
  onClose?: () => void;
  onRowHover?: (series: number | null) => void;
  onRowClick?: (point: { row: number; column: string }) => void;
}) {
  const columns = columnCount(model.rows.length);
  const sole = model.rows.length === 1;
  const rows = model.rows.map((row) => ({
    ...row,
    color: row.color ? themedColor(row.color, dark) : undefined,
  }));
  return (
    <div
      className={`pa-popup-surface pa-popup-surface-card relative flex flex-col overflow-hidden ${COLUMN_TIERS[columns - 1]}`}
    >
      {pinned && onClose && (
        <div className="absolute top-1.5 right-1.5">
          <IconButton label="关闭读数卡" onClick={onClose}>
            <XIcon />
          </IconButton>
        </div>
      )}
      {/* 抬头给关闭钮让出右上角那一块，否则钉住时长标题压在钮下面 */}
      {model.header && (
        <div className="mr-5 truncate px-4 pt-3 pb-0.5 text-pa-fg text-sm">{model.header}</div>
      )}
      <div className={`px-4 py-2 ${COLUMN_GRID[columns - 1]}`.trim()}>
        {rows.map((row, index) => {
          const point = row.point;
          // 未钉住时整张卡不可命中，行也就不该画成可点的样子
          const open = pinned && point && onRowClick ? () => onRowClick(point) : undefined;
          return (
            <div
              key={`${row.name}-${index}`}
              className={open ? "cursor-pointer rounded-md hover:bg-pa-wash" : undefined}
              onMouseEnter={() => onRowHover?.(row.series ?? null)}
              onMouseLeave={() => onRowHover?.(null)}
              onClick={open}
            >
              {sole ? <SoleRow row={row} /> : <SeriesRow row={row} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
