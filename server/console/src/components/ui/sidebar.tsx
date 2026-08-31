/** Adapted from shadcn/ui under the MIT License; see docs/third_party_licenses.md. */

import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { useIsMobile } from "@/hooks/use-mobile";
import { isEditableTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { PanelLeftIcon, SearchIcon } from "lucide-react";

/** 导航侧栏的宽；弹层里的分节栏同取这一档。 */
export const SIDEBAR_WIDTH = "13.75rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";

const SIDEBAR_EDGE = "0.375rem";

const SIDEBAR_KEYBOARD_SHORTCUT = "b";

const sidebarToolButtonClass =
  "pa-focus inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-pa-fg-soft hover:bg-pa-surface hover:text-pa-fg active:bg-pa-surface disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:mx-0";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

/**
 * 开合状态恒由调用方持有（shell 记 localStorage）：纯客户端渲染没有 SSR 消费者，
 * 不引入 cookie 这第二份真相。
 */
function SidebarProvider({
  open,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((value) => !value);
    } else {
      onOpenChange(!open);
    }
  }, [isMobile, onOpenChange, open]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey) &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen: onOpenChange,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, onOpenChange, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-edge": SIDEBAR_EDGE,
            ...style,
          } as React.CSSProperties
        }
        className={cn("group/sidebar-wrapper flex min-h-svh w-full bg-pa-canvas", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<"div">) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetPopup
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          showCloseButton={false}
          className="w-(--sidebar-width) bg-pa-canvas p-0 text-pa-muted"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>侧栏</SheetTitle>
            <SheetDescription>移动端主导航</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer hidden text-pa-muted md:block"
      data-state={state}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-[calc(var(--sidebar-width)+var(--sidebar-edge))] bg-transparent transition-[width] duration-200 ease-linear group-data-[state=collapsed]:w-0"
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) py-(--sidebar-edge) transition-[left,width] duration-200 ease-linear md:flex",
          "left-(--sidebar-edge) group-data-[state=collapsed]:left-[calc((var(--sidebar-width)+var(--sidebar-edge))*-1)]",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="group/sidebar-inner flex size-full flex-col bg-pa-canvas"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      className={cn(sidebarToolButtonClass, className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">收起 / 展开侧栏</span>
    </button>
  );
}

function SidebarSearchButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label="搜索"
      data-slot="sidebar-search"
      className={cn(sidebarToolButtonClass, className)}
      {...props}
    >
      <SearchIcon />
    </button>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  const { state } = useSidebar();
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full min-h-0 flex-1 flex-col bg-pa-bg",
        "md:my-(--sidebar-edge) md:mr-(--sidebar-edge) md:overflow-hidden md:rounded-xl md:border-[0.5px] md:border-pa-line",
        "transition-[margin] duration-200 ease-linear",
        state === "collapsed" ? "md:ml-(--sidebar-edge)" : "md:ml-0",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col px-2 pt-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto px-2 pt-1",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "mt-3 flex shrink-0 items-center px-0.5 py-2 text-2xs font-normal text-pa-faint",
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  });
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-0", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

const sidebarMenuButtonClass =
  "peer/menu-button group/menu-button flex h-8 w-full cursor-pointer items-center gap-0 overflow-hidden rounded-md py-0 pr-2 pl-0.5 text-left text-sm font-normal pa-focus text-pa-fg-soft transition-colors hover:text-pa-fg disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:bg-pa-surface data-active:text-pa-fg [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate";

function SidebarMenuButton({
  render,
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button"> & { isActive?: boolean }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({ className: cn(sidebarMenuButtonClass, className) }, props),
    render,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      active: isActive,
    },
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSearchButton,
  SidebarTrigger,
};
