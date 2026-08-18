
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, EllipsisIcon } from "lucide-react";
import { compareCells, formatCell } from "../../../src/presentation_core/view_format.js";
import type { PLOT_PADDING } from "../../../src/presentation_core/chart_config.js";
import { shadeCell, type TableShading } from "../../../src/presentation_core/table_shading.js";
import type { TableColumn, TableModel } from "../../../src/presentation_core/view_shape.js";
import { useDarkTheme } from "../use_dark_theme.js";
import { PlotSlab } from "./plot_slab.js";

export const INLINE_ROWS = 8;

/** 表头行高：任意层级按路径深度叠加，总体带偏移挂载后按量得的实高校正。 */
const HEAD_ROW_HEIGHT = 36;

const headCell =
  "h-8 border-pa-line border-b bg-pa-bg px-1 text-left align-middle font-normal text-xs";
/** 瓦片档只改内衬：密度由留白分，不动字级、线色与底色。 */
const cellText = "whitespace-nowrap px-2.5 py-2 font-normal";
const cellTextTile = "whitespace-nowrap px-2 py-1.5 font-normal";
const bodyCellDefault = `${cellText} border-pa-line border-b`;
const bodyCellTile = `${cellTextTile} border-pa-line border-b`;
/**
 * 总体带不复用 bodyCell：两个 border-color 工具类落在同一元素上时，胜者由样式表生成顺序
 * 决定而非书写顺序。这里只用单边工具类，冲突在结构上不可能发生。
 */
const summaryCellDefault = `${cellText} border-b border-b-pa-line bg-pa-bg font-medium`;
const summaryCellTile = `${cellTextTile} border-b border-b-pa-line bg-pa-bg font-medium`;

const frozenCell = "sticky left-0 z-[1] bg-pa-bg group-hover:bg-pa-wash-solid";
/** 缺席的格。 */
const EMPTY_CELL = <span className="text-pa-faint">—</span>;
/** 组边界线：单边工具类，理由同上。 */
const groupEdge = "border-l border-l-pa-line";
const shadeText = { ink: "text-pa-ink", inverse: "text-pa-ink-fg" } as const;

/**
 * 热力格：底色铺在格内一块圆角片上而不是整格——片与片之间留出格内衬的一圈，行线不被色片
 * 压断，深浅在网格里各自成块可辨。字色按底色对比选墨色或反白（`shadeCell` 决定）；
 * 「仅颜色」档把数字藏起来只留色。明暗档只有着色的表才需要问，故订阅在本件而不在表上。
 */
function ShadeChip({
  value,
  formatKey,
  shading,
  children,
}: {
  value: string | number | null;
  formatKey: string;
  shading: TableShading;
  children: React.ReactNode;
}) {
  const dark = useDarkTheme();
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

/** 相邻叶子列的共同路径前缀合并成表头格；headerPath 是分组结构的唯一事实源。 */
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
  fullscreen,
  fill = false,
  countLabel,
  countBar = true,
  tile = false,
  plot,
  canOpenCell,
  onOpenCell,
}: {
  model: TableModel;
  fullscreen: boolean;
  /** 表格自己拥有滚动：撑满定高容器、溢出内滚、表头吸顶。 */
  fill?: boolean;
  /** 行数条右侧的总量文案；缺省按表格自身行数（明细名单等按人计数时由调用方覆盖）。 */
  countLabel?: string | null;
  /** 行数条随表常驻；行数陈述由容器页脚承载时关闭（查看面）。 */
  countBar?: boolean;

  tile?: boolean;
  /**
   * 结果面场地档位：给了就把表格铺在与图表同一块场地上（画不画框由场景表定）。
   * 明细名单等非结果面的清单不给，表格裸铺。
   */
  plot?: keyof typeof PLOT_PADDING;
  /**
   * 能否查看构成记录是列的属性，与格里的数值无关——因此不收值参数。
   * row 为该格的原始结果行下标（经 sourceRows 解析），不是表格展示行序。
   */
  canOpenCell?: (row: number, column: number) => boolean;
  onOpenCell?: (row: number, column: number) => void;
}) {
  const [sort, setSort] = useState<{ column: number; dir: 1 | -1 } | null>(null);
  const headerRows = tableHeaderRows(model.columns);
  const headerDepth = headerRows.length;
  /** 首列是坐标才冻结：数值打头的表没有行头，冻住一列数字反而挡住后面的数字。 */
  const frozen = model.columns[0] ? !model.columns[0].numeric : false;
  const bodyCell = tile ? bodyCellTile : bodyCellDefault;
  const summaryCell = tile ? summaryCellTile : summaryCellDefault;

  const headRef = useRef<HTMLTableSectionElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollableRight, setScrollableRight] = useState(false);
  const [headHeight, setHeadHeight] = useState(headerDepth * (tile ? 32 : HEAD_ROW_HEIGHT));
  /** 已被用户放开截断上限的列 */
  const [uncapped, setUncapped] = useState<Set<number>>(() => new Set());
  /** 悬停中且确实被截断的格子（展开钮只在这里出现） */
  const [expandHint, setExpandHint] = useState<{ row: number; col: number } | null>(null);
  const rows = model.rows.map((row, source) => ({ row, source }));
  if (sort) {
    rows.sort((a, b) => compareCells(a.row[sort.column], b.row[sort.column]) * sort.dir);
  }
  const shown = fullscreen ? rows : rows.slice(0, INLINE_ROWS);
  const total = countLabel ?? `共 ${rows.length} 行`;
  const footer = shown.length < rows.length ? `已显示前 ${shown.length} 行 · ${total}` : total;

  /** 右边还有没有列：滚动、容器改尺寸与换模型三处都要重问，答案只有量得出来。 */
  const probeScroll = () => {
    const node = scrollerRef.current;
    setScrollableRight(!!node && node.scrollWidth - node.clientWidth - node.scrollLeft > 1);
  };
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    probeScroll();
    const observer = new ResizeObserver(probeScroll);
    observer.observe(node);
    return () => observer.disconnect();
    // 列宽随模型与放开截断变，容器尺寸交给 observer
  }, [model, uncapped, fill]);

  useEffect(() => {
    const node = headRef.current;
    if (!fill || !node) return;
    const measure = () => setHeadHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fill]);

  const toggleSort = (i: number) =>
    setSort(
      sort?.column === i ? { column: i, dir: sort.dir === 1 ? -1 : 1 } : { column: i, dir: 1 },
    );

  const uncap = (col: number) => {
    setUncapped((prev) => new Set(prev).add(col));
    setExpandHint(null);
  };

  /** 悬停探测：可截列且确实溢出才亮展开钮；悬停到任何其他格子即收 */
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
        sort?.column === i ? "bg-pa-surface text-pa-fg" : "bg-transparent"
      } ${col.numeric ? "flex-row-reverse" : ""}`}
      onClick={() => toggleSort(i)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort(i);
        }
      }}
    >
      <span className="truncate">{col.label}</span>
      {sort?.column === i &&
        (sort.dir === 1 ? (
          <ChevronUpIcon aria-hidden="true" className="size-2.5 shrink-0" />
        ) : (
          <ChevronDownIcon aria-hidden="true" className="size-2.5 shrink-0" />
        ))}
    </button>
  );

  /**
   * 画竖线的列：只在多层表头下、每个顶层分组的首列画一条，贯穿表头、总体与明细。
   * 单层表不画——那里没有「组」可分，每列自己就是一组，逐列画就成了网格。
   */
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

  /** 格→原始结果行：交叉表经 sourceRows 映射（null=无来源行），长表即模型行序。 */
  const sourceOf = (modelRow: number, col: number): number | null =>
    model.sourceRows ? (model.sourceRows[modelRow]?.[col] ?? null) : modelRow;

  const bodyCellContent = (
    ri: number,
    i: number,
    col: TableColumn,
    value: string | number | null,
  ) => {
    // 数值列不设截断上限——数字撑不到需要截断的宽度
    const text =
      value === null ? null : formatCell(value, col.formatKey, col.format, col.decimals);
    if (text === null) return EMPTY_CELL;
    if (col.numeric) {
      const cellSource = sourceOf(rows[ri].source, i);
      // 记录入口不进静息态：染色的数字会被读成"这个值有名堂"，而能否查看记录是列的属性，
      // 与格里的数值无关。静息一律本色，悬停/聚焦才现形：
      // 格子不画可点性，可点性靠交互暴露）。空格没有数字可点，钮也就不存在。
      const content =
        cellSource !== null && canOpenCell?.(cellSource, i) ? (
          <button
            aria-label={`查看明细：${col.label} ${text ?? ""}`}
            className="block w-full cursor-pointer rounded-sm text-right underline-offset-2 hover:text-pa-accent hover:underline focus-visible:text-pa-accent focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pa-accent"
            onClick={() => onOpenCell?.(cellSource, i)}
            type="button"
          >
            {text}
          </button>
        ) : (
          text
        );
      return model.shading ? (
        <ShadeChip formatKey={col.formatKey} shading={model.shading} value={value}>
          {content}
        </ShadeChip>
      ) : (
        content
      );
    }
    return (
      <>
        <div className={uncapped.has(i) ? "" : "max-w-[780px] truncate"}>{text}</div>
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
          {/* 总体是表格 chrome 不是明细：紧随表头成带，与表头同层吸顶（两者相邻平铺不相互压盖），
              滚动只发生在明细上——总体因此永远不吃列表尾部，读者也不会把它读成"以上合计"。 */}
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
          {/* 表尾不封口：末行的行线与行数条的顶线会叠成一条双线，而表格的下边界由行数条交代。 */}
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
                        : // sticky 本身就是定位元素，展开钮的绝对定位有它作参照；再叠一个
                          // relative 会与它争同一条 position 声明，胜负由样式表顺序而非书写顺序定
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
      {/* 右缘渐隐：宽度取 40px，够把最后一列的数字化开而不遮住它。 */}
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
      {plot ? (
        <PlotSlab plot={plot} fill={fill}>
          {grid}
        </PlotSlab>
      ) : (
        grid
      )}
      {countBar && (
        <div
          className={
            tile
              ? "flex h-7 shrink-0 items-center justify-end pt-1 font-medium text-pa-faint text-xs leading-4"
              : "flex h-[30px] shrink-0 items-center justify-end border-pa-line border-t px-2 font-medium text-pa-muted text-xs"
          }
        >
          {footer}
        </div>
      )}
    </div>
  );
}
