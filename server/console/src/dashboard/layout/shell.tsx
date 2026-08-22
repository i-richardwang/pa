/**
 * 控制台外壳：shadcn SidebarProvider + 画布灰、栏头工作区菜单、收起钮 hover 显隐。
 * 全局键位：⌘/Ctrl+K 命令面板、⌘/Ctrl+. 与官方 ⌘/Ctrl+B 折叠侧栏、? 快捷键一览、Esc 收起工作台右栏。
 * 侧栏开合恒由用户手动决定，偏好记 localStorage——没有任何页面会替用户收起主导航。
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIcon,
  BookOpenIcon,
  ChartBarIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  WaypointsIcon,
} from "lucide-react";
import type { MePayload } from "@contracts/session_contract";
import { AppSidebar } from "@/components/app-sidebar";
import type { NavMainGroup } from "@/components/nav-main";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SidebarInset,
  SidebarProvider,
  SidebarSearchButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Sheet, SheetPopup } from "@/components/ui/sheet";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RouteKey, SettingsTab } from "../router";
import { useOpenerFocus } from "@/components/ui/command";
import { CommandPalette } from "./command_palette";
import type { NavEntry } from "./navigation";
import {
  ShellChromeProvider,
  STAGE_ASIDE_WIDTH,
  type StageAside,
  TitlebarActionsOutlet,
  useDetailCrumb,
  useStageAside,
} from "./layout_chrome";
import { cn } from "@/lib/utils";
import { Titlebar } from "@/components/ui/titlebar";
import { SettingsDialog } from "../admin/settings_page";
import { useIsMobile } from "@/hooks/use-mobile";
import { escapeClaimsAside, isEditableTarget } from "@/lib/keyboard";

/** 主区白面的两种底：清单与工作台坐白卡，看板坐画布灰。 */
type MainSurface = "card" | "canvas";

type NavItem = NavEntry & { adminOnly: boolean };

const NAV: readonly NavItem[] = [
  { key: "reports", label: "我的报告", icon: <ChartBarIcon />, adminOnly: false },
  { key: "boards", label: "我的看板", icon: <LayoutDashboardIcon />, adminOnly: false },
  { key: "catalog", label: "指标字典", icon: <BookOpenIcon />, adminOnly: false },
  { key: "model", label: "数据能力地图", icon: <WaypointsIcon />, adminOnly: true },
  { key: "usage", label: "使用日志", icon: <ActivityIcon />, adminOnly: true },
  { key: "feedback", label: "反馈审核", icon: <MessageSquareIcon />, adminOnly: true },
];

const NAV_OPEN_KEY = "pa.nav-open";

function visibleNav(isAdmin: boolean): NavItem[] {
  return NAV.filter((n) => !n.adminOnly || isAdmin);
}

function navGroups(isAdmin: boolean): NavMainGroup[] {
  const visible = visibleNav(isAdmin);
  return [
    {
      // 主列表无段标题；仅管理段带标签
      label: "",
      items: visible
        .filter((n) => !n.adminOnly)
        .map((n) => ({ key: n.key, title: n.label, icon: n.icon })),
    },
    {
      label: "管理",
      items: visible
        .filter((n) => n.adminOnly)
        .map((n) => ({ key: n.key, title: n.label, icon: n.icon })),
    },
  ].filter((g) => g.items.length > 0);
}

/** 主区顶栏短名：与侧栏条目同文案。 */
function routeTitle(route: RouteKey, items: readonly NavItem[]): string {
  return items.find((n) => n.key === route)?.label ?? "我的报告";
}

/** 非管理员的 admin 路由归一到默认页。 */
export function resolveRoute(route: RouteKey, isAdmin: boolean): RouteKey {
  return visibleNav(isAdmin).some((n) => n.key === route) ? route : "reports";
}

const SHORTCUTS: readonly { keys: string; desc: string }[] = [
  { keys: "⌘/Ctrl + K", desc: "全局搜索（页面、看板、报告、指标）" },
  { keys: "⌘/Ctrl + .", desc: "收起 / 展开侧栏" },
  { keys: "⌘/Ctrl + B", desc: "收起 / 展开侧栏" },
  { keys: "?", desc: "快捷键一览" },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <ul className="space-y-2 text-sm">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-4">
                <span>{s.desc}</span>
                <kbd className="rounded border bg-pa-surface px-1.5 py-0.5 font-sans text-xs">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function DashboardShell({
  me,
  route,
  navigate,
  onSignOut,
  listChrome = false,
  mainSurface = "card",
  settingsOpen = false,
  settingsTab,
  onSettingsOpenChange,
  children,
}: {
  me: MePayload;
  route: RouteKey;
  navigate: (r: RouteKey) => void;
  onSignOut: () => void;
  /** 清单骨架：titlebar 恒显页名 + 可选「+ 新建」。详情/表单页勿开。 */
  listChrome?: boolean;
  mainSurface?: MainSurface;
  /** 个人设置：居中弹层，不占路由页。 */
  settingsOpen?: boolean;
  settingsTab?: SettingsTab;
  onSettingsOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const items = visibleNav(me.is_admin);
  const groups = navGroups(me.is_admin);
  const [open, setOpenState] = useState(() => localStorage.getItem(NAV_OPEN_KEY) !== "0");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** 跳转面从任何地方都能用 ⌘K 打开，没有触发件可认；归还目标见 `useOpenerFocus`。 */
  const paletteFocus = useOpenerFocus();

  function openPalette(next: boolean) {
    if (next) paletteFocus.capture();
    setPaletteOpen(next);
  }

  function setOpen(next: boolean) {
    setOpenState(next);
    localStorage.setItem(NAV_OPEN_KEY, next ? "1" : "0");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette(!paletteOpen);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "." && !isEditableTarget(e.target)) {
        e.preventDefault();
        setOpen(!open);
      } else if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditableTarget(e.target)
      ) {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // paletteOpen 进依赖：⌘K 要按当前开合状态翻转，读的不能是注册那一刻的旧值。
  }, [open, paletteOpen]);

  const title = routeTitle(route, items);

  return (
    <ToastProvider>
      <TooltipProvider>
        <ShellChromeProvider>
          <SidebarProvider className="h-svh overflow-hidden" onOpenChange={setOpen} open={open}>
            <AppSidebar
              groups={groups}
              me={me}
              onNavigate={navigate}
              onOpenSearch={() => openPalette(true)}
              onOpenSettings={() => onSettingsOpenChange?.(true)}
              onSignOut={onSignOut}
              route={route}
            />
            <SidebarInset className={cn("min-h-0", mainSurface === "canvas" && "bg-pa-canvas")}>
              <MainColumn
                open={open}
                listChrome={listChrome}
                title={title}
                onOpenSearch={() => openPalette(true)}
              >
                {children}
              </MainColumn>
            </SidebarInset>
          </SidebarProvider>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={openPalette}
            finalFocus={paletteFocus.finalFocus}
            navItems={items.map((n) => ({ key: n.key, label: n.label, icon: n.icon }))}
            navigate={navigate}
            onOpenSettings={() => onSettingsOpenChange?.(true)}
          />
          <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          {onSettingsOpenChange ? (
            <SettingsDialog
              me={me}
              onOpenChange={onSettingsOpenChange}
              open={settingsOpen}
              tab={settingsTab}
            />
          ) : null}
        </ShellChromeProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}

/**
 * Esc 收起档案面右栏（`face: "profile"`）：它随一次选中而开，Esc 就是放下这条记录。
 * 配置面右栏是工作台的开关件，不随 Esc 收起。桌面推挤栏与窄屏 Sheet 同一条规则。
 * 听在 document 捕获阶段：Sheet 原语没有触发件，不接管 Esc，也不保证事件冒得出来。
 */
function useStageAsideEscape(
  aside: StageAside | null,
  rootRef: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (aside?.face !== "profile") return;
    const onKey = (event: KeyboardEvent) => {
      if (escapeClaimsAside(event, rootRef.current)) aside.dismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [aside, rootRef]);
}

function StageAsideSheet({
  aside,
  popupRef,
}: {
  aside: StageAside;
  popupRef: React.Ref<HTMLDivElement>;
}) {
  const { capture, finalFocus } = useOpenerFocus();
  const captured = useRef(false);
  if (!captured.current) {
    captured.current = true;
    capture();
  }
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) aside.dismiss();
      }}
    >
      <SheetPopup
        aria-label={aside.face === "profile" ? "档案" : "配置"}
        className="h-[85svh] overflow-hidden rounded-t-xl"
        finalFocus={finalFocus}
        ref={popupRef}
        showCloseButton={false}
        side="bottom"
      >
        {aside.node}
      </SheetPopup>
    </Sheet>
  );
}

/**
 * MAIN 内容列。有工作台右栏时：左列 = titlebar + 内容；
 * 右栏通高顶到白卡顶，不吃整宽 titlebar。
 *
 * 树形必须在右栏显隐间保持稳定：若「有栏」走包一层 div、「无栏」改 Fragment，
 * 左列会整段 remount，工作台 `useState`（含配置栏开合）被重置，收起钮形同失灵。
 */
function MainColumn({
  open,
  listChrome,
  title,
  onOpenSearch,
  children,
}: {
  open: boolean;
  listChrome: boolean;
  title: string;
  onOpenSearch: () => void;
  children: React.ReactNode;
}) {
  const stageAside = useStageAside();
  const isMobile = useIsMobile();
  const asideRootRef = useRef<HTMLDivElement | null>(null);
  useStageAsideEscape(stageAside, asideRootRef);
  return (
    <div className="flex min-h-0 flex-1 flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ShellTitlebar
          open={open}
          listChrome={listChrome}
          title={title}
          onOpenSearch={onOpenSearch}
        />
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            // 清单页：外层不滚；控制条钉顶，表体走 ListScrollBody
            listChrome ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </div>
      </div>
      {stageAside && !isMobile ? (
        <div
          className="flex h-full min-h-0 w-(--pa-stage-aside) shrink-0 flex-col border-pa-line border-l-[0.5px]"
          data-slot="chart-stage-aside"
          ref={asideRootRef}
          style={
            { "--pa-stage-aside": `${STAGE_ASIDE_WIDTH[stageAside.face]}px` } as React.CSSProperties
          }
        >
          {stageAside.node}
        </div>
      ) : null}
      {stageAside && isMobile ? (
        <StageAsideSheet aside={stageAside} popupRef={asideRootRef} />
      ) : null}
    </div>
  );
}

/**
 * 清单 / 详情同槽 titlebar：
 * - 列表：页名 + 页面登记的动作（「+ 新建」）
 * - 详情：`父级 / 当前` 面包屑（与列表页名同一位置，一脉相承）+ 页面登记的动作
 * - 其它：仅侧栏收起时显示 Trigger + 短名 + 搜索
 *
 * 三种载荷同高（`Titlebar` 基线）：收侧栏时若换一档矮条，页内容会随开合上下跳。
 * 工作台开配置栏时，本题条只住左列，不横跨右栏。
 */
function ShellTitlebar({
  open,
  listChrome,
  title,
  onOpenSearch,
}: {
  open: boolean;
  listChrome: boolean;
  title: string;
  onOpenSearch: () => void;
}) {
  const detailCrumb = useDetailCrumb();
  const isMobile = useIsMobile();
  /**
   * 窄屏侧栏是抽屉（Sheet），只能从这条题条的汉堡钮拉开——抽屉自身那个钮在抽屉里面，
   * 只关得上打不开。而 `open` 是桌面档的展开偏好（localStorage，默认 true），拿它当
   * 判据会让窄屏恰好落进「已展开所以不必给入口」的分支：题条整条不渲染，导航无从进入。
   * 故窄屏恒亮入口，与桌面偏好无关。
   */
  const showTrigger = !open || isMobile;
  const showBar = listChrome || !!detailCrumb || showTrigger;
  if (!showBar) return null;

  return (
    <Titlebar className="gap-0">
      {showTrigger ? <SidebarTrigger className="-ms-1" title="打开侧栏" /> : null}
      <div className="flex min-w-0 flex-1 items-center gap-1 truncate px-2.5 pb-0.5 text-left text-sm font-medium text-pa-fg">
        {detailCrumb ? (
          <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5">
            <a
              className="truncate font-medium text-pa-fg-soft transition-colors hover:text-pa-fg"
              href={detailCrumb.parentHref}
            >
              {detailCrumb.parentLabel}
            </a>
            <span aria-hidden="true" className="shrink-0 font-normal text-pa-faint">
              /
            </span>
            <span aria-current="page" className="truncate font-medium text-pa-fg">
              {detailCrumb.current}
            </span>
          </nav>
        ) : listChrome ? (
          // 清单页的页名只在题条里出现一次，页内没有第二处大标题——那它就是这一页的 h1。

          <h1 className="min-w-0 truncate">{title}</h1>
        ) : (
          title
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TitlebarActionsOutlet />
        {showTrigger ? <SidebarSearchButton onClick={onOpenSearch} /> : null}
      </div>
    </Titlebar>
  );
}
