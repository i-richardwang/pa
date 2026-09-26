/** ⌘/Ctrl+B 由侧栏组件自带处理；侧栏开合只由用户手动切换，偏好存在 localStorage。 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIcon,
  BookOpenIcon,
  ChartBarIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  ShapesIcon,
  SpellCheckIcon,
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

type MainSurface = "card" | "canvas";

type NavGroup = { label: string; adminOnly: boolean; items: readonly NavEntry[] };

const NAV: readonly NavGroup[] = [
  {
    label: "",
    adminOnly: false,
    items: [
      { key: "reports", label: "我的报告", icon: <ChartBarIcon /> },
      { key: "boards", label: "我的看板", icon: <LayoutDashboardIcon /> },
    ],
  },
  {
    label: "字典",
    adminOnly: false,
    items: [
      { key: "metrics", label: "指标", icon: <BookOpenIcon /> },
      { key: "dimensions", label: "维度", icon: <ShapesIcon /> },
      { key: "terms", label: "业务术语", icon: <SpellCheckIcon /> },
    ],
  },
  {
    label: "管理",
    adminOnly: true,
    items: [
      { key: "model", label: "数据能力地图", icon: <WaypointsIcon /> },
      { key: "usage", label: "使用日志", icon: <ActivityIcon /> },
      { key: "feedback", label: "反馈审核", icon: <MessageSquareIcon /> },
    ],
  },
];

const NAV_OPEN_KEY = "pa.nav-open";

function visibleGroups(isAdmin: boolean): NavGroup[] {
  return NAV.filter((group) => !group.adminOnly || isAdmin);
}

function visibleNav(isAdmin: boolean): NavEntry[] {
  return visibleGroups(isAdmin).flatMap((group) => group.items);
}

function navGroups(isAdmin: boolean): NavMainGroup[] {
  return visibleGroups(isAdmin).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({ key: item.key, title: item.label, icon: item.icon })),
  }));
}

function routeTitle(route: RouteKey, items: readonly NavEntry[]): string {
  return items.find((n) => n.key === route)?.label ?? "我的报告";
}

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
  /** 清单页布局：标题栏始终显示页名。详情页和表单页不开启。 */
  listChrome?: boolean;
  mainSurface?: MainSurface;
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
  /** 命令面板没有触发按钮，关闭后的焦点目标由 `useOpenerFocus` 在打开时记录。 */
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
    // paletteOpen 放进依赖：⌘K 要按当前开合状态切换，不能读到注册时的旧值。
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

/** 在 document 捕获阶段监听：没有 Trigger 的 Sheet 不处理 Esc，也不保证事件冒泡出来。 */
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
        aria-label={aside.face === "profile" ? "详情" : "配置"}
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
 * 右栏显隐时组件树结构要保持不变：改用 Fragment 会让左列整段重新挂载，
 * 重置工作台的 `useState`（含配置栏开合）。
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

/** 三种标题栏内容都用 `Titlebar` 的高度，否则页面内容会随侧栏开合上下跳动。 */
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
  /** 窄屏始终显示导航入口：`open` 是桌面端的展开偏好，不适用于窄屏。 */
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
