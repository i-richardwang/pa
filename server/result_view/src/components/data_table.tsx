import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, EllipsisIcon } from "lucide-react";
import { compareCells, formatCell } from "../../../src/presentation_core/view_format.js";
import { shadeCell, type TableShading } from "../../../src/presentation_core/table_shading.js";
import type { TableColumn, TableModel } from "../../../src/presentation_core/view_shape.js";
import { observeElementSize } from "../element_size.js";
import { VIEW_SCENES, type ViewScene } from "../scene.js";
import { useDarkTheme } from "../use_dark_theme.js";
import { PlotSlab } from "./plot_slab.js";

export const INLINE_ROWS = 8;

/** 表头单行高度（px），须与 `headCell` 的 `h-8` 一致；作为总计行吸顶偏移的初值，挂载后改用实测高度。 */
const HEAD_ROW_HEIGHT = 32;
/** 文本单元格的最大宽度（px），超出时截断，悬停时显示展开按钮。 */
const TEXT_CELL_MAX_WIDTH = 780;

const headCell =
  "h-8 border-pa-line border-b bg-pa-bg px-1 text-left align-middle font-normal text-xs";
const cellText = "whitespace-nowrap font-normal";
const frozenCell = "sticky left-0 z-[1] bg-pa-bg group-hover:bg-pa-wash-solid";
const EMPTY_CELL = <span className="text-pa-faint">—</span>;
/**
 * 总计行和分组边界只用单边 border 工具类：同一元素上有两个 border-color 工具类时，生效的是样式表中
 * 后生成的那个，与 className 里的书写顺序无关。
 */
const groupEdge = "border-l border-l-pa-line";
const shadeText = { ink: "text-pa-ink", inverse: "text-pa-ink-fg" } as const;

function ShadeChip({
  value,
  formatKey,
  shading,
  dark,
  children,
}: {
  value: string | number | null;
  formatKey: string;
  shading: TableShading;
  dark: boolean;
  children: React.ReactNode;
}) {
  const shade = shadeCell(value, formatKey, shading, dark);
  if (!shade) return children;
  return (
    <div
      className={`-mx-1.5 -my-1.5 rounded-sm px-1.5 py-1.5 ${shadeText[shade.foreground]} ${
        shading.values ? "" : "text-transparent select-none"
      }`}
      data-slot="shade-chip"
      style={{ backgroundColor: shade.background }}
    >
      {children}
    </div>
  );
}

type HeaderCell = {
  key: string;
  label: string;
  start: number;
  colSpan: number;
  rowSpan: number;
  leaf: boolean;
};

export type TableSort = { column: number; columnKey: string; dir: 1 | -1 };

const tableColumnKey = (column: TableColumn): string =>
  JSON.stringify([column.formatKey, column.headerPath.map(({ key }) => key)]);

/** 切换模型后，只有原下标仍指向同一列时才保留排序；新模型首次渲染时就丢弃失效的排序。 */
export function resolveTableSort(sort: TableSort | null, columns: TableColumn[]): TableSort | null {
  if (!sort) return null;
  const column = columns[sort.column];
  return column && tableColumnKey(column) === sort.columnKey ? sort : null;
}

/** 把相邻列 headerPath 的共同前缀合并成多层表头的单元格。 */
function tableHeaderRows(columns: TableColumn[]): HeaderCell[][] {
  const depth = Math.max(1, ...columns.map((column) => column.headerPath.length));
  const rows = Array.from({ length: depth }, () => [] as HeaderCell[]);
  columns.forEach((column, columnIndex) => {
    const path = column.headerPath;
    path.forEach((part, level) => {
      const leaf = level === path.length - 1;
      const key = JSON.stringify(path.slice(0, level + 1).map((candidate) => candidate.key));
      const rowSpan = leaf ? depth - level : 1;
      const open = rows[level].at(-1);
      if (
        open &&
        !leaf &&
        !open.leaf &&
        open.key === key &&
        open.start + open.colSpan === columnIndex
      ) {
        open.colSpan += 1;
      } else {
        rows[level].push({ key, label: part.label, start: columnIndex, colSpan: 1, rowSpan, leaf });
      }
    });
  });
  return rows;
}

export function DataTable({
  model,
  scene,
  allRows,
  canOpenCell,
  onOpenCell,
}: {
  model: TableModel;
  scene: ViewScene;
  /** 为 true 时渲染全部行，否则只渲染前 INLINE_ROWS 行；结果卡全屏查看时为 true。 */
  allRows: boolean;
  /**
   * 能否查看明细只取决于列，与单元格数值无关。
   * row 是单元格对应的原始结果行下标（经 sourceRows 映射），不是表格的显示顺序。
   */
  canOpenCell?: (row: number, column: number) => boolean;
  onOpenCell?: (row: number, column: number) => void;
}) {
  const dark = useDarkTheme();
  const traits = VIEW_SCENES[scene];
  const { fill } = traits;
  const [sort, setSort] = useState<TableSort | null>(null);
  const activeSort = resolveTableSort(sort, model.columns);
  const columnSchemaKey = JSON.stringify(model.columns.map(tableColumnKey));
  const headerRows = tableHeaderRows(model.columns);
  const headerDepth = headerRows.length;
  const frozen = model.columns[0] ? !model.columns[0].numeric : false;
  const bodyCell = `${cellText} ${traits.cellPad} border-pa-line border-b`;
  const summaryCell = `${cellText} ${traits.cellPad} border-b border-b-pa-line bg-pa-bg font-medium`;

  const headRef = useRef<HTMLTableSectionElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollableRight, setScrollableRight] = useState(false);
  const [headHeight, setHeadHeight] = useState(headerDepth * HEAD_ROW_HEIGHT);
  /** 用户已取消宽度限制的列 */
  const [uncapped, setUncapped] = useState<Set<number>>(() => new Set());
  /** 鼠标悬停且内容被截断的单元格，展开按钮只在这里显示 */
  const [expandHint, setExpandHint] = useState<{ row: number; col: number } | null>(null);
  const rows = model.rows.map((row, source) => ({ row, source }));
  if (activeSort) {
    rows.sort(
      (a, b) => compareCells(a.row[activeSort.column], b.row[activeSort.column]) * activeSort.dir,
    );
  }
  const shown = allRows ? rows : rows.slice(0, INLINE_ROWS);
  const total = `共 ${rows.length} 行`;
  const footer = shown.length < rows.length ? `已显示前 ${shown.length} 行 · ${total}` : total;

  /** 滚动、尺寸变化和模型切换后，都要重新检查右侧是否还能滚动。 */
  const probeScroll = () => {
    const node = scrollerRef.current;
    setScrollableRight(!!node && node.scrollWidth - node.clientWidth - node.scrollLeft > 1);
  };
  // observeElementSize 订阅时会立即回调一次，首次检查也在这里完成
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    return observeElementSize(node, probeScroll);
  }, [model, uncapped, fill]);

  useEffect(() => {
    const node = headRef.current;
    if (!fill || !node) return;
    return observeElementSize(node, () => setHeadHeight(node.offsetHeight));
  }, [fill]);

  const columns = model.columns;
  /** 只在列结构变化时重置排序、展开和悬停状态；模型对象换了引用但列不变时保留。 */
  useEffect(() => {
    setSort((previous) => resolveTableSort(previous, columns));
    setUncapped((previous) => (previous.size ? new Set() : previous));
    setExpandHint(null);
  }, [columnSchemaKey]);

  const toggleSort = (i: number) =>
    setSort(
      activeSort?.column === i
        ? { ...activeSort, dir: activeSort.dir === 1 ? -1 : 1 }
        : { column: i, columnKey: tableColumnKey(model.columns[i]), dir: 1 },
    );

  const uncap = (col: number) => {
    setUncapped((prev) => new Set(prev).add(col));
    setExpandHint(null);
  };

  const probeTruncation =
    (row: number, col: number, cappable: boolean) => (e: React.MouseEvent<HTMLElement>) => {
      const inner = e.currentTarget.firstElementChild;
      const truncated = cappable && !!inner && inner.scrollWidth > inner.clientWidth;
      setExpandHint((prev) => (truncated ? { row, col } : prev === null ? prev : null));
    };

  const sortHead = (col: TableColumn, i: number) => (
    <button
      type="button"
      title={col.label}
      className={`inline-flex max-w-full cursor-pointer select-none appearance-none items-center gap-1 rounded-sm border-0 px-2 py-1 font-normal text-pa-muted hover:bg-pa-surface hover:text-pa-fg ${
        activeSort?.column === i ? "bg-pa-surface text-pa-fg" : "bg-transparent"
      } ${col.numeric ? "flex-row-reverse" : ""}`}
      onClick={() => toggleSort(i)}
    >
      <span className="truncate">{col.label}</span>
      {activeSort?.column === i &&
        (activeSort.dir === 1 ? (
          <ChevronUpIcon aria-hidden="true" className="size-2.5 shrink-0" />
        ) : (
          <ChevronDownIcon aria-hidden="true" className="size-2.5 shrink-0" />
        ))}
    </button>
  );

  /** 多层表头时，在每个顶层分组的第一列左侧画分隔线，贯穿表头、总计行和明细。 */
  const edgeAt = new Set(
    headerDepth <= 1
      ? []
      : model.columns.flatMap((column, index) => {
          if (!column.numeric) return [];
          const previous = model.columns[index - 1];
          return !previous ||
            !previous.numeric ||
            previous.headerPath[0]?.key !== column.headerPath[0]?.key
            ? [index]
            : [];
        }),
  );

  /** 单元格对应的原始结果行：交叉表通过 sourceRows 映射（null 表示没有来源行），长表直接用模型行号。 */
  const sourceOf = (modelRow: number, col: number): number | null =>
    model.sourceRows ? (model.sourceRows[modelRow]?.[col] ?? null) : modelRow;

  const bodyCellContent = (
    ri: number,
    i: number,
    col: TableColumn,
    value: string | number | null,
  ) => {
    const text = value === null ? null : formatCell(value, col.formatKey, col.format, col.decimals);
    if (text === null) return EMPTY_CELL;
    if (col.numeric) {
      const cellSource = sourceOf(rows[ri].source, i);
      const content =
        cellSource !== null && canOpenCell?.(cellSource, i) ? (
          <button
            aria-label={`查看明细：${col.label} ${text ?? ""}`}
            className="block w-full cursor-pointer rounded-sm text-right underline-offset-2 hover:text-pa-accent hover:underline focus-visible:text-pa-accent focus-visible:underline pa-focus"
            onClick={() => onOpenCell?.(cellSource, i)}
            type="button"
          >
            {text}
          </button>
        ) : (
          text
        );
      return model.shading ? (
        <ShadeChip dark={dark} formatKey={col.formatKey} shading={model.shading} value={value}>
          {content}
        </ShadeChip>
      ) : (
        content
      );
    }
    return (
      <>
        <div
          className={uncapped.has(i) ? "" : "truncate"}
          style={uncapped.has(i) ? undefined : { maxWidth: TEXT_CELL_MAX_WIDTH }}
        >
          {text}
        </div>
        {expandHint?.row === ri && expandHint.col === i && (
          <button
            type="button"
            aria-label={`展开${col.label}列`}
            onClick={() => uncap(i)}
            className="-translate-y-1/2 absolute top-1/2 right-1 inline-flex cursor-pointer items-center rounded-sm border border-pa-line bg-pa-bg p-0.5 text-pa-muted hover:bg-pa-surface hover:text-pa-fg"
          >
            <EllipsisIcon aria-hidden="true" className="size-2.5" />
          </button>
        )}
      </>
    );
  };

  const summaryCellContent = (col: TableColumn, value: string | number | null): React.ReactNode =>
    value === null ? EMPTY_CELL : formatCell(value, col.formatKey, col.format, col.decimals);

  const grid = (
    <div className={`relative ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div
        className={fill ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"}
        onScroll={probeScroll}
        ref={scrollerRef}
      >
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead ref={headRef} className={fill ? "sticky top-0 z-10" : ""}>
            {headerRows.map((headerRow, level) => (
              <tr key={level}>
                {headerRow.map((cell) => {
                  const column = model.columns[cell.start];
                  return (
                    <th
                      key={`${cell.key}:${cell.start}`}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      className={`${headCell} ${cell.start === 0 && frozen ? frozenCell : ""} ${
                        edgeAt.has(cell.start) ? groupEdge : ""
                      } ${
                        cell.leaf
                          ? column.numeric
                            ? "text-right"
                            : ""
                          : "px-3 text-center font-normal text-pa-muted"
                      }`}
                    >
                      {cell.leaf ? sortHead(column, cell.start) : cell.label}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          {/* 总计行必须排在明细之前：它的吸顶偏移等于表头实际高度 */}
          {model.summaryRows?.length ? (
            <tbody
              aria-label="总体"
              className={fill ? "sticky z-10 bg-pa-bg" : ""}
              style={fill ? { top: headHeight } : undefined}
            >
              {model.summaryRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {model.columns.map((col, i) => (
                    <td
                      key={i}
                      className={`${summaryCell} ${i === 0 && frozen ? frozenCell : ""} ${
                        col.numeric ? "text-right" : ""
                      } ${edgeAt.has(i) ? groupEdge : ""}`}
                    >
                      {summaryCellContent(col, row[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : null}
          {/* 最后一行不画下边框，由下方行数栏的上边框代替 */}
          <tbody
            className="[&>tr:last-child>td]:border-b-0"
            onMouseLeave={() => setExpandHint((prev) => (prev === null ? prev : null))}
          >
            {shown.map(({ row: r, source }, ri) => (
              <tr key={source} className="group hover:bg-pa-wash">
                {model.columns.map((col, i) => (
                  <td
                    key={i}
                    className={`${bodyCell} ${
                      col.numeric
                        ? "text-right"
                        : // sticky 已是定位元素，可作展开按钮的定位参照；再加 relative 会与它冲突，
                          // 生效的取决于样式表顺序
                          `text-pa-muted ${i === 0 && frozen ? frozenCell : "relative"}`
                    } ${edgeAt.has(i) ? groupEdge : ""}`}
                    onMouseEnter={probeTruncation(ri, i, !col.numeric && !uncapped.has(i))}
                  >
                    {bodyCellContent(ri, i, col, r[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 右边缘渐隐提示，宽 40px，不遮住最后一列数字 */}
      {scrollableRight && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-r from-transparent to-pa-bg"
        />
      )}
    </div>
  );

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
      <PlotSlab scene={scene}>{grid}</PlotSlab>
      {traits.inlineChrome && (
        <div
          className={`flex shrink-0 items-center justify-end font-medium text-xs ${traits.countBar}`}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
