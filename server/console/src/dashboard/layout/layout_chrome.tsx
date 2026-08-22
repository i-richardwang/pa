/**
 * 壳的挂载面：页面把题条动作、面包屑与右栏交给壳排版，壳负责位置，页面负责内容。
 * 三个槽各自独立，每槽一个写入 hook、一个读出 hook；写入 hook 卸载即清空。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DependencyList } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InspectorFace } from "@/components/ui/inspector";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Slot<T> = { value: T; set: (next: T) => void };

function useSlotState<T>(empty: T): Slot<T> {
  const [value, setValue] = useState<T>(empty);
  const set = useCallback((next: T) => setValue(() => next), []);
  return useMemo(() => ({ value, set }), [value, set]);
}

/** 写入 hook 的公共身体：工厂按 deps 记忆，挂上即写、卸下即清。 */
function useSlotWriter<T>(slot: Slot<T>, factory: () => T, deps: DependencyList, empty: T): void {
  const next = useMemo(factory, deps);
  useEffect(() => {
    slot.set(next);
    return () => slot.set(empty);
  }, [next, slot.set, empty]);
}

/* ---- 题条动作 ---- */

const TitlebarActionsContext = createContext<Slot<React.ReactNode | null>>({
  value: null,
  set: () => {},
});

/**
 * 题条动作的登记处。壳为主区题条开一处；设置弹层为自己的题条另开一处，
 * 弹层里的页面登记到离它最近的那一处。
 */
export function TitlebarActionsProvider({ children }: { children: React.ReactNode }) {
  const slot = useSlotState<React.ReactNode | null>(null);
  return <TitlebarActionsContext.Provider value={slot}>{children}</TitlebarActionsContext.Provider>;
}

/** 题条右侧的动作位：印出最近一处登记处里登记的节点。 */
export function TitlebarActionsOutlet(): React.ReactNode {
  return useContext(TitlebarActionsContext).value;
}

/** 页面把动作（「+ 新建」、详情页的保存/更多）挂到所属题条右侧。 */
export function useSetTitlebarActions(
  factory: () => React.ReactNode | null,
  deps: DependencyList,
): void {
  useSlotWriter(useContext(TitlebarActionsContext), factory, deps, null);
}

/* ---- 详情面包屑 ---- */

/** 详情页挂到主区 titlebar 的面包屑：与列表页同槽，父级可点、当前页不可点。 */
export type DetailCrumb = {
  parentHref: string;
  parentLabel: string;
  current: string;
};

const DetailCrumbContext = createContext<Slot<DetailCrumb | null>>({
  value: null,
  set: () => {},
});

export function useDetailCrumb(): DetailCrumb | null {
  return useContext(DetailCrumbContext).value;
}

/**
 * 详情页把 `父级 / 当前` 挂到与列表页同槽的 titlebar。
 * 定位由 titlebar 承担，内容区不重复标题与返回链。
 */
export function useSetDetailCrumb(factory: () => DetailCrumb | null, deps: DependencyList): void {
  useSlotWriter(useContext(DetailCrumbContext), factory, deps, null);
}

/* ---- 工作台右栏 ---- */

export type StageAside = {
  node: React.ReactNode;
  /** 这栏是拿来调的还是拿来读的——壳据此取宽度那一档。 */
  face: InspectorFace;
  /** 同一个「收起」动作：壳在 Esc、窄屏 Sheet 的背景点击上调用它，开关仍握在页面手里。 */
  dismiss: () => void;
};

/**
 * 右栏宽度单源，按栏的用途分两档：配置面摆控件，档案面摆记录本身、行更长也更该摊开。
 * 页面自己不写宽度，否则常量与真实 DOM 各活各的。
 */
export const STAGE_ASIDE_WIDTH = { settings: 320, profile: 380 } as const;

const StageAsideContext = createContext<Slot<StageAside | null>>({
  value: null,
  set: () => {},
});

/** 壳读取：有值时 MAIN 改为「左题条+内容 | 右栏通高」，窄屏改为底部 Sheet。 */
export function useStageAside(): StageAside | null {
  return useContext(StageAsideContext).value;
}

/**
 * 工作台挂右栏（右栏顶到白卡顶）。收起时工厂返回 null，壳恢复整宽 titlebar。
 * `dismiss` 经 ref 转交，不进依赖——换个闭包不该让栏重挂。
 */
export function useSetStageAside(
  factory: () => React.ReactNode | null,
  deps: DependencyList,
  dismiss: () => void,
  face: InspectorFace = "settings",
): void {
  const slot = useContext(StageAsideContext);
  const node = useMemo(factory, deps);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    slot.set(node ? { node, face, dismiss: () => dismissRef.current() } : null);
    return () => slot.set(null);
  }, [node, face, slot.set]);
}

/** 壳给主区套的一整组挂载面。 */
export function ShellChromeProvider({ children }: { children: React.ReactNode }) {
  const crumb = useSlotState<DetailCrumb | null>(null);
  const aside = useSlotState<StageAside | null>(null);
  return (
    <TitlebarActionsProvider>
      <DetailCrumbContext.Provider value={crumb}>
        <StageAsideContext.Provider value={aside}>{children}</StageAsideContext.Provider>
      </DetailCrumbContext.Provider>
    </TitlebarActionsProvider>
  );
}

export const MAIN_CARD_BODY_INSET = "px-4 pt-0 pb-4" as const;

/**
 * 列表内容列：主卡内全宽 + MAIN_CARD_BODY_INSET。
 * 填满 titlebar 以下剩余高度；控制条 `ListControlBar` 钉住，表体走 `ListScrollBody`。
 */
export function ListPageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-0 w-full flex-1 flex-col", MAIN_CARD_BODY_INSET, className)}
      data-slot="list-page-body"
    >
      {children}
    </div>
  );
}

/**
 * 清单控制条下方的唯一滚动容器：表 / 空态 / 页脚在此内滚，控制条本身不跟着走。
 */
export function ListScrollBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} data-slot="list-scroll-body">
      {children}
    </div>
  );
}

/** 清单控制条：钉在清单顶，靠 `ListPageBody` + 本件 `shrink-0` + `ListScrollBody` 分栏实现。 */
export function ListControlBar({
  left,
  right,
  className,
}: {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("shrink-0 bg-pa-bg", className)} data-slot="list-control-bar">
      <nav className="flex flex-row items-center justify-between gap-2 rounded-xl bg-pa-canvas p-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{left}</div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </nav>
    </div>
  );
}

export function ListSegmentGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset 是表单控件的分组语义，本组是按钮档位，套上去等于向读屏器报出一个并不存在的表单
    <div
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1", className)}
      data-slot="list-segment-group"
      role="group"
    >
      {children}
    </div>
  );
}

/** 控制条内的分面片：选中出灰罩层，未选只是灰字。 */
export function ListSegment({
  selected,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "pa-focus inline-flex h-8 min-w-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-[9px] pb-0.5 text-sm transition-colors duration-150",
        selected ? "bg-pa-surface text-pa-fg" : "bg-transparent text-pa-muted hover:bg-pa-surface",
        className,
      )}
      data-slot="list-segment"
      {...props}
    >
      {children}
    </button>
  );
}

/** 灰条内的幽灵下拉：无描边，靠灰条自身衬底；与同条内的分面片同高。 */
export function ListControlCategory<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel = "分类",
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  "aria-label"?: string;
}): React.ReactElement {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next as T);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-auto" variant="ghost">
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? ariaLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" className="min-w-40">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * 清单行内的分类片：描边圆片，形出自 Button 的 compact 档。
 * `absent` 说的是「本该有个去处，但它不在」——虚线是这句话的写法，不是「不可点」的同义词：
 * 只读的分类标签同样不可点，却是实打实存在的一件事，仍走实线。
 */
export function ListCategoryPill({
  children,
  className,
  absent = false,
  ...props
}: React.ComponentProps<"button"> & { absent?: boolean }): React.ReactElement {
  return (
    <Button
      className={cn(
        "text-pa-muted",
        // 不可点的芯片出的是 span，钮那套指针与悬停在它身上没有对应动作。
        !props.onClick && "cursor-default hover:border-pa-line",
        absent && "border-dashed",
        className,
      )}
      render={props.onClick ? undefined : <span />}
      size="compact"
      {...props}
    >
      {children}
    </Button>
  );
}

export function ListControlSearch({
  value,
  onValueChange,
  placeholder = "搜索",
  "aria-label": ariaLabel = "搜索",
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
}): React.ReactElement {
  return (
    <label
      className={cn(
        "group flex h-8 w-[182px] max-w-full items-center gap-2 rounded-md border border-pa-line bg-pa-bg px-2 transition duration-200",
        "pa-focus-within hover:border-pa-line-hover focus-within:hover:border-pa-focus-strong",
      )}
    >
      <SearchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-pa-faint group-focus-within:text-pa-fg-soft"
      />
      <input
        aria-label={ariaLabel}
        autoComplete="off"
        className="w-full min-w-0 bg-transparent pb-0.5 text-sm leading-tight text-pa-fg outline-none placeholder:text-pa-placeholder [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
        placeholder={placeholder}
        spellCheck={false}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </label>
  );
}
