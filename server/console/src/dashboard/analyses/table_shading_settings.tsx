/**
 * 表格配色的设置件：行里是一块色带预览（色阶 + 阈值刻点 + 读数），点开是同一张浮层
 * 里的三样东西——色阶族（单色 / 双向）与该族的取值、阈值三格、翻转。色带样片的颜色出自
 * 编译层 `shadingStops`，与结果格用的是同一份取值；读数与占位是当前结果的数据缺省
 * （`tableShadingDefaults`），阈值留空即落在那里。率族指标的阈值按表里印出来的百分数读写，
 * 存回声明时换回 0–1 标度。
 */
import { ArrowDownUpIcon } from "lucide-react";
import { DIVERGING_PALETTES, SERIES_COLORS, shadingStops } from "@charts";
import { formatCell, isRateFormat } from "@format";
import type { TableShadingDefaults } from "@shape";
import { SHADING_PALETTE_NAMES, type TableShadingPreferences } from "@view-preferences";
import { Button } from "@/components/ui/button";
import { ColorPill } from "@/components/ui/color-pill";
import { ColorScale, ColorScaleStop, ColorScaleTick } from "@/components/ui/color-scale";
import { Input } from "@/components/ui/input";
import { InspectorSettingTitle } from "@/components/ui/inspector";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

const THRESHOLD_LABELS = { min: "下限", mid: "中点", max: "上限" } as const;
type ThresholdKey = keyof typeof THRESHOLD_LABELS;
const UNIT = { percent: "%", percentage_point: "pp", number: "" } as const;

const FAMILY_TILE =
  "flex cursor-pointer items-center rounded-md border border-pa-line p-3 outline-none transition-colors duration-150 hover:border-pa-line-hover focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring aria-pressed:border-pa-focus-strong";
const DIVERGING_TILE =
  "flex cursor-pointer items-center rounded-xl border border-pa-line p-1 outline-none transition-colors duration-150 hover:border-pa-line-hover focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring aria-pressed:border-pa-focus-strong";

function divergingNameOf(palette: string) {
  return SHADING_PALETTE_NAMES.find((name) => name === palette);
}

export function TableShadingSettings({
  shading,
  defaults,
  onChange,
}: {
  shading: TableShadingPreferences;
  /** 当前结果的数据缺省刻度；无结果时为 null，读数退回两端的名字。 */
  defaults: TableShadingDefaults | null;
  onChange: (patch: Partial<TableShadingPreferences>) => void;
}) {
  const diverging = divergingNameOf(shading.palette);
  const flipped = !!shading.flipped;
  const stops = shadingStops(shading.palette, flipped, false);
  const keys: ThresholdKey[] = diverging ? ["min", "mid", "max"] : ["min", "max"];
  const format = defaults?.format ?? "number";
  const decimals = defaults?.decimals;
  const rate = isRateFormat(format);
  const scale = rate ? 100 : 1;
  const unit = UNIT[format];
  const readout = (key: ThresholdKey) => {
    const value = shading.thresholds?.[key] ?? defaults?.scale[key];
    return value === undefined ? THRESHOLD_LABELS[key] : formatCell(value, "", format, decimals);
  };
  const plain = (value: number | undefined) =>
    value === undefined ? "" : String(Number((value * scale).toFixed(decimals ?? 1)));
  const setThreshold = (key: ThresholdKey, raw: string) => {
    const thresholds = { ...shading.thresholds };
    const value = raw.trim() === "" ? Number.NaN : Number(raw) / scale;
    if (Number.isFinite(value)) thresholds[key] = value;
    else delete thresholds[key];
    onChange({ thresholds: Object.keys(thresholds).length ? thresholds : undefined });
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label="配色"
        className="w-40 cursor-pointer rounded-md p-2 pb-1 text-left outline-none hover:bg-pa-surface focus-visible:ring-[3px] focus-visible:ring-pa-focus-ring"
      >
        <span className="relative block">
          <ColorScale outlined stops={stops} />
          <span className="absolute top-1 flex w-full justify-between px-1">
            {keys.map((key) => (
              <ColorScaleTick key={key} />
            ))}
          </span>
        </span>
        <span className="grid min-h-5 auto-cols-fr grid-flow-col px-0.5 pt-0.5 text-2xs text-pa-faint tabular-nums">
          {keys.map((key) => (
            <span className="truncate text-center first:text-left last:text-right" key={key}>
              {readout(key)}
            </span>
          ))}
        </span>
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-[248px] p-1.5" data-slot="table-shading-settings">
        <InspectorSettingTitle>颜色</InspectorSettingTitle>
        <div className="flex justify-center gap-2 py-2">
          <button
            aria-label="单色深浅"
            aria-pressed={!diverging}
            className={FAMILY_TILE}
            onClick={() => {
              if (diverging) onChange({ palette: SERIES_COLORS[0] });
            }}
            type="button"
          >
            <ColorScale
              className="size-6 rounded-sm"
              stops={shadingStops(SERIES_COLORS[0], flipped, false)}
            />
          </button>
          <button
            aria-label="双向色阶"
            aria-pressed={!!diverging}
            className={FAMILY_TILE}
            onClick={() => {
              if (!diverging) onChange({ palette: SHADING_PALETTE_NAMES[0] });
            }}
            type="button"
          >
            <ColorScale
              className="size-6 rounded-sm"
              stops={shadingStops(SHADING_PALETTE_NAMES[0], flipped, false)}
            />
          </button>
        </div>
        {diverging ? (
          <div className="flex justify-center gap-2 py-2.5">
            {SHADING_PALETTE_NAMES.map((name) => (
              <button
                aria-label={DIVERGING_PALETTES[name].label}
                aria-pressed={name === shading.palette}
                className={DIVERGING_TILE}
                key={name}
                onClick={() => onChange({ palette: name })}
                type="button"
              >
                <ColorScale className="h-3 w-7" stops={shadingStops(name, flipped, false)} />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex justify-center gap-1.5 py-2">
            {SERIES_COLORS.map((color) => (
              <ColorPill
                aria-label={color}
                color={color}
                key={color}
                onClick={() => onChange({ palette: color })}
                selected={color === shading.palette}
                size="sm"
              />
            ))}
          </div>
        )}
        <div className="-mx-1.5 my-3">
          <Separator />
        </div>
        <InspectorSettingTitle>阈值</InspectorSettingTitle>
        <div className="mx-4 mt-2 mb-4 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="翻转色阶"
                  aria-pressed={flipped}
                  onClick={() => onChange({ flipped: flipped ? undefined : true })}
                  size="icon-sm"
                  variant="subtle"
                />
              }
            >
              <ArrowDownUpIcon />
            </TooltipTrigger>
            <TooltipPopup>翻转色阶</TooltipPopup>
          </Tooltip>
          <div className="relative">
            <div className="absolute top-0 bottom-0 flex w-4 flex-col justify-between">
              {[...stops].reverse().map((color, index) => (
                <ColorScaleStop color={color} key={`${index}:${color}`} />
              ))}
            </div>
            <div className="px-1.5 py-3">
              <ColorScale className={diverging ? "h-21" : "h-9.5"} stops={stops} vertical />
            </div>
          </div>
          <div className="flex flex-col gap-y-3">
            {[...keys].reverse().map((key) => (
              <div className="flex min-h-8 items-center gap-2" key={key}>
                <span aria-hidden="true" className="h-px w-8 bg-pa-line" />
                <span className="relative">
                  <Input
                    aria-label={`着色${THRESHOLD_LABELS[key]}`}
                    className={unit ? "w-20 pr-7" : "w-20"}
                    defaultValue={plain(shading.thresholds?.[key])}
                    inputMode="decimal"
                    key={`${key}:${shading.thresholds?.[key] ?? ""}`}
                    onBlur={(event) => setThreshold(key, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    placeholder={plain(defaults?.scale[key])}
                    size="sm"
                  />
                  {unit ? (
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-pa-faint">
                      {unit}
                    </span>
                  ) : null}
                </span>
                <span className="w-16 text-sm text-pa-muted">{THRESHOLD_LABELS[key]}</span>
              </div>
            ))}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
