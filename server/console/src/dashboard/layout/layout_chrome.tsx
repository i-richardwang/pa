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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ListChromeValue = {
  actions: React.ReactNode | null;
  setActions: (actions: React.ReactNode | null) => void;
};

const ListChromeContext = createContext<ListChromeValue>({
  actions: null,
  setActions: () => {},
});

/** 详情页挂到主区 titlebar 的面包屑：与列表页同槽，父级可点、当前页不可点。 */
export type DetailCrumb = {
  parentHref: string;
  parentLabel: string;
  current: string;
};

type DetailChromeValue = {
  crumb: DetailCrumb | null;
  setCrumb: (crumb: DetailCrumb | null) => void;
  /** 详情题条右侧动作。 */
  actions: React.ReactNode | null;
  setActions: (actions: React.ReactNode | null) => void;
};

const DetailChromeContext = createContext<DetailChromeValue>({
  crumb: null,
  setCrumb: () => {},
  actions: null,
  setActions: () => {},
});

export type StageAside = {
  node: React.ReactNode;
  /** 这栏是拿来调的还是拿来读的——壳据此取宽度那一档。 */
  face: StageAsideFace;

  dismiss: (() => void) | null;
};

type StageAsideFace = "settings" | "profile";

/**
 * 右栏宽度单源，按栏的用途分两档：配置面摆控件，档案面摆记录本身、行更长也更该摊开。
 * 页面自己不写宽度，否则常量与真实 DOM 各活各的。
 */
export const STAGE_ASIDE_WIDTH = { settings: 320, profile: 380 } as const;

type StageAsideValue = {
  aside: StageAside | null;
  setAside: (aside: StageAside | null) => void;
};

const StageAsideContext = createContext<StageAsideValue>({
  aside: null,
  setAside: () => {},
});

export type MainSurface = "card" | "canvas";

type MainSurfaceValue = {
  surface: MainSurface;
  setSurface: (surface: MainSurface) => void;
};

const MainSurfaceContext = createContext<MainSurfaceValue>({
  surface: "card",
  setSurface: () => {},
});

export function ListChromeProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActionsState] = useState<React.ReactNode | null>(null);
  const [crumb, setCrumbState] = useState<DetailCrumb | null>(null);
  const [detailActions, setDetailActionsState] = useState<React.ReactNode | null>(null);
  const [stageAside, setStageAsideState] = useState<StageAside | null>(null);
  const [mainSurface, setMainSurfaceState] = useState<MainSurface>("card");
  const setActions = useCallback((next: React.ReactNode | null) => {
    setActionsState(next);
  }, []);
  const setCrumb = useCallback((next: DetailCrumb | null) => {
    setCrumbState(next);
  }, []);
  const setDetailActions = useCallback((next: React.ReactNode | null) => {
    setDetailActionsState(next);
  }, []);
  const setAside = useCallback((next: StageAside | null) => {
    setStageAsideState(next);
  }, []);
  const setSurface = useCallback((next: MainSurface) => {
    setMainSurfaceState(next);
  }, []);
  const listValue = useMemo(() => ({ actions, setActions }), [actions, setActions]);
  const detailValue = useMemo(
    () => ({ crumb, setCrumb, actions: detailActions, setActions: setDetailActions }),
    [crumb, setCrumb, detailActions, setDetailActions],
  );
  const stageValue = useMemo(() => ({ aside: stageAside, setAside }), [stageAside, setAside]);
  const surfaceValue = useMemo(
    () => ({ surface: mainSurface, setSurface }),
    [mainSurface, setSurface],
  );
  return (
    <ListChromeContext.Provider value={listValue}>
      <DetailChromeContext.Provider value={detailValue}>
        <StageAsideContext.Provider value={stageValue}>
          <MainSurfaceContext.Provider value={surfaceValue}>{children}</MainSurfaceContext.Provider>
        </StageAsideContext.Provider>
      </DetailChromeContext.Provider>
    </ListChromeContext.Provider>
  );
}

export function useListChromeActions(): React.ReactNode | null {
  return useContext(ListChromeContext).actions;
}

export function useDetailCrumb(): DetailCrumb | null {
  return useContext(DetailChromeContext).crumb;
}

export function useDetailChromeActions(): React.ReactNode | null {
  return useContext(DetailChromeContext).actions;
}

/** 壳读取：有值时 MAIN 改为「左题条+内容 | 右栏通高」，窄屏改为底部 Sheet。 */
export function useStageAside(): StageAside | null {
  return useContext(StageAsideContext).aside;
}

export function useMainSurface(): MainSurface {
  return useContext(MainSurfaceContext).surface;
}

export function useSetMainSurface(surface: MainSurface): void {
  const { setSurface } = useContext(MainSurfaceContext);
  useEffect(() => {
    setSurface(surface);
    return () => setSurface("card");
  }, [surface, setSurface]);
}

/**
 * 工作台挂右栏（右栏顶到白卡顶）。
 * 收起时传 null，壳恢复整宽 titlebar。
 *
 * `dismiss` 是同一个「收起」动作：窄屏上壳把这栏摆成底部 Sheet，背景点击与 Esc 得能关它，
 * 而开关握在调用方手里。它经 ref 转交，故不进 effect 依赖——换个闭包不该让栏重挂。
 */
export function useSetStageAside(
  factory: () => React.ReactNode | null,
  deps: DependencyList,
  dismiss?: () => void,
  face: StageAsideFace = "settings",
): void {
  const { setAside } = useContext(StageAsideContext);
  const node = useMemo(factory, deps);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    setAside(node ? { node, face, dismiss: () => dismissRef.current?.() } : null);
    return () => setAside(null);
  }, [node, face, setAside]);
}

/** 页面把「+ 新建」挂到主区 titlebar 右侧。 */
export function useSetListChromeActions(
  factory: () => React.ReactNode,
  deps: DependencyList,
): void {
  const { setActions } = useContext(ListChromeContext);
  const node = useMemo(factory, deps);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}

/**
 * 详情页把动作挂到主区 titlebar 右侧。
 * 与面包屑同槽同高（`Titlebar` 基线），不另起内容区题条。
 */
export function useSetDetailChromeActions(
  factory: () => React.ReactNode | null,
  deps: DependencyList,
): void {
  const { setActions } = useContext(DetailChromeContext);
  const node = useMemo(factory, deps);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}

/**
 * 详情页把 `父级 / 当前` 挂到与列表页同槽的 titlebar。
 * 定位由 titlebar 承担，内容区不重复标题与返回链。
 */
export function useSetDetailCrumb(factory: () => DetailCrumb | null, deps: DependencyList): void {
  const { setCrumb } = useContext(DetailChromeContext);
  const next = useMemo(factory, deps);
  useEffect(() => {
    setCrumb(next);
    return () => setCrumb(null);
  }, [next, setCrumb]);
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
